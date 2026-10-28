"""
EchoScribe local speech service: speaker diarization with pyannote community-1.

Runs on this computer, so session audio never leaves it for speaker separation.
The Node server converts every recording to 16 kHz mono WAV with its bundled FFmpeg
before sending it here, so this service never decodes compressed audio itself.

Endpoints
  GET  /health    models loaded, device (GPU details when on CUDA)
  POST /diarize   multipart "audio" (16 kHz mono WAV) + "num_speakers" -> {"turns": [...]}

Environment
  HF_TOKEN               Hugging Face read token; needed once to download the gated
                         pyannote/speaker-diarization-community-1 weights (CC-BY-4.0),
                         after which the cached copy is used offline
  DIARIZATION_MODEL      Hugging Face id or local folder (default pyannote-community/speaker-diarization-community-1)
  SPEECH_DEVICE          auto | cuda | cuda:N | mps | cpu   (auto: NVIDIA GPU, then Apple MPS, then CPU)
  SPEECH_SERVICE_PORT    default 5050
"""

import io
import logging
import os
import threading
import contextlib

import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

logging.basicConfig(level=logging.INFO, format="[Speech] %(levelname)s %(message)s")
log = logging.getLogger("speech_service")

# Ungated copy published by the pyannote team (same weights, CC-BY-4.0); the gated original works with HF_TOKEN
MODEL_ID = os.environ.get("DIARIZATION_MODEL", "pyannote-community/speaker-diarization-community-1")
CACHE_DIR = os.path.join(os.path.dirname(__file__), "pretrained_models", "hf")
SAMPLE_RATE = 16000


def _pick_device() -> str:
    want = os.environ.get("SPEECH_DEVICE", "auto").strip().lower()
    if want.startswith("cuda"):
        if torch.cuda.is_available():
            return want
        log.warning("SPEECH_DEVICE=%s but CUDA is not available (CPU-only torch build or no NVIDIA driver); using CPU", want)
        return "cpu"
    if want in ("mps", "cpu"):
        return want if want == "cpu" or torch.backends.mps.is_available() else "cpu"
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


DEVICE = _pick_device()
# One pipeline call at a time: pyannote batches internally and concurrent calls would compete for memory
RUN_LOCK = threading.Lock()
pipeline = None
load_error = None


def gpu_info() -> dict:
    if not DEVICE.startswith("cuda"):
        return {}
    idx = torch.cuda.current_device()
    props = torch.cuda.get_device_properties(idx)
    return {
        "gpu": props.name,
        "vram_total_mb": round(props.total_memory / 2**20),
        "vram_allocated_mb": round(torch.cuda.memory_allocated(idx) / 2**20),
        "cuda": torch.version.cuda,
    }


def load_pipeline():
    global pipeline, load_error
    try:
        from pyannote.audio import Pipeline
        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN") or None
        p = Pipeline.from_pretrained(MODEL_ID, token=token, cache_dir=CACHE_DIR)
        if p is None:
            raise RuntimeError(f"{MODEL_ID} could not be loaded: accept its conditions on huggingface.co and set HF_TOKEN")
        p.to(torch.device(DEVICE))
        pipeline = p
        info = gpu_info()
        log.info(f"Loaded {MODEL_ID} on {DEVICE}" + (f" ({info['gpu']}, {info['vram_total_mb']} MB)" if info else ""))
    except Exception as e:  # keep serving /health so the Node router can skip this provider
        load_error = str(e)
        log.error(f"Diarization model not loaded: {e}")


def read_wav(data: bytes) -> torch.Tensor:
    audio, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)  # mono
    if sr != SAMPLE_RATE:
        raise HTTPException(400, f"Expected {SAMPLE_RATE} Hz audio, got {sr} Hz")
    return torch.from_numpy(np.ascontiguousarray(audio)).unsqueeze(0)


def diarize(waveform: torch.Tensor, num_speakers: int) -> list:
    """Exclusive (non-overlapping) speaker turns, speakers numbered 0, 1, … by first appearance."""
    kwargs = {"num_speakers": num_speakers} if num_speakers > 0 else {}
    lock = RUN_LOCK if DEVICE != "cpu" else contextlib.nullcontext()
    with lock:
        try:
            out = pipeline({"waveform": waveform, "sample_rate": SAMPLE_RATE}, **kwargs)
        except torch.cuda.OutOfMemoryError:
            log.warning("GPU out of memory; retrying this recording on the CPU")
            torch.cuda.empty_cache()
            pipeline.to(torch.device("cpu"))
            try:
                out = pipeline({"waveform": waveform, "sample_rate": SAMPLE_RATE}, **kwargs)
            finally:
                pipeline.to(torch.device(DEVICE))
        finally:
            if DEVICE.startswith("cuda"):
                torch.cuda.empty_cache()

    annotation = getattr(out, "exclusive_speaker_diarization", None) or getattr(out, "speaker_diarization", out)
    index, turns = {}, []
    for segment, _, label in annotation.itertracks(yield_label=True):
        speaker = index.setdefault(label, len(index))
        start, end = round(float(segment.start), 3), round(float(segment.end), 3)
        # Merge a speaker's consecutive segments separated only by a short pause
        if turns and turns[-1]["speaker"] == speaker and start - turns[-1]["end"] < 0.5:
            turns[-1]["end"] = end
        else:
            turns.append({"speaker": speaker, "start": start, "end": end, "text": ""})
    return turns


app = FastAPI(title="EchoScribe local speech service", version="2.0.0")


@app.on_event("startup")
async def startup():
    await run_in_threadpool(load_pipeline)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "models_loaded": pipeline is not None,
        "diarizer": MODEL_ID,
        "device": DEVICE,
        "error": load_error,
        **gpu_info(),
    }


@app.post("/diarize")
async def diarize_endpoint(audio: UploadFile = File(...), num_speakers: int = Form(default=2)):
    if pipeline is None:
        raise HTTPException(503, f"Diarization model not loaded: {load_error or 'starting up'}")
    waveform = read_wav(await audio.read())
    try:
        turns = await run_in_threadpool(diarize, waveform, num_speakers)
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Diarization failed: {e}")
        raise HTTPException(500, f"Diarization failed: {e}")
    log.info(f"Diarized {waveform.shape[1] / SAMPLE_RATE:.0f} s into {len(turns)} turns")
    return JSONResponse({"turns": turns, "num_speakers": num_speakers, "model": MODEL_ID})


if __name__ == "__main__":
    port = int(os.environ.get("SPEECH_SERVICE_PORT", "5050"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
