"""eval/verifier_agreement.py — agreement between two human raters and the independent verifier.

Reads eval/team_kit/verifier_agreement/{rater_A.csv, rater_B.csv, key.csv} (rater files are items.csv with
rater_label filled in) and reports Cohen's kappa for rater A vs B, each rater vs the verifier, and the
raters' consensus vs the verifier (items where the two raters disagree are excluded from the consensus
comparison and counted). Also reports kappa on a binary split (supported vs not), the decision a reviewer
acts on. Writes eval/results/verifier_agreement.json.
"""
import csv
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
KIT = ROOT / "team_kit" / "verifier_agreement"
LABELS = ("supported", "partial", "unsupported")


def read(path, column):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return {r["item_id"].strip(): r[column].strip().lower() for r in csv.DictReader(f)}


def kappa(a, b):
    """Cohen's kappa over paired label lists."""
    n = len(a)
    if n == 0:
        return None
    po = sum(x == y for x, y in zip(a, b)) / n
    ca, cb = Counter(a), Counter(b)
    pe = sum(ca[k] * cb[k] for k in set(ca) | set(cb)) / (n * n)
    return 1.0 if pe == 1 else round((po - pe) / (1 - pe), 3)


def summary(a, b):
    binary = lambda xs: ["supported" if x == "supported" else "not" for x in xs]
    return {"n": len(a), "agreement": round(sum(x == y for x, y in zip(a, b)) / len(a), 3) if a else None,
            "kappa": kappa(a, b), "kappa_binary": kappa(binary(a), binary(b))}


files = {name: KIT / f"rater_{name}.csv" for name in ("A", "B")}
missing = [str(p) for p in files.values() if not p.exists()]
if missing:
    sys.exit("Missing rater files: " + ", ".join(missing))

key = read(KIT / "key.csv", "verifier_label")
raters = {name: read(p, "rater_label") for name, p in files.items()}
for name, labels in raters.items():
    bad = {k: v for k, v in labels.items() if v not in LABELS}
    if bad:
        sys.exit(f"rater_{name}.csv has empty or unknown labels for: {', '.join(sorted(bad))}")

ids = sorted(set(key) & set(raters["A"]) & set(raters["B"]))
A = [raters["A"][i] for i in ids]
Bv = [raters["B"][i] for i in ids]
V = [key[i] for i in ids]
agreed = [k for k, (x, y) in enumerate(zip(A, Bv)) if x == y]

out = {
    "items": len(ids),
    "raters_A_vs_B": summary(A, Bv),
    "rater_A_vs_verifier": summary(A, V),
    "rater_B_vs_verifier": summary(Bv, V),
    "consensus_vs_verifier": {**summary([A[k] for k in agreed], [V[k] for k in agreed]), "items_where_raters_disagreed": len(ids) - len(agreed)},
    "confusion_consensus_rows_verifier_cols": {r: {c: sum(1 for k in agreed if A[k] == r and V[k] == c) for c in LABELS} for r in LABELS},
}
(ROOT / "results" / "verifier_agreement.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
for k, v in out.items():
    print(f"{k}: {v}")
