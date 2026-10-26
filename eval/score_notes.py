"""eval/score_notes.py — score E2/E3/E4.

E2  note quality: ROUGE-1/2/L (stemmed) and BERTScore F1 (roberta-large, baseline-rescaled) of each writer's
    SOAP note against the ACI-Bench reference note.
E3  grounding: sentences per note, citation coverage, verifier labels; the verification-gated cascade
    (gate 0.2) computed from the two writers' runs: if the first writer's note exceeds the gate, the
    other writer's note is kept when it has fewer unsupported sentences.
    Planted-error detection (eval/results/injection_*.jsonl): recall per perturbation type and the
    false-alarm rate on unchanged control sentences, with Wilson 95% intervals.
E4  role identification accuracy (eval/results/role_accuracy.jsonl).
Writes eval/results/note_scores.json and prints the tables.
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "results"
GATE = 0.2


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


out = {}
writers = {w: {r["file"]: r for r in load(f"aci_notes_{w}.jsonl")} for w in ("gemini", "groq")}

# ── E2: ROUGE + BERTScore ──
skip_bert = "--no-bert" in sys.argv
from rouge_score import rouge_scorer  # noqa: E402

scorer = rouge_scorer.RougeScorer(["rouge1", "rouge2", "rougeLsum"], use_stemmer=True)
e2 = {}
for w, notes in writers.items():
    if not notes:
        continue
    files = sorted(notes)
    preds = [notes[f]["note_text"].replace(". ", ".\n") for f in files]
    refs = [notes[f]["reference"] for f in files]
    r = [scorer.score(ref, pred) for ref, pred in zip(refs, preds)]
    row = {
        "n": len(files),
        "rouge1": mean([x["rouge1"].fmeasure for x in r]),
        "rouge2": mean([x["rouge2"].fmeasure for x in r]),
        "rougeLsum": mean([x["rougeLsum"].fmeasure for x in r]),
        "seconds_per_note": mean([notes[f]["seconds"] for f in files]),
        "writer": notes[files[0]]["writer"],
    }
    if not skip_bert:
        from bert_score import score as bscore
        _, _, f1 = bscore(preds, refs, lang="en", rescale_with_baseline=True, verbose=False)
        row["bertscore_f1"] = round(float(f1.mean()), 4)
    e2[w] = row
out["E2_note_quality"] = e2

# ── E3: grounding and cascade ──
e3 = {}
for w, notes in writers.items():
    if not notes:
        continue
    s = [n["summary"] for n in notes.values() if n.get("summary")]
    tot = lambda k: sum(x[k] for x in s)
    n = tot("statements")
    e3[w] = {
        "notes": len(s),
        "verifier": next(iter(notes.values()))["verifier"],
        "sentences_per_note": round(n / len(s), 1),
        "cited": round(tot("cited") / n, 4),
        "supported": round(tot("supported") / n, 4),
        "partial": round(tot("partial") / n, 4),
        "unsupported": round(tot("unsupported") / n, 4),
        "notes_over_gate": sum(1 for x in s if (x["unsupported_ratio"] or 0) > GATE),
        "mean_unsupported_ratio": mean([x["unsupported_ratio"] for x in s]),
    }
cascade = {}
for first, second in (("gemini", "groq"), ("groq", "gemini")):
    common = sorted(set(writers[first]) & set(writers[second]))
    if not common:
        continue
    before, after, escalated, switched = [], [], 0, 0
    for f in common:
        a = writers[first][f]["summary"]["unsupported_ratio"] or 0
        b = writers[second][f]["summary"]["unsupported_ratio"] or 0
        before.append(a)
        if a > GATE:
            escalated += 1
            if b < a:
                switched += 1
                after.append(b)
                continue
        after.append(a)
    cascade[f"{first}_first"] = {
        "notes": len(common), "escalated": escalated, "switched_writer": switched,
        "mean_unsupported_before": mean(before), "mean_unsupported_after": mean(after),
        "notes_over_gate_after": sum(1 for x in after if x > GATE),
    }
e3["cascade"] = cascade

inj = {}
for w in ("gemini", "groq"):
    rows = load(f"injection_{w}.jsonl")
    if not rows:
        continue
    items = [i for r in rows for i in r["items"]]
    res = {"notes": len(rows), "verifier": rows[0]["verifier"]}
    for kind in ("NUM", "NEG", "FAB"):
        k_items = [i for i in items if i["kind"] == kind]
        det = sum(1 for i in k_items if i["label"] in ("unsupported", "partial"))
        res[kind] = {"n": len(k_items), "detected": det, "recall": round(det / len(k_items), 3) if k_items else None, "ci95": wilson(det, len(k_items))}
    planted = [i for i in items if i["kind"] != "CONTROL"]
    det = sum(1 for i in planted if i["label"] in ("unsupported", "partial"))
    res["ALL_PLANTED"] = {"n": len(planted), "detected": det, "recall": round(det / len(planted), 3) if planted else None, "ci95": wilson(det, len(planted))}
    ctrl = [i for i in items if i["kind"] == "CONTROL"]
    fa = sum(1 for i in ctrl if i["label"] in ("unsupported", "partial"))
    res["CONTROL"] = {"n": len(ctrl), "false_alarms": fa, "rate": round(fa / len(ctrl), 3) if ctrl else None, "ci95": wilson(fa, len(ctrl))}
    inj[w] = res
e3["planted_errors"] = inj
out["E3_grounding"] = e3

# ── E4: roles ──
roles = load("role_accuracy.jsonl")
if roles:
    e4 = {"dialogues": len(roles)}
    for m in ("stats", "llm", "combined"):
        valid = [r for r in roles if r.get(m)]
        k = sum(1 for r in valid if r[m]["correct"])
        e4[m] = {"n": len(valid), "correct": k, "accuracy": round(k / len(valid), 3) if valid else None, "ci95": wilson(k, len(valid))}
    hard = [r for r in roles if r["patient_more_words"]]
    e4["patient_speaks_more"] = {m: sum(1 for r in hard if r.get(m) and r[m]["correct"]) for m in ("stats", "llm", "combined")}
    e4["patient_speaks_more"]["n"] = len(hard)
    out["E4_roles"] = e4

(ROOT / "note_scores.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
print(json.dumps(out, indent=1))
