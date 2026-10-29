"""eval/primock57_diar.py — pyannote community-1 on the mixed PriMock57 consultations.

Uses the app's service code (src/python/speech_service.py) on the single-microphone mix made by
primock57_prepare.py. Run with the speech service's environment:
    src/python/.venv/Scripts/python eval/primock57_diar.py
Appends to eval/results/primock57_diar.jsonl (resumable)."""
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "primock57" / "prepared"
OUT = ROOT / "results" / "primock57_diar.jsonl"
sys.path.insert(0, str(ROOT.parent / "src" / "python"))
os.environ.setdefault("SPEECH_DEVICE", "cuda")

import speech_service as svc  # noqa: E402

done = set()
if OUT.exists():
    done = {json.loads(l)["id"] for l in OUT.read_text(encoding="utf-8").splitlines() if l.strip()}
svc.load_pipeline()
if svc.pipeline is None:
    sys.exit(f"pipeline not loaded: {svc.load_error}")
for wav in sorted(DATA.glob("*.wav")):
    if wav.stem in done:
        continue
    waveform = svc.read_wav(wav.read_bytes())
    t0 = time.perf_counter()
    turns = svc.diarize(waveform, 2)
    seconds = time.perf_counter() - t0
    row = {"id": wav.stem, "device": svc.DEVICE, "duration": waveform.shape[1] / svc.SAMPLE_RATE,
           "seconds": round(seconds, 2), "model": svc.MODEL_ID, "turns": turns}
    with OUT.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")
    print(f"{wav.stem} {seconds:6.1f}s {len(turns)} turns", flush=True)
