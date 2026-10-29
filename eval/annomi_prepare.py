"""eval/annomi_prepare.py — select the AnnoMI counselling dialogues used for the therapy-domain evaluation.

AnnoMI (Wu et al., ICASSP 2022; public domain): 133 transcribed motivational-interviewing demonstrations.
We keep high-quality MI dialogues with 20-160 utterances (long enough for a note, short enough for one
model call), then draw 40 with seed 0, stratified by topic. Writes eval/data/annomi/selected.json:
[{id, topic, turns: [{role: "Therapist"|"Client", text}], transcript}]."""
import csv, json, random
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "data" / "annomi"
rows = list(csv.DictReader((ROOT / "AnnoMI-simple.csv").open(encoding="utf-8")))
dialogues = defaultdict(list)
meta = {}
for r in rows:
    dialogues[r["transcript_id"]].append(r)
    meta[r["transcript_id"]] = (r["mi_quality"], r["topic"])

eligible = defaultdict(list)
for tid, utts in dialogues.items():
    quality, topic = meta[tid]
    if quality == "high" and 20 <= len(utts) <= 160:
        eligible[topic].append(tid)

rng = random.Random(0)
pool = []
for topic in sorted(eligible):
    ids = sorted(eligible[topic], key=int)
    rng.shuffle(ids)
    pool.append(ids)
picked = []
while len(picked) < 40 and any(pool):  # round-robin across topics
    for ids in pool:
        if ids and len(picked) < 40:
            picked.append(ids.pop())

out = []
for tid in sorted(picked, key=int):
    utts = sorted(dialogues[tid], key=lambda r: int(r["utterance_id"]))
    turns = [{"role": "Therapist" if u["interlocutor"] == "therapist" else "Client", "text": u["utterance_text"].strip()}
             for u in utts if u["utterance_text"].strip()]
    out.append({"id": f"annomi-{tid}", "topic": meta[tid][1], "turns": turns,
                "transcript": "\n".join(f"{t['role']}: {t['text']}" for t in turns)})
(ROOT / "selected.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
words = [len(d["transcript"].split()) for d in out]
print(f"eligible {sum(len(v) for v in eligible.values())} high-quality dialogues in {len(eligible)} topics; selected {len(out)}")
print(f"words per dialogue: min {min(words)}, median {sorted(words)[len(words)//2]}, max {max(words)}; topics {len({d['topic'] for d in out})}")
