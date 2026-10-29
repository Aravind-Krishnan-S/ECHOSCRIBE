"""eval/score_audio.py — score E5/E6 (eval/results/audio_eval.jsonl) against the reference conversations.

Metrics
  WER    speaker-agnostic word error rate of each transcript (jiwer, normalised text, digits spelled out)
  DER    diarization error rate of the SpeechBrain turns, 0.25 s collar (pyannote.metrics)
  cpWER  concatenated minimum-permutation WER (CHiME-6): per-speaker text against per-speaker reference,
         best of the two speaker assignments. Scores every speaker-separation path, timed or not.
For the SpeechBrain path the transcript is split over its turns in proportion to turn length, exactly as
the pipeline does (alignTranscriptToTurns in src/controllers/transcribe.controller.js).

Writes eval/results/audio_scores.json and prints the tables.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

import jiwer
from num2words import num2words
from pyannote.core import Annotation, Segment
from pyannote.metrics.diarization import DiarizationErrorRate

ROOT = Path(__file__).resolve().parent
CONV = ROOT / "data" / "conversations"
rows = [json.loads(l) for l in (ROOT / "results" / "audio_eval.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]


def normalise(text):
    text = (text or "").lower()
    text = re.sub(r"\[inaudible\]", " ", text)
    text = re.sub(r"(\d+)(st|nd|rd|th)\b", lambda m: num2words(int(m.group(1)), to="ordinal"), text)
    text = re.sub(r"\d+", lambda m: num2words(int(m.group(0))), text)
    text = text.replace("-", " ").replace("'", "")
    text = re.sub(r"[^a-z ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def wer_counts(ref, hyp):
    ref, hyp = normalise(ref), normalise(hyp)
    if not ref:
        return 0, 0
    out = jiwer.process_words(ref, hyp if hyp else "")
    return out.substitutions + out.deletions + out.insertions, len(ref.split())


def align(text, turns):
    """Proportional split of a flat transcript over timed turns (mirrors the Node pipeline)."""
    words = (text or "").split()
    if not words or not turns:
        return []
    total = sum(max(t["end"] - t["start"], 0.1) for t in turns)
    out, idx = [], 0
    for t in turns:
        share = max(t["end"] - t["start"], 0.1) / total
        n = max(1, round(share * len(words)))
        out.append({"speaker": str(t["speaker"]), "text": " ".join(words[idx:idx + n])})
        idx += n
    if idx < len(words):
        out[-1]["text"] += " " + " ".join(words[idx:])
    return out


def cpwer(ref_turns, hyp_turns):
    ref = defaultdict(str)
    for t in ref_turns:
        ref[t["speaker"]] += " " + t["text"]
    hyp = defaultdict(str)
    for t in hyp_turns or []:
        hyp[str(t["speaker"])] += " " + (t.get("text") or "")
    rs = sorted(ref)
    hs = sorted(hyp, key=lambda s: -len(hyp[s]))[:2] + ["__none__", "__none__"]
    best = None
    for perm in ([hs[0], hs[1]], [hs[1], hs[0]]):
        e = n = 0
        for r, h in zip(rs, perm):
            de, dn = wer_counts(ref[r], hyp.get(h, ""))
            e, n = e + de, n + dn
        # words the hypothesis gave to a third cluster count as deletions already (not in either string)
        best = e / n if best is None else min(best, e / n)
    return best


def der(ref_turns, hyp_turns, uri):
    ref, hyp = Annotation(uri=uri), Annotation(uri=uri)
    for t in ref_turns:
        ref[Segment(t["start"], t["end"])] = t["speaker"]
    for t in hyp_turns or []:
        if t["end"] > t["start"]:
            hyp[Segment(t["start"], t["end"])] = str(t["speaker"])
    return DiarizationErrorRate(collar=0.25, skip_overlap=False)(ref, hyp)


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def assign_words(words, turns):
    """Word-timestamp attribution, as in src/services/alignment.js: each word goes to the turn
    containing its midpoint, or the nearer turn when it falls in a gap."""
    turns = sorted(({**t, "text": ""} for t in turns), key=lambda t: t["start"])
    buckets = [[] for _ in turns]
    i = 0
    for w in words:
        text = str(w.get("word", "")).strip()
        if not text:
            continue
        mid = (float(w["start"]) + float(w.get("end", w["start"]))) / 2
        while i < len(turns) - 1 and turns[i]["end"] < mid and turns[i + 1]["start"] <= mid:
            i += 1
        k = i
        if i + 1 < len(turns) and mid > turns[i]["end"] and turns[i + 1]["start"] - mid < mid - turns[i]["end"]:
            k = i + 1
        buckets[k].append(text)
    out = []
    for t, b in zip(turns, buckets):
        if not b:
            continue
        if out and out[-1]["speaker"] == t["speaker"]:
            out[-1]["text"] += " " + " ".join(b)
            out[-1]["end"] = t["end"]
        else:
            out.append({**t, "text": " ".join(b)})
    return out


# Whisper (Groq) transcripts with word timestamps, from eval/stt_words.js
WORDS = {}
words_file = ROOT / "results" / "stt_words.jsonl"
if words_file.exists():
    for line in words_file.read_text(encoding="utf-8").splitlines():
        if line.strip():
            w = json.loads(line)
            WORDS[(w["id"], w["cond"])] = w

# pyannote community-1 (the current app), run by eval/pyannote_eval.py on the original recordings
PYA = {}
pya_file = ROOT / "results" / "pyannote_eval.jsonl"
if pya_file.exists():
    for line in pya_file.read_text(encoding="utf-8").splitlines():
        if line.strip():
            p = json.loads(line)
            PYA.setdefault((p["id"], p["cond"]), {})["gpu" if p["device"].startswith("cuda") else "cpu"] = p

results = defaultdict(lambda: defaultdict(list))
per_clip = defaultdict(lambda: defaultdict(dict))  # cond -> metric -> clip id -> value (for eval/significance.py)
latency = defaultdict(list)


def add(cond, metric, clip, value):
    results[cond][metric].append(value)
    per_clip[cond][metric][clip] = value


for r in rows:
    meta = json.loads((CONV / f"{r['id']}.json").read_text(encoding="utf-8"))
    ref_text = " ".join(t["text"] for t in meta["turns"])
    c = r["cond"]
    for k in ("gemini_raw", "groq_raw", "gemini_enh", "groq_enh"):
        if r["stt"].get(k):
            e, n = wer_counts(ref_text, r["stt"][k])
            add(c, f"WER {k}", r["id"], e / n)
    if r.get("sb_raw"):
        add(c, "DER speechbrain_raw", r["id"], der(meta["turns"], r["sb_raw"], r["id"]))
        if r["stt"].get("gemini_raw"):
            add(c, "cpWER speechbrain_raw+gemini", r["id"], cpwer(meta["turns"], align(r["stt"]["gemini_raw"], r["sb_raw"])))
        w = WORDS.get((r["id"], c))
        if w and w["words"]:
            add(c, "cpWER speechbrain_raw+groq_words", r["id"], cpwer(meta["turns"], assign_words(w["words"], r["sb_raw"])))
        if r["stt"].get("groq_raw"):
            add(c, "cpWER speechbrain_raw+groq", r["id"], cpwer(meta["turns"], align(r["stt"]["groq_raw"], r["sb_raw"])))
    if r.get("sb_enh"):
        add(c, "DER speechbrain_enh", r["id"], der(meta["turns"], r["sb_enh"], r["id"]))
        if r["stt"].get("gemini_enh"):
            add(c, "cpWER speechbrain_enh+gemini_enh", r["id"], cpwer(meta["turns"], align(r["stt"]["gemini_enh"], r["sb_enh"])))
    pya = PYA.get((r["id"], c), {})
    p = pya.get("gpu") or pya.get("cpu")
    if p:
        add(c, "DER pyannote", r["id"], der(meta["turns"], p["turns"], r["id"]))
        for k, name in (("gemini_raw", "gemini"), ("groq_raw", "groq")):
            if r["stt"].get(k):
                add(c, f"cpWER pyannote+{name}", r["id"], cpwer(meta["turns"], align(r["stt"][k], p["turns"])))
        w = WORDS.get((r["id"], c))
        if w and w["words"]:
            add(c, "cpWER pyannote+groq_words", r["id"], cpwer(meta["turns"], assign_words(w["words"], p["turns"])))
            add(c, "WER groq_words", r["id"], wer_counts(ref_text, w["text"])[0] / wer_counts(ref_text, w["text"])[1])
        for dev, row in pya.items():
            latency[f"pyannote_{dev}"].append(row["seconds"] / row["duration"] * 60)
    if r.get("gemini_diar"):
        add(c, "cpWER gemini_audio_diar", r["id"], cpwer(meta["turns"], r["gemini_diar"]))
    if r.get("text_diar"):
        add(c, "cpWER transcript_diar", r["id"], cpwer(meta["turns"], r["text_diar"]))
    for stage, s in r["seconds"].items():
        latency[stage].append(s / r["duration"] * 60)  # seconds of processing per minute of audio

summary = {c: {m: {"mean": round(mean(v), 4), "n": len(v)} for m, v in sorted(ms.items())} for c, ms in results.items()}
summary["latency_s_per_audio_min"] = {k: round(mean(v), 2) for k, v in latency.items()}
(ROOT / "results" / "audio_scores.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
(ROOT / "results" / "audio_per_clip.json").write_text(json.dumps(per_clip, indent=1), encoding="utf-8")

metrics = sorted({m for c in results for m in results[c]})
print(f"{'metric':40s}" + "".join(f"{c:>10s}" for c in ("clean", "snr5", "snr0")))
for m in metrics:
    print(f"{m:40s}" + "".join(f"{(mean(results[c][m]) or 0) * 100:9.1f}%" if results[c][m] else f"{'-':>10s}" for c in ("clean", "snr5", "snr0")))
print("\nprocessing seconds per minute of audio:", summary["latency_s_per_audio_min"])
