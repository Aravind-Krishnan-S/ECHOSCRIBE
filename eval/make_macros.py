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

# ── significance (eval/significance.py): paired bootstrap p-values and 95% CIs of A - B ──
sig = load("significance.json") or {}


def fmt_p(p):
    return None if p is None else ("$<$0.001" if p < 0.001 else f"{p:.3f}")


def fmt_ci(ci, scale=100, unit=""):
    if not ci:
        return None
    lo, hi = ci[0] * scale, ci[1] * scale
    sign = lambda v: f"{v:+.1f}".replace("-", "$-$")
    return f"[{sign(lo)}, {sign(hi)}]{unit}"


for key, mkey, conds in (("cpwer_words_vs_duration", "WordsDur", ("clean", "snr5", "snr0")),
                         ("cpwer_words_vs_cloud", "WordsCloud", ("clean", "snr5", "snr0")),
                         ("der_pyannote_vs_speechbrain", "DerPya", ("clean", "snr5", "snr0")),
                         ("wer_whisper_raw_vs_denoised", "WerWhisper", ("snr0",)),
                         ("wer_gemini_raw_vs_denoised", "WerGemini", ("snr0",))):
    for cond in conds:
        ckey = {"clean": "Clean", "snr5": "Five", "snr0": "Zero"}[cond]
        r = ((sig.get("audio") or {}).get(key) or {}).get(cond) or {}
        put(f"ResSig{mkey}{ckey}P", fmt_p(r.get("p")))
        put(f"ResSig{mkey}{ckey}Ci", fmt_ci(r.get("ci95")))
router_sig = (sig.get("router") or {}) if isinstance(sig.get("router"), dict) else {}
r = router_sig.get("lkgp_vs_priority_p95_mixed") or {}
put("ResSigRouterP", fmt_p(r.get("p")))
put("ResSigRouterCi", fmt_ci(r.get("ci95"), scale=1, unit="~s"))

# ── single-pass baseline vs evidence-linked notes (eval/baseline_notes.js, eval/score_baseline.py) ──
base = load("baseline_scores.json") or {}
put("ResBaseN", base.get("verified_dialogues"))
for side, key in (("baseline", "Single"), ("linked", "Linked")):
    row = base.get(side) or {}
    put(f"ResBase{key}RougeOne", None if row.get("rouge1") is None else f"{row['rouge1'] * 100:.1f}")
    put(f"ResBase{key}RougeTwo", None if row.get("rouge2") is None else f"{row['rouge2'] * 100:.1f}")
    put(f"ResBase{key}RougeL", None if row.get("rougeLsum") is None else f"{row['rougeLsum'] * 100:.1f}")
    put(f"ResBase{key}Bert", None if row.get("bertscore_f1") is None else f"{row['bertscore_f1'] * 100:.1f}")
    ver = row.get("full_transcript_verification") or {}
    put(f"ResBase{key}Sentences", ver.get("sentences_per_note"))
    for lab, lkey in (("supported", "Supported"), ("partial", "Partial"), ("unsupported", "Unsupported")):
        r = ver.get(lab) or {}
        put(f"ResBase{key}{lkey}", pct(r.get("rate")))
        ci = r.get("ci95") or (None, None)
        put(f"ResBase{key}{lkey}Ci", None if ci[0] is None else f"{ci[0] * 100:.1f}--{ci[1] * 100:.1f}")
    nwu = ver.get("notes_with_unsupported") or {}
    put(f"ResBase{key}NotesUnsupported", None if not nwu else f"{nwu['k']}/{nwu['n']}")

# ── PriMock57: real spoken consultations (score_primock57.py) ──
pm = (load("primock57_scores.json") or {}).get("summary") or {}
put("ResPmN", pm.get("consultations"))
put("ResPmNWords", pm.get("with_transcript"))
put("ResPmHours", pm.get("hours"))
put("ResPmDer", pct(pm.get("der")))
put("ResPmWer", pct(pm.get("wer")))
put("ResPmCpWords", pct(pm.get("cpwer_words")))
put("ResPmCpDuration", pct(pm.get("cpwer_duration")))
put("ResPmDiarGpu", None if pm.get("diar_gpu_s_per_audio_min") is None else f"{pm['diar_gpu_s_per_audio_min']:.1f}")
pr = pm.get("roles") or {}
put("ResPmRoleCorrect", pr.get("correct"))
put("ResPmRoleN", pr.get("n"))
put("ResPmRole", pct(pr.get("accuracy")))

# ── AlignScore: judge-independent factual consistency of notes vs transcript (alignscore_notes.py) ──
al = load("alignscore_summary.json") or {}
al_files = al.get("files") or {}
put("ResAlignModel", al.get("model"))
for source, key in (("aci_notes_gemini", "Gem"), ("aci_notes_groq", "Groq"), ("baseline_notes", "Base"),
                    ("ablation_notes", "Abl"), ("ablation_notes_test2", "AblTwo"), ("annomi_notes", "Annomi"),
                    ("primock57_notes", "Pm"), ("reference_aci_test1", "RefAci"), ("reference_aci_test2", "RefAciTwo"),
                    ("reference_primock57", "RefPm")):
    s = al_files.get(source)
    if s is None:
        continue
    put(f"ResAlign{key}", f"{s['mean']:.3f}")
    put(f"ResAlign{key}Ci", f"{s['ci95'][0]:.3f}--{s['ci95'][1]:.3f}")
    put(f"ResAlign{key}N", s["n"])

OUT.write_text("% Generated by eval/make_macros.py — do not edit by hand\n" +
               "".join(f"\\newcommand{{\\{k}}}{{{v}}}\n" for k, v in sorted(macros.items())), encoding="utf-8")
missing = [k for k, v in macros.items() if v == MISSING]
print(f"wrote {len(macros)} macros to {OUT} ({len(missing)} still missing)")
