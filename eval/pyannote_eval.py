"""eval/pyannote_eval.py — speaker diarization with pyannote community-1 on the simulated conversations.

Uses the app's own service code (src/python/speech_service.py), on the original (not denoised)
recordings, and records the turns and the processing time per clip for each device.

Run with the speech service's environment:
    src/python/.venv/Scripts/python eval/pyannote_eval.py [cuda|cpu ...]
Appends to eval/results/pyannote_eval.jsonl (resumable: finished id/cond/device rows are skipped).
"""

import importlib
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONV = ROOT / "data" / "conversations"
OUT = ROOT / "results" / "pyannote_eval.jsonl"
sys.path.insert(0, str(ROOT.parent / "src" / "python"))

devices = sys.argv[1:] or ["cuda", "cpu"]
done = set()
if OUT.exists():
    for line in OUT.read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            done.add((r["id"], r["cond"], r["device"]))

clips = sorted(CONV.glob("conv*_*.wav"))
for device in devices:
    os.environ["SPEECH_DEVICE"] = device
    svc = importlib.reload(importlib.import_module("speech_service"))
    if svc.DEVICE != device and not svc.DEVICE.startswith(device):
        print(f"skip {device}: service picked {svc.DEVICE}")
        continue
    svc.load_pipeline()
    if svc.pipeline is None:
        sys.exit(f"pipeline not loaded: {svc.load_error}")
    for wav in clips:
        conv_id, cond = wav.stem.split("_", 1)
        if (conv_id, cond, device) in done:
            continue
        waveform = svc.read_wav(wav.read_bytes())
        if device == "cuda":
            import torch
            torch.cuda.synchronize()
        t0 = time.perf_counter()
        turns = svc.diarize(waveform, 2)
        seconds = time.perf_counter() - t0
        row = {"id": conv_id, "cond": cond, "device": svc.DEVICE, "gpu": svc.gpu_info().get("gpu"),
               "duration": waveform.shape[1] / svc.SAMPLE_RATE, "seconds": round(seconds, 3),
               "model": svc.MODEL_ID, "turns": turns}
        with OUT.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        print(f"{conv_id}_{cond:<5} {device:<4} {seconds:6.2f}s  {len(turns)} turns", flush=True)
