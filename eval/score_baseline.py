"""eval/score_baseline.py — single-pass baseline vs evidence-linked notes (ACI-Bench test1).

Overlap with the reference notes (ROUGE, BERTScore; same settings as score_notes.py) and the
blinded full-transcript verification from eval/baseline_notes.js, with Wilson 95% intervals.
Writes eval/results/baseline_scores.json.   Usage: python eval/score_baseline.py [--no-bert]
"""

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "results"


def load(name):
    p = ROOT / name
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []


def wilson(k, n, z=1.96):
    if n == 0:
        return (None, None)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (round((c - r) / d, 3), round((c + r) / d, 3))


def mean(xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 4) if xs else None


base = {r["file"]: r for r in load("baseline_notes.jsonl")}
linked = {r["file"]: r for r in load("aci_notes_gemini.jsonl")}
files = sorted(set(base) & set(linked))
out = {"n_dialogues": len(files)}

from rouge_score import rouge_scorer  # noqa: E402

scorer = rouge_scorer.RougeScorer(["rouge1", "rouge2", "rougeLsum"], use_stemmer=True)
for name, notes in (("baseline", base), ("linked", linked)):
    preds = [notes[f]["note_text"].replace(". ", ".\n") for f in files]
    refs = [notes[f]["reference"] for f in files]
    r = [scorer.score(ref, pred) for ref, pred in zip(refs, preds)]
    row = {
        "rouge1": mean([x["rouge1"].fmeasure for x in r]),
        "rouge2": mean([x["rouge2"].fmeasure for x in r]),
        "rougeLsum": mean([x["rougeLsum"].fmeasure for x in r]),
        "writer": notes[files[0]]["writer"] if files else None,
    }
    if "--no-bert" not in sys.argv:
        from bert_score import score as bscore
        _, _, f1 = bscore(preds, refs, model_type="distilbert-base-uncased", lang="en", rescale_with_baseline=True, verbose=False)
        row["bertscore_f1"] = round(float(f1.mean()), 4)
    out[name] = row

verify = [v for v in load("baseline_verify.jsonl") if v["file"] in files]
out["verified_dialogues"] = len(verify)
out["judges"] = {}
for v in verify:
    out["judges"][v["judge"]] = out["judges"].get(v["judge"], 0) + 1
for name in ("baseline", "linked"):
    labels = [x for v in verify for x in v[name]]
    judged = [x for x in labels if x != "unverified"]
    n = len(judged)
    res = {"sentences": len(labels), "judged": n, "sentences_per_note": round(len(labels) / len(verify), 1) if verify else None}
    for lab in ("supported", "partial", "unsupported"):
        k = sum(1 for x in judged if x == lab)
        res[lab] = {"k": k, "rate": round(k / n, 4) if n else None, "ci95": wilson(k, n)}
    # Notes with at least one unsupported sentence
    per_note = [sum(1 for x in v[name] if x == "unsupported") for v in verify]
    res["notes_with_unsupported"] = {"k": sum(1 for c in per_note if c), "n": len(per_note)}
    out[name].update({"full_transcript_verification": res})

(ROOT / "baseline_scores.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
print(json.dumps(out, indent=1))
