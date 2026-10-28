"""eval/make_macros.py — write paper/results_macros.tex from the result files.

Every number in the paper comes from here, so nothing is copied by hand. A result that does not
exist yet is written as a bold "??" so it cannot slip into a submitted PDF unnoticed.
Usage: eval/.venv/Scripts/python eval/make_macros.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RES = ROOT / "results"
OUT = ROOT.parent / "paper" / "results_macros.tex"
MISSING = r"\textbf{??}"
macros = {}


def load(name):
    p = RES / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def put(name, value, fmt="{}"):
    macros[name] = MISSING if value is None else fmt.format(value)


def pct(x, digits=1):
    return None if x is None else f"{x * 100:.{digits}f}\\%"


# ── E1 router simulation ──
router = load("router_sim_summary.json") or []
names = {"nomemory": "Nomemory", "fixed60": "Fixed", "priority": "Priority", "round-robin": "Roundrobin", "lkgp": "Lkgp"}
for row in router:
    sc = row["scenario"].capitalize()
    c = names[row["condition"]]
    put(f"ResRouter{sc}{c}Success", pct(row["success_rate"]["mean"], 2))
    put(f"ResRouter{sc}{c}Failed", f"{row['failed_calls_per_request']['mean']:.3f}")
    put(f"ResRouter{sc}{c}Calls", f"{row['calls_per_request']['mean']:.2f}")
    put(f"ResRouter{sc}{c}Pninetyfive", f"{row['latency_p95_s']['mean']:.1f}")
    put(f"ResRouter{sc}{c}Mean", f"{row['latency_mean_s']['mean']:.2f}")
    put(f"ResRouter{sc}{c}Jain", f"{row['jain_fairness']['mean']:.2f}")

# ── E2/E3/E4 notes, grounding, roles ──
notes = load("note_scores.json") or {}
e2 = notes.get("E2_note_quality", {})
for w, key in (("gemini", "Gem"), ("groq", "Groq")):
    r = e2.get(w, {})
    put(f"ResNote{key}N", r.get("n"))
    put(f"ResNote{key}RougeOne", None if r.get("rouge1") is None else f"{r['rouge1'] * 100:.1f}")
    put(f"ResNote{key}RougeTwo", None if r.get("rouge2") is None else f"{r['rouge2'] * 100:.1f}")
    put(f"ResNote{key}RougeL", None if r.get("rougeLsum") is None else f"{r['rougeLsum'] * 100:.1f}")
    put(f"ResNote{key}Bert", None if r.get("bertscore_f1") is None else f"{r['bertscore_f1'] * 100:.1f}")
    put(f"ResNote{key}Secs", None if r.get("seconds_per_note") is None else f"{r['seconds_per_note']:.0f}")

e3 = notes.get("E3_grounding", {})
all_sent = all_sup = 0
for w, key in (("gemini", "Gem"), ("groq", "Groq")):
    r = e3.get(w, {})
    put(f"ResGround{key}Sentences", r.get("sentences_per_note"))
    put(f"ResGround{key}Cited", pct(r.get("cited")))
    put(f"ResGround{key}Supported", pct(r.get("supported")))
    put(f"ResGround{key}Partial", pct(r.get("partial")))
    put(f"ResGround{key}Unsupported", pct(r.get("unsupported")))
    put(f"ResGround{key}OverGate", r.get("notes_over_gate"))
    put(f"ResGround{key}Notes", r.get("notes"))
    rel = r.get("verification") or {}
    put(f"ResVer{key}CrossVendor", rel.get("cross_vendor", 0) if r else None)
    put(f"ResVer{key}CrossModel", rel.get("cross_model", 0) if r else None)
    put(f"ResVer{key}Excluded", (rel.get("self", 0) + rel.get("unverified", 0)) if r else None)
    if r.get("notes"):
        all_sent += r["sentences_per_note"] * r["notes"]
        all_sup += r["supported"] * r["sentences_per_note"] * r["notes"]
put("ResSupportedPct", pct(all_sup / all_sent) if all_sent else None)

cas = (e3.get("cascade") or {}).get("gemini_first", {})
put("ResCascadeNotes", cas.get("notes"))
put("ResCascadeEscalated", cas.get("escalated"))
put("ResCascadeSwitched", cas.get("switched_writer"))
put("ResCascadeBefore", pct(cas.get("mean_unsupported_before")))
put("ResCascadeAfter", pct(cas.get("mean_unsupported_after")))
put("ResCascadeOverGateAfter", cas.get("notes_over_gate_after"))

inj = e3.get("planted_errors", {})
planted_n = planted_det = ctrl_n = ctrl_fa = 0
for w, key in (("gemini", "Gem"), ("groq", "Groq")):
    r = inj.get(w, {})
    for kind in ("NUM", "NEG", "FAB"):
        k = r.get(kind, {})
        put(f"ResInj{key}{kind.capitalize()}", pct(k.get("recall"), 0))
        put(f"ResInj{key}{kind.capitalize()}N", k.get("n"))
    a = r.get("ALL_PLANTED", {})
    c = r.get("CONTROL", {})
    put(f"ResInj{key}Recall", pct(a.get("recall"), 0))
    put(f"ResInj{key}Fa", pct(c.get("rate"), 0))
    put(f"ResInj{key}Verifier", r.get("verifier"))
    planted_n += a.get("n") or 0
    planted_det += a.get("detected") or 0
    ctrl_n += c.get("n") or 0
    ctrl_fa += c.get("false_alarms") or 0
put("ResInjRecallPct", pct(planted_det / planted_n, 0) if planted_n else None)
put("ResInjFaPct", pct(ctrl_fa / ctrl_n, 0) if ctrl_n else None)
put("ResInjPlantedN", planted_n or None)
put("ResInjControlN", ctrl_n or None)

e4 = notes.get("E4_roles", {})
put("ResRoleN", e4.get("dialogues"))
for m, key in (("stats", "Stats"), ("llm", "Llm"), ("combined", "Combined")):
    r = e4.get(m, {})
    put(f"ResRole{key}", pct(r.get("accuracy"), 1))
    put(f"ResRole{key}Correct", r.get("correct"))
hard = e4.get("patient_speaks_more", {})
put("ResRoleHardN", hard.get("n"))
for m, key in (("stats", "Stats"), ("llm", "Llm"), ("combined", "Combined")):
    put(f"ResRoleHard{key}", hard.get(m))

# ── E5/E6 audio ──
audio = load("audio_scores.json") or {}
labels = {
    "WER gemini_raw": "WerGemRaw", "WER gemini_enh": "WerGemEnh", "WER groq_raw": "WerGroqRaw", "WER groq_enh": "WerGroqEnh",
    "DER speechbrain_raw": "DerSbRaw", "DER speechbrain_enh": "DerSbEnh",
    "cpWER speechbrain_raw+gemini": "CpSbRaw", "cpWER speechbrain_enh+gemini_enh": "CpSbEnh",
    "cpWER gemini_audio_diar": "CpGemAudio", "cpWER transcript_diar": "CpText",
    "DER pyannote": "DerPya", "cpWER pyannote+groq": "CpPyaProp", "cpWER pyannote+groq_words": "CpPyaWords",
    "cpWER speechbrain_raw+groq_words": "CpSbWords",
}
for cond, ckey in (("clean", "Clean"), ("snr5", "Five"), ("snr0", "Zero")):
    for metric, mkey in labels.items():
        v = (audio.get(cond) or {}).get(metric, {}).get("mean")
        put(f"ResAudio{mkey}{ckey}", None if v is None else f"{v * 100:.1f}")
lat = audio.get("latency_s_per_audio_min", {})
for stage, key in (("stt_gemini", "SttGem"), ("stt_groq", "SttGroq"), ("sb_diarize", "SbDiar"),
                   ("sb_enhance_diarize", "SbEnh"), ("gemini_diarize", "GemDiar"), ("text_diarize", "TextDiar"),
                   ("pyannote_gpu", "PyaGpu"), ("pyannote_cpu", "PyaCpu")):
    put(f"ResLat{key}", None if lat.get(stage) is None else f"{lat[stage]:.1f}")

OUT.write_text("% Generated by eval/make_macros.py — do not edit by hand\n" +
               "".join(f"\\newcommand{{\\{k}}}{{{v}}}\n" for k, v in sorted(macros.items())), encoding="utf-8")
missing = [k for k, v in macros.items() if v == MISSING]
print(f"wrote {len(macros)} macros to {OUT} ({len(missing)} still missing)")
