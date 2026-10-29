"""eval/score_primock57.py — speech scores on the PriMock57 consultations (real conversational speech,
single-microphone mix of the clinician and patient channels).

  WER    Whisper (Groq) transcript vs. the reference utterances, same normalisation as score_audio.py
  DER    pyannote community-1 turns, 0.25 s collar, overlap scored (as score_audio.py)
  cpWER  speaker-attributed WER: words placed by Whisper timestamp (as the app) and, for comparison,
         spread over the turns by duration
  roles  clinician named by the eight-statistics rule (eval/primock57_roles.js)
Helper functions are taken from score_audio.py so the metrics are identical.
Writes eval/results/primock57_scores.json."""
import ast
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
R = ROOT / "results"
DATA = ROOT / "data" / "primock57" / "prepared"

# Load only the imports and function definitions of score_audio.py (its module body scores the other study)
src = (ROOT / "score_audio.py").read_text(encoding="utf-8")
tree = ast.parse(src)
keep = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom, ast.FunctionDef))]
helpers = {}
exec(compile(ast.Module(body=keep, type_ignores=[]), "score_audio_helpers", "exec"), helpers)
wer_counts, cpwer, der, align, assign_words = (helpers[k] for k in ("wer_counts", "cpwer", "der", "align", "assign_words"))


def read(name):
    p = R / name
    return {json.loads(l)["id"]: json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()} if p.exists() else {}


def wilson(k, n, z=1.96):
    if not n:
        return None
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return [round((c - h) / d, 4), round((c + h) / d, 4)]


diar, words = read("primock57_diar.jsonl"), read("primock57_words.jsonl")
roles = read("primock57_roles.jsonl")
per = []
for cid in sorted(diar):
    ref = json.loads((DATA / f"{cid}.json").read_text(encoding="utf-8"))
    row = {"id": cid, "duration": ref["duration"], "der": der(ref["turns"], diar[cid]["turns"], cid),
           "diar_s_per_min": diar[cid]["seconds"] / diar[cid]["duration"] * 60}
    w = words.get(cid)
    if w:
        e, n = wer_counts(" ".join(t["text"] for t in ref["turns"]), w["text"])
        row.update(wer_err=e, wer_n=n,
                   cpwer_words=cpwer(ref["turns"], assign_words(w["words"], diar[cid]["turns"])),
                   cpwer_duration=cpwer(ref["turns"], align(w["text"], diar[cid]["turns"])))
    per.append(row)


def mean(key):
    xs = [r[key] for r in per if key in r and r[key] is not None]
    return round(sum(xs) / len(xs), 4) if xs else None


with_words = [r for r in per if "wer_err" in r]
k = sum(1 for r in roles.values() if r["correct"])
summary = {
    "consultations": len(per), "with_transcript": len(with_words),
    "hours": round(sum(r["duration"] for r in per) / 3600, 2),
    "der": mean("der"),
    "wer": round(sum(r["wer_err"] for r in with_words) / max(1, sum(r["wer_n"] for r in with_words)), 4) if with_words else None,
    "cpwer_words": mean("cpwer_words"), "cpwer_duration": mean("cpwer_duration"),
    "diar_gpu_s_per_audio_min": mean("diar_s_per_min"),
    "roles": {"n": len(roles), "correct": k, "accuracy": round(k / len(roles), 4) if roles else None, "ci95": wilson(k, len(roles))},
}
(R / "primock57_scores.json").write_text(json.dumps({"summary": summary, "per_consultation": per}, indent=1), encoding="utf-8")
print(json.dumps(summary, indent=1))
