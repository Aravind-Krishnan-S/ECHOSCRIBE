"""eval/primock57_prepare.py — real spoken consultations for the speech evaluation.

PriMock57 (Papadopoulos Korfiatis et al., ACL 2022; CC BY 4.0): 57 mock primary-care consultations
recorded with the clinician and the patient on separate channels, utterance-level TextGrid
transcripts and the clinician's own notes. EchoScribe gets one microphone, so the two channels are
summed into one 16 kHz mono recording; the per-channel TextGrids give exact reference turns.

Usage: eval/.venv/Scripts/python -I eval/primock57_prepare.py
Writes eval/data/primock57/prepared/<id>.wav and <id>.json
  {id, duration, turns: [{speaker: "Doctor"|"Patient", start, end, text}], transcript, note}."""
import json
import re
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent / "data" / "primock57"
OUT = ROOT / "prepared"
OUT.mkdir(exist_ok=True)


def clean(text):
    """Drop annotation tags (<UNIN/>, <INAUDIBLE/>, …) but keep the words inside <UNSURE>…</UNSURE>."""
    text = re.sub(r"<[^>]*/>", " ", text)
    text = re.sub(r"</?[A-Za-z_]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def read_textgrid(path, speaker):
    """Non-empty intervals of a single-tier Praat TextGrid as turns."""
    content = path.read_text(encoding="utf-8")
    turns = []
    for xmin, xmax, text in re.findall(r'xmin = ([\d.]+)\s*\n\s*xmax = ([\d.]+)\s*\n\s*text = "((?:[^"]|"")*)"', content):
        t = clean(text.replace('""', '"'))
        if t:
            turns.append({"speaker": speaker, "start": round(float(xmin), 3), "end": round(float(xmax), 3), "text": t})
    return turns


ids = sorted(p.stem.replace("_doctor", "") for p in (ROOT / "audio").glob("*_doctor.wav"))
total = 0.0
for cid in ids:
    doc, sr1 = sf.read(ROOT / "audio" / f"{cid}_doctor.wav", dtype="float32")
    pat, sr2 = sf.read(ROOT / "audio" / f"{cid}_patient.wav", dtype="float32")
    assert sr1 == sr2 == 16000, (cid, sr1, sr2)
    n = max(len(doc), len(pat))
    mix = np.zeros(n, dtype=np.float32)
    mix[:len(doc)] += doc
    mix[:len(pat)] += pat
    peak = float(np.abs(mix).max()) or 1.0
    if peak > 0.99:
        mix *= 0.99 / peak
    sf.write(OUT / f"{cid}.wav", mix, 16000, subtype="PCM_16")

    turns = read_textgrid(ROOT / "transcripts" / f"{cid}_doctor.TextGrid", "Doctor") + \
        read_textgrid(ROOT / "transcripts" / f"{cid}_patient.TextGrid", "Patient")
    turns.sort(key=lambda t: t["start"])
    note = json.loads((ROOT / "notes" / f"{cid}.json").read_text(encoding="utf-8"))
    (OUT / f"{cid}.json").write_text(json.dumps({
        "id": cid, "duration": round(n / 16000, 2), "turns": turns,
        "transcript": "\n".join(f"{t['speaker']}: {t['text']}" for t in turns),
        "note": note.get("note", ""), "presenting_complaint": note.get("presenting_complaint", ""),
    }, indent=1), encoding="utf-8")
    total += n / 16000

print(f"prepared {len(ids)} consultations, {total / 3600:.2f} h of audio "
      f"(mean {total / len(ids) / 60:.1f} min)")
