"""eval/score_ablation.py — note-quality steps (eval/ablation_notes*.jsonl) and their held-out re-checks.

For each split present (test1, test2):
  stages    support after each pipeline step (as written with one fact per sentence → + repair → + two judges),
            pooled over sentences with Wilson 95% intervals, from the pipeline's own judge
  quality   ROUGE-1/2/L and BERTScore F1 of the final notes against the ACI-Bench reference notes
  recheck   the same final sentences judged again by a held-out judge (eval/results/recheck_<judge>_<split>.jsonl,
            judges: groq, openrouter): supported / partial / unsupported rates and agreement with the pipeline labels
Writes eval/results/ablation_scores.json.
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "results"
SPLITS = ("test1", "test2")
STAGES = ("verified", "repaired", "consensus")


def load(name):
    p = ROOT / name
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []


def wilson(k, n, z=1.96):
    if n == 0:
        return None
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return [round((c - r) / d, 4), round((c + r) / d, 4)]


def rate(k, n):
    return {"k": k, "n": n, "rate": round(k / n, 4) if n else None, "ci95": wilson(k, n)}


out = {}
for split in SPLITS:
    notes = load("ablation_notes.jsonl" if split == "test1" else f"ablation_notes_{split}.jsonl")
    if not notes:
        continue
    res = {"notes": len(notes)}

    stages = {}
    for st in STAGES:
        rows = [n["stages"][st] for n in notes if (n.get("stages") or {}).get(st)]
        total = sum(r["statements"] for r in rows)
        stages[st] = {
            "notes": len(rows),
            "sentences": total,
            "supported": rate(sum(r["supported"] for r in rows), total),
            "partial": rate(sum(r["partial"] for r in rows), total),
            "unsupported": rate(sum(r["unsupported"] for r in rows), total),
            "notes_with_unsupported": sum(1 for r in rows if r["unsupported"] > 0),
        }
    res["stages"] = stages
    res["repair"] = {
        "flagged": sum((n.get("repair") or {}).get("flagged", 0) for n in notes),
        "rewritten": sum((n.get("repair") or {}).get("rewritten", 0) for n in notes),
        "removed": sum((n.get("repair") or {}).get("removed", 0) for n in notes),
    }

    if "--no-bert" not in sys.argv:
        from rouge_score import rouge_scorer
        from bert_score import score as bscore
        sc = rouge_scorer.RougeScorer(["rouge1", "rouge2", "rougeLsum"], use_stemmer=True)
        preds = [n["note_text"].replace(". ", ".\n") for n in notes]
        refs = [n["reference"] for n in notes]
        r = [sc.score(ref, pred) for ref, pred in zip(refs, preds)]
        m = lambda k: round(sum(x[k].fmeasure for x in r) / len(r), 4)
        _, _, f1 = bscore(preds, refs, model_type="distilbert-base-uncased", lang="en", rescale_with_baseline=True, verbose=False)
        res["quality"] = {"rouge1": m("rouge1"), "rouge2": m("rouge2"), "rougeLsum": m("rougeLsum"), "bertscore_f1": round(float(f1.mean()), 4)}

    for judge in ("groq", "openrouter"):
        rows = load(f"recheck_{judge}_{split}.jsonl")
        if not rows:
            continue
        total = sum(r["sentences"] for r in rows)
        agree = sum(1 for r in rows for x in r["labels"] if x["recheck"] == x["pipeline"])
        flagged_by_pipeline = [x for r in rows for x in r["labels"] if x["pipeline"] in ("partial", "unsupported")]
        res[f"recheck_{judge}"] = {
            "notes": len(rows),
            "sentences": total,
            "supported": rate(sum(r["supported"] for r in rows), total),
            "partial": rate(sum(r["partial"] for r in rows), total),
            "unsupported": rate(sum(r["unsupported"] for r in rows), total),
            "agreement_with_pipeline": rate(agree, total),
            "pipeline_flagged_still_flagged": rate(sum(1 for x in flagged_by_pipeline if x["recheck"] in ("partial", "unsupported")), len(flagged_by_pipeline)),
            "judges": sorted({r["judge"] for r in rows}),
        }
    out[split] = res

(ROOT / "ablation_scores.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
for split, res in out.items():
    print(f"== {split}: {res['notes']} notes")
    for st, v in res["stages"].items():
        print(f"  {st:10s} {v['sentences']} sentences  supported {v['supported']['rate']:.3f} {v['supported']['ci95']}  unsupported {v['unsupported']['rate']:.3f}  notes with unsupported {v['notes_with_unsupported']}")
    print("  repair", res["repair"], "| quality", res.get("quality"))
    for k in res:
        if k.startswith("recheck_"):
            v = res[k]
            print(f"  {k}: {v['notes']} notes, supported {v['supported']['rate']}, unsupported {v['unsupported']['rate']}, agreement {v['agreement_with_pipeline']['rate']}")
