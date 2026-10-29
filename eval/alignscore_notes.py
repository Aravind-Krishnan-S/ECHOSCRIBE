"""eval/alignscore_notes.py — judge-independent factual consistency of generated notes (AlignScore).

AlignScore (Zha et al., ACL 2023; MIT): a RoBERTa alignment model trained on 4.7M examples from seven
tasks. context = the source transcript as the note writer saw it (role-labelled), claim = the note text;
nli_sp mode (chunk-sentence splitting, the metric's default). No AI API calls; runs locally.

Run with its own environment:
    eval/.venv-align/Scripts/python -I -W ignore eval/alignscore_notes.py [large|base]
Scores every note file present (resumable: already-scored ids are skipped), writes per-note scores to
eval/results/alignscore.jsonl and per-file means with bootstrap 95% CIs to alignscore_summary.json.
"""
import json
import os
import random
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RES = ROOT / "results"
OUT = RES / "alignscore.jsonl"
SUMMARY = RES / "alignscore_summary.json"
SIZE = (sys.argv[1] if len(sys.argv) > 1 else "large").lower()
CKPT = ROOT / "models" / f"AlignScore-{SIZE}.ckpt"
# NLTK sentence-tokenizer data kept beside the checkpoint (downloaded once: punkt, punkt_tab)
os.environ.setdefault("NLTK_DATA", str(ROOT / "models" / "nltk_data"))

ACI_FILES = {
    "test1": "clinicalnlp_taskB_test1",
    "test2": "clinicalnlp_taskC_test2",
}


def load_jsonl(p):
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []


def aci_transcript(src):
    """Same role labelling as eval/aci_notes.js toTranscript."""
    out = []
    for line in src.split("\n"):
        line = line.strip()
        if not line:
            continue
        m = re.match(r"^\[(doctor|patient|patient_guest|guest_family|guest_clinician|nurse)\]\s*(.*)$", line, re.I)
        if not m:
            out.append(line)
            continue
        role = {"doctor": "Doctor", "patient": "Patient", "nurse": "Nurse"}.get(m.group(1).lower(), "Guest")
        out.append(f"{role}: {m.group(2)}")
    return "\n".join(out)


def aci_sources(split):
    data = json.loads((ROOT / "data" / "aci-bench" / "data" / "challenge_data_json" / f"{ACI_FILES[split]}.json").read_text(encoding="utf-8"))["data"]
    return {d["file"]: d for d in data}


def note_text(row):
    if row.get("note_text"):
        return row["note_text"]
    sections = row.get("sections") or {}
    return "\n".join(" ".join(s.get("text", "") for s in stmts) for stmts in sections.values() if stmts)


def items():
    """Yield (source_file, note_id, context, claim) for every note file present."""
    aci1 = aci_sources("test1")
    aci = {
        "aci_notes_gemini": aci1, "aci_notes_groq": aci1, "baseline_notes": aci1, "ablation_notes": aci1,
    }
    if (RES / "ablation_notes_test2.jsonl").exists():
        aci["ablation_notes_test2"] = aci_sources("test2")
    for name, src in aci.items():
        for r in load_jsonl(RES / f"{name}.jsonl"):
            d = src.get(r.get("file"))
            text = note_text(r)
            if d and text.strip():
                yield name, r["file"], aci_transcript(d["src"]), text
    # Clinician-written reference notes as a ceiling
    for split, name in (("test1", "reference_aci_test1"), ("test2", "reference_aci_test2")):
        if split == "test2" and "ablation_notes_test2" not in aci:
            continue
        for fid, d in aci_sources(split).items():
            yield name, fid, aci_transcript(d["src"]), d["tgt"]
    # AnnoMI counselling notes
    sel = ROOT / "data" / "annomi" / "selected.json"
    if sel.exists():
        dialogues = {d["id"]: d for d in json.loads(sel.read_text(encoding="utf-8"))}
        for r in load_jsonl(RES / "annomi_notes.jsonl"):
            d = dialogues.get(r.get("id"))
            text = note_text(r)
            if d and text.strip():
                yield "annomi_notes", r["id"], d["transcript"], text
    # PriMock57 notes (when the note run exists): transcript from the prepared consultation file
    prepared = ROOT / "data" / "primock57" / "prepared"
    for r in load_jsonl(RES / "primock57_notes.jsonl"):
        pid = r.get("id") or r.get("file")
        meta = prepared / f"{pid}.json"
        text = note_text(r)
        if pid and meta.exists() and text.strip():
            m = json.loads(meta.read_text(encoding="utf-8"))
            context = m.get("transcript") or "\n".join(f"{t.get('speaker', t.get('role', ''))}: {t['text']}" for t in m.get("turns", []))
            yield "primock57_notes", pid, context, text
            if m.get("note"):
                yield "reference_primock57", pid, context, m["note"]


def bootstrap_ci(xs, n=10000, seed=0):
    rng = random.Random(seed)
    means = sorted(sum(rng.choice(xs) for _ in xs) / len(xs) for _ in range(n))
    return [round(means[int(0.025 * n)], 4), round(means[int(0.975 * n) - 1], 4)]


def main():
    done = {(r["source"], r["id"]) for r in load_jsonl(OUT) if r.get("model") == f"AlignScore-{SIZE}"}
    todo = [it for it in items() if (it[0], it[1]) not in done]
    print(f"{len(todo)} notes to score with AlignScore-{SIZE} ({len(done)} already scored)", flush=True)
    if todo:
        from alignscore import AlignScore
        scorer = AlignScore(model=f"roberta-{SIZE}", batch_size=16, device="cpu", ckpt_path=str(CKPT), evaluation_mode="nli_sp", verbose=False)
        with OUT.open("a", encoding="utf-8") as f:
            for source, nid, context, claim in todo:
                t0 = time.perf_counter()
                score = float(scorer.score(contexts=[context], claims=[claim])[0])
                secs = time.perf_counter() - t0
                f.write(json.dumps({"source": source, "id": nid, "model": f"AlignScore-{SIZE}", "score": round(score, 4), "seconds": round(secs, 2)}) + "\n")
                f.flush()
                print(f"{source:22s} {nid:24s} {score:.3f}  {secs:5.1f}s", flush=True)

    by = {}
    for r in load_jsonl(OUT):
        if r.get("model") == f"AlignScore-{SIZE}":
            by.setdefault(r["source"], []).append(r["score"])
    summary = {"model": f"AlignScore-{SIZE}", "mode": "nli_sp", "files": {}}
    for source, xs in sorted(by.items()):
        summary["files"][source] = {"n": len(xs), "mean": round(sum(xs) / len(xs), 4), "ci95": bootstrap_ci(xs)}
    SUMMARY.write_text(json.dumps(summary, indent=1), encoding="utf-8")
    for source, s in summary["files"].items():
        print(f"{source:22s} n={s['n']:3d}  mean {s['mean']:.3f}  CI {s['ci95']}")


if __name__ == "__main__":
    main()
