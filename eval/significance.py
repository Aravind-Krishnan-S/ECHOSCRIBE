"""eval/significance.py — paired bootstrap tests for the paper's key comparisons.

Inputs: eval/results/audio_per_clip.json (written by score_audio.py) and eval/results/router_sim.json.
For each comparison the clips (or router seeds) present in both arms are paired; the difference of means
A - B is resampled with replacement 10,000 times (seed 0). Reported: mean difference, 95% percentile CI,
and a two-sided p-value (twice the share of resamples on the far side of zero, floored at 1/10,000).

Writes eval/results/significance.json and prints a table.
"""
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
B = 10_000
CONDS = ("clean", "snr5", "snr0")


def paired_bootstrap(a, b, seed=0):
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = a - b
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(d), size=(B, len(d)))
    means = d[idx].mean(axis=1)
    lo, hi = np.percentile(means, [2.5, 97.5])
    observed = d.mean()
    tail = np.mean(means <= 0) if observed > 0 else np.mean(means >= 0)
    p = max(min(1.0, 2 * tail), 1 / B)
    return {"n": int(len(d)), "mean_a": round(float(a.mean()), 4), "mean_b": round(float(b.mean()), 4),
            "diff": round(float(observed), 4), "ci95": [round(float(lo), 4), round(float(hi), 4)], "p": round(float(p), 4),
            "a_better_in": int(np.sum(d < 0)), "b_better_in": int(np.sum(d > 0))}


per_clip = json.loads((RESULTS / "audio_per_clip.json").read_text(encoding="utf-8"))

COMPARISONS = [
    ("cpwer_words_vs_duration", "cpWER pyannote+groq_words", "cpWER pyannote+groq",
     "word-timestamp vs duration-split attribution on pyannote turns"),
    ("cpwer_words_vs_cloud", "cpWER pyannote+groq_words", "cpWER gemini_audio_diar",
     "pyannote + word timestamps vs Gemini cloud audio diarization"),
    ("der_pyannote_vs_speechbrain", "DER pyannote", "DER speechbrain_raw",
     "pyannote vs SpeechBrain ECAPA clustering (original audio)"),
    ("wer_whisper_raw_vs_denoised", "WER groq_raw", "WER groq_enh", "Whisper on original vs SepFormer-denoised audio"),
    ("wer_gemini_raw_vs_denoised", "WER gemini_raw", "WER gemini_enh", "Gemini on original vs SepFormer-denoised audio"),
]

out = {"method": f"paired bootstrap, {B} resamples, seed 0; diff = A - B (negative favours A)", "audio": {}, "router": None}
for key, a_metric, b_metric, label in COMPARISONS:
    out["audio"][key] = {"a": a_metric, "b": b_metric, "label": label}
    for c in CONDS:
        A, Bm = per_clip.get(c, {}).get(a_metric, {}), per_clip.get(c, {}).get(b_metric, {})
        ids = sorted(set(A) & set(Bm))
        if len(ids) >= 2:
            out["audio"][key][c] = paired_bootstrap([A[i] for i in ids], [Bm[i] for i in ids])

# Router: LKGP vs priority, 95th-percentile latency in the mixed scenario, paired by seed
router_file = RESULTS / "router_sim.json"
if router_file.exists():
    rows = json.loads(router_file.read_text(encoding="utf-8"))
    by = {(r["condition"], r["seed"]): r for r in rows if r["scenario"] == "mixed"}
    seeds = sorted({s for (cond, s) in by if cond == "lkgp"} & {s for (cond, s) in by if cond == "priority"})
    if len(seeds) >= 2:
        res = paired_bootstrap([by[("lkgp", s)]["latency_p95_s"] for s in seeds], [by[("priority", s)]["latency_p95_s"] for s in seeds])
        res["note"] = f"only {len(seeds)} seeds: the bootstrap CI is coarse; LKGP was lower in {res['a_better_in']} of {len(seeds)} seeds"
        out["router"] = {"lkgp_vs_priority_p95_mixed": res}
else:
    out["router"] = "skipped: eval/results/router_sim.json not found"

(RESULTS / "significance.json").write_text(json.dumps(out, indent=1), encoding="utf-8")

print(f"{'comparison':32s} {'cond':6s} {'A':>7s} {'B':>7s} {'A-B':>8s} {'95% CI':>18s} {'p':>7s}")
for key, block in out["audio"].items():
    for c in CONDS:
        r = block.get(c)
        if r:
            print(f"{key:32s} {c:6s} {r['mean_a']*100:6.1f}% {r['mean_b']*100:6.1f}% {r['diff']*100:+7.1f} "
                  f"[{r['ci95'][0]*100:+6.1f}, {r['ci95'][1]*100:+6.1f}] {r['p']:7.4f}")
if isinstance(out["router"], dict):
    r = out["router"]["lkgp_vs_priority_p95_mixed"]
    print(f"{'router lkgp vs priority p95':32s} {'mixed':6s} {r['mean_a']:6.2f}s {r['mean_b']:6.2f}s {r['diff']:+7.2f} "
          f"[{r['ci95'][0]:+6.2f}, {r['ci95'][1]:+6.2f}] {r['p']:7.4f}  ({r['note']})")
