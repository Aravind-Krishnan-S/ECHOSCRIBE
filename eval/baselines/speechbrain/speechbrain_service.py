"""
EchoScribe — SpeechBrain Audio Processing Microservice
=====================================================
FastAPI server providing:
  1. Speech Enhancement (noise cancellation) via SepFormer
  2. Speaker Diarization via ECAPA-TDNN embeddings + spectral clustering

Runs on port 5050. Called by the Node.js backend.
Models are downloaded from HuggingFace on first run (~210MB total).
"""

import os
import io
import sys
import tempfile
import logging
import numpy as np
import soundfile as sf
import torch
import torchaudio

# ─── Torchaudio Compatibility Patch ───
# torchaudio 2.1+ removed list_audio_backends() and set_audio_backend()
# but SpeechBrain internally calls them. Monkey-patch to fix.
if not hasattr(torchaudio, 'list_audio_backends'):
    torchaudio.list_audio_backends = lambda: ['soundfile']
if not hasattr(torchaudio, 'set_audio_backend'):
    torchaudio.set_audio_backend = lambda backend: None

# ─── huggingface_hub Compatibility Patch ───
# huggingface_hub 1.0+ removed arguments SpeechBrain 1.0.x still passes to hf_hub_download()
# (use_auth_token, local_dir_use_symlinks, force_filename) and reports a missing file with its own
# exception instead of requests' HTTPError, which SpeechBrain expects when it probes for the
# optional custom.py. Adapt both directions before SpeechBrain imports the function.
import huggingface_hub
import requests
_hf_hub_download = huggingface_hub.hf_hub_download
def _hf_hub_download_compat(*args, use_auth_token=None, local_dir_use_symlinks=None, force_filename=None, **kwargs):
    if use_auth_token is not None and 'token' not in kwargs:
        kwargs['token'] = use_auth_token if use_auth_token is not True else None
    try:
        return _hf_hub_download(*args, **kwargs)
    except Exception as e:
        if type(e).__name__ in ('EntryNotFoundError', 'RemoteEntryNotFoundError') or '404' in str(e):
            raise requests.exceptions.HTTPError(f"404 Client Error: {e}") from e
        raise
huggingface_hub.hf_hub_download = _hf_hub_download_compat
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from scipy.signal import resample
from sklearn.cluster import SpectralClustering

# ─── Logging ───
logging.basicConfig(level=logging.INFO, format="[SpeechBrain] %(levelname)s %(message)s")
log = logging.getLogger("speechbrain_service")

# ─── FastAPI App ───
app = FastAPI(title="EchoScribe SpeechBrain Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── Global Model References ───
enhancer = None
speaker_model = None
MODELS_LOADED = False


def _pick_device() -> str:
    """SPEECHBRAIN_DEVICE=auto|cuda|cuda:N|mps|cpu. auto uses an NVIDIA GPU (CUDA build of torch),
    then Apple silicon (MPS), then the CPU."""
    want = os.environ.get("SPEECHBRAIN_DEVICE", "auto").strip().lower()
    if want.startswith("cuda"):
        if torch.cuda.is_available():
            return want
        log.warning("SPEECHBRAIN_DEVICE=%s but CUDA is not available (CPU-only torch build or no NVIDIA driver); using CPU", want)
        return "cpu"
    if want == "mps":
        return "mps" if torch.backends.mps.is_available() else "cpu"
    if want == "cpu":
        return "cpu"
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


DEVICE = _pick_device()
ON_GPU = DEVICE != "cpu"
# Speaker-embedding windows scored per forward pass: batching is what makes the GPU pay off.
# On the CPU the default stays 1, so CPU results and timings match the paper's measurements.
EMBED_BATCH = int(os.environ.get("EMBED_BATCH", "64" if ON_GPU else "1"))


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


# One model pass at a time on a GPU: concurrent requests would otherwise each allocate a full window
import threading
GPU_LOCK = threading.Lock() if ON_GPU else None


def _gpu_guard():
    import contextlib
    return GPU_LOCK if GPU_LOCK is not None else contextlib.nullcontext()


def release_gpu_memory():
    if DEVICE.startswith("cuda"):
        torch.cuda.empty_cache()


# Checkpoints stay where the app used to keep them, so the baseline reproduces with the same weights
MODEL_DIR = os.environ.get("SPEECHBRAIN_MODEL_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "..", "src", "python", "pretrained_models"))

# ─── Model Loading ───

def load_models():
    """Load SpeechBrain models. Called once at startup."""
    global enhancer, speaker_model, MODELS_LOADED

    info = gpu_info()
    log.info(f"Loading models on device: {DEVICE}" + (f" ({info['gpu']}, {info['vram_total_mb']} MB, CUDA {info['cuda']})" if info else ""))
    os.makedirs(MODEL_DIR, exist_ok=True)

    try:
        # 1. Speech Enhancement — SepFormer (WHAM! 16kHz)
        from speechbrain.inference.separation import SepformerSeparation
        enhancer = SepformerSeparation.from_hparams(
            source="speechbrain/sepformer-wham16k-enhancement",
            savedir=os.path.join(MODEL_DIR, "sepformer-enhance"),
            run_opts={"device": DEVICE}
        )
        log.info("✅ SepFormer enhancement model loaded")
    except Exception as e:
        log.error(f"❌ Failed to load SepFormer: {e}")
        enhancer = None

    try:
        # 2. Speaker Embeddings — ECAPA-TDNN (VoxCeleb)
        from speechbrain.inference.speaker import EncoderClassifier
        speaker_model = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=os.path.join(MODEL_DIR, "ecapa-tdnn"),
            run_opts={"device": DEVICE}
        )
        log.info("✅ ECAPA-TDNN speaker model loaded")
    except Exception as e:
        log.error(f"❌ Failed to load ECAPA-TDNN: {e}")
        speaker_model = None

    MODELS_LOADED = (enhancer is not None) or (speaker_model is not None)
    log.info(f"Models loaded: enhance={enhancer is not None}, diarize={speaker_model is not None}")


# ─── Audio Utilities ───

def load_audio(file_bytes: bytes, target_sr: int = 16000) -> tuple:
    """Load audio from bytes, convert to mono 16kHz float32 tensor."""
    # Write to temp file for torchaudio
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        waveform, sr = torchaudio.load(tmp_path)
    except Exception:
        # Fallback: try soundfile
        data, sr = sf.read(io.BytesIO(file_bytes), dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        waveform = torch.from_numpy(data).unsqueeze(0)
    finally:
        os.unlink(tmp_path)

    # Convert to mono
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)

    # Resample to target
    if sr != target_sr:
        waveform = torchaudio.functional.resample(waveform, sr, target_sr)

    return waveform, target_sr


def tensor_to_wav_bytes(waveform: torch.Tensor, sr: int = 16000) -> bytes:
    """Convert a 1D or 2D tensor to WAV bytes."""
    if waveform.dim() == 1:
        data = waveform.cpu().numpy()
    else:
        data = waveform.cpu().numpy().T
    buf = io.BytesIO()
    sf.write(buf, data, sr, format="wav")
    buf.seek(0)
    return buf.read()


# ─── Speech Enhancement ───

ENHANCE_WINDOW_SEC = float(os.environ.get("ENHANCE_WINDOW_SEC", "10"))
ENHANCE_OVERLAP_SEC = 0.5


def _separate(chunk: torch.Tensor) -> torch.Tensor:
    """One SepFormer pass on a [1, time] chunk; returns [time] clean speech.
    If the GPU runs out of memory, the chunk is split in half and each half retried."""
    try:
        with _gpu_guard(), torch.no_grad():
            out = enhancer.separate_batch(chunk.to(DEVICE))
            # SepFormer returns [batch, time, sources] — take the first source (clean speech)
            if out.dim() == 3:
                out = out[:, :, 0]
            elif out.dim() == 4:
                out = out[:, :, 0, 0]
        return out[0, :chunk.shape[1]].cpu()
    except torch.cuda.OutOfMemoryError:
        release_gpu_memory()
        half = chunk.shape[1] // 2
        if half < 2 * 16000:
            raise
        log.warning(f"GPU out of memory on a {chunk.shape[1] / 16000:.1f} s window; splitting it in two")
        return torch.cat([_separate(chunk[:, :half]), _separate(chunk[:, half:])])


def enhance_audio(waveform: torch.Tensor, sr: int = 16000) -> torch.Tensor:
    """Remove noise with SepFormer, in short overlapping windows.

    Running the whole recording as one tensor makes memory grow with its length (a 72 s clip
    exhausted 16 GB of RAM); fixed windows with a linear crossfade keep memory bounded and time
    linear in the recording length, so long local sessions can be enhanced.
    """
    if enhancer is None:
        log.warning("Enhancer not loaded, returning original audio")
        return waveform

    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)
    total = waveform.shape[1]
    win = int(ENHANCE_WINDOW_SEC * sr)
    ov = int(ENHANCE_OVERLAP_SEC * sr)
    if total <= win + ov:
        return _separate(waveform).unsqueeze(0)

    out = torch.zeros(total)
    weight = torch.zeros(total)
    fade_in = torch.linspace(0.0, 1.0, ov) if ov > 0 else None
    start = 0
    while start < total:
        end = min(total, start + win + ov)
        piece = _separate(waveform[:, start:end])
        w = torch.ones(piece.shape[0])
        if ov > 0 and start > 0:
            n = min(ov, piece.shape[0])
            w[:n] = fade_in[:n]
        if ov > 0 and end < total:
            n = min(ov, piece.shape[0])
            w[-n:] = torch.flip(fade_in[:n], dims=[0])
        out[start:end] += piece * w
        weight[start:end] += w
        if end >= total:
            break
        start += win
    return (out / weight.clamp(min=1e-6)).unsqueeze(0)


# ─── Speaker Diarization ───

def _embed(windows: list) -> list:
    """ECAPA-TDNN embeddings for equal-length windows, one forward pass per batch."""
    with _gpu_guard(), torch.no_grad():
        emb = speaker_model.encode_batch(torch.stack(windows).to(DEVICE))
    return [e.squeeze().cpu().numpy() for e in emb]


def diarize_audio(waveform: torch.Tensor, sr: int = 16000, num_speakers: int = 2,
                  window_sec: float = 1.5, hop_sec: float = 0.75) -> list:
    """
    Diarize audio using ECAPA-TDNN embeddings + spectral clustering.
    
    Strategy:
      1. Segment audio into overlapping windows
      2. Extract ECAPA-TDNN embedding for each window
      3. Spectral clustering with k=num_speakers
      4. Merge adjacent same-speaker segments
    
    Returns list of: {speaker: int, start: float, end: float, text: ""}
    """
    if speaker_model is None:
        log.warning("Speaker model not loaded, returning single-speaker segment")
        duration = waveform.shape[-1] / sr
        return [{"speaker": 0, "start": 0.0, "end": duration, "text": ""}]

    # Segment into windows
    window_samples = int(window_sec * sr)
    hop_samples = int(hop_sec * sr)
    total_samples = waveform.shape[-1]

    if waveform.dim() == 2:
        waveform_1d = waveform.squeeze(0)
    else:
        waveform_1d = waveform

    segments = []
    embeddings = []
    batch = []
    pos = 0

    while pos < total_samples:
        end = min(pos + window_samples, total_samples)
        segment = waveform_1d[pos:end]

        # Pad if too short (< 0.5s)
        if segment.shape[0] < int(0.5 * sr):
            break

        # Pad to window size if needed
        if segment.shape[0] < window_samples:
            segment = torch.nn.functional.pad(segment, (0, window_samples - segment.shape[0]))

        segments.append({
            "start": pos / sr,
            "end": min(end, total_samples) / sr
        })
        batch.append(segment)
        if len(batch) >= EMBED_BATCH:
            embeddings.extend(_embed(batch))
            batch = []

        pos += hop_samples

    if batch:
        embeddings.extend(_embed(batch))

    if len(segments) < 2:
        duration = total_samples / sr
        return [{"speaker": 0, "start": 0.0, "end": duration, "text": ""}]

    # Stack embeddings and cluster
    emb_matrix = np.stack(embeddings)

    # Normalize embeddings
    norms = np.linalg.norm(emb_matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1
    emb_matrix = emb_matrix / norms

    # Spectral clustering
    n_clusters = min(num_speakers, len(segments))
    try:
        clustering = SpectralClustering(
            n_clusters=n_clusters,
            affinity="cosine",
            random_state=42,
            n_init=10
        )
        labels = clustering.fit_predict(emb_matrix)
    except Exception as e:
        log.error(f"Clustering failed: {e}")
        # Fallback: simple cosine similarity threshold
        from sklearn.cluster import KMeans
        clustering = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        labels = clustering.fit_predict(emb_matrix)

    # Assign labels to segments
    for i, seg in enumerate(segments):
        seg["speaker"] = int(labels[i])

    # Merge adjacent same-speaker segments
    merged = []
    for seg in segments:
        if merged and merged[-1]["speaker"] == seg["speaker"]:
            merged[-1]["end"] = seg["end"]
        else:
            merged.append({
                "speaker": seg["speaker"],
                "start": round(seg["start"], 3),
                "end": round(seg["end"], 3),
                "text": ""  # Will be filled by transcription
            })

    log.info(f"Diarization: {len(merged)} turns, {n_clusters} speakers from {len(segments)} segments")
    return merged


# ─── API Endpoints ───

@app.middleware("http")
async def free_gpu_after_request(request, call_next):
    try:
        return await call_next(request)
    finally:
        release_gpu_memory()


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "models_loaded": MODELS_LOADED,
        "enhancer": enhancer is not None,
        "speaker_model": speaker_model is not None,
        "device": DEVICE,
        **gpu_info(),
    }


@app.post("/enhance")
async def enhance_endpoint(audio: UploadFile = File(...)):
    """Noise cancellation — returns enhanced WAV audio."""
    if enhancer is None:
        raise HTTPException(503, "Speech enhancement model not loaded")

    try:
        file_bytes = await audio.read()
        waveform, sr = load_audio(file_bytes, target_sr=16000)
        # Model work runs in a worker thread so /health keeps answering during long jobs
        enhanced = await run_in_threadpool(enhance_audio, waveform, sr)
        wav_bytes = tensor_to_wav_bytes(enhanced, sr)

        return StreamingResponse(
            io.BytesIO(wav_bytes),
            media_type="audio/wav",
            headers={"X-Enhanced": "true", "X-Sample-Rate": str(sr)}
        )
    except Exception as e:
        log.error(f"Enhancement error: {e}")
        raise HTTPException(500, f"Enhancement failed: {str(e)}")


@app.post("/diarize")
async def diarize_endpoint(
    audio: UploadFile = File(...),
    num_speakers: int = Form(default=2)
):
    """Speaker diarization — returns speaker turns with timestamps."""
    if speaker_model is None:
        raise HTTPException(503, "Speaker diarization model not loaded")

    try:
        file_bytes = await audio.read()
        waveform, sr = load_audio(file_bytes, target_sr=16000)
        turns = await run_in_threadpool(diarize_audio, waveform, sr, num_speakers=num_speakers)
        return JSONResponse({"turns": turns, "num_speakers": num_speakers})
    except Exception as e:
        log.error(f"Diarization error: {e}")
        raise HTTPException(500, f"Diarization failed: {str(e)}")


@app.post("/process")
async def process_endpoint(
    audio: UploadFile = File(...),
    num_speakers: int = Form(default=2)
):
    """
    Combined pipeline: enhance → diarize.
    Returns enhanced audio (base64) + diarization turns.
    """
    import base64

    try:
        file_bytes = await audio.read()
        waveform, sr = load_audio(file_bytes, target_sr=16000)

        # Step 1: Enhance (if available)
        if enhancer is not None:
            log.info("Step 1/2: Enhancing audio...")
            enhanced = await run_in_threadpool(enhance_audio, waveform, sr)
        else:
            log.info("Step 1/2: Enhancer unavailable, using original audio")
            enhanced = waveform

        # Step 2: Diarize
        log.info("Step 2/2: Diarizing speakers...")
        turns = await run_in_threadpool(diarize_audio, enhanced, sr, num_speakers=num_speakers)

        # Encode enhanced audio as base64 WAV
        wav_bytes = tensor_to_wav_bytes(enhanced, sr)
        audio_b64 = base64.b64encode(wav_bytes).decode("utf-8")

        return JSONResponse({
            "enhanced_audio_b64": audio_b64,
            "enhanced_audio_format": "wav",
            "sample_rate": sr,
            "turns": turns,
            "num_speakers": num_speakers,
            "enhanced": enhancer is not None,
            "_provider": "SpeechBrain"
        })
    except Exception as e:
        log.error(f"Process error: {e}")
        raise HTTPException(500, f"Processing failed: {str(e)}")


# ─── Startup ───

@app.on_event("startup")
async def startup():
    log.info("Starting SpeechBrain service...")
    load_models()
    log.info("SpeechBrain service ready!")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("SPEECHBRAIN_PORT", 5050))
    log.info(f"Starting SpeechBrain service on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
