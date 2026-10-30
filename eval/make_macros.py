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
    return None if p is None else ("$p<0.001$" if p < 0.001 else f"$p={p:.3f}$")


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
if al:
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


# ── AnnoMI counselling dialogues (annomi_eval.js): role identification and notes ──
def jsonl(name):
    p = RES / name
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []


ar = jsonl("annomi_roles.jsonl")
put("ResAnnoRoleN", len(ar) or None)
for key, mkey in (("stats", "Stats"), ("llm", "Llm"), ("combined", "Combined")):
    put(f"ResAnnoRole{mkey}", len(ar) and sum(1 for r in ar if (r.get(key) or {}).get("correct")))
hard = [r for r in ar if r.get("client_more_words")]
put("ResAnnoRoleHardN", len(hard) or None)
for key, mkey in (("stats", "Stats"), ("llm", "Llm"), ("combined", "Combined")):
    put(f"ResAnnoRoleHard{mkey}", len(ar) and sum(1 for r in hard if (r.get(key) or {}).get("correct")))
an = jsonl("annomi_notes.jsonl")
sent = sum((r.get("summary") or {}).get("statements") or 0 for r in an)
put("ResAnnoNotesN", len(an) or None)
put("ResAnnoSentences", sent or None)
for lab, mkey in (("cited", "Cited"), ("supported", "Supported"), ("partial", "Partial"), ("unsupported", "Unsupported")):
    put(f"ResAnno{mkey}", sent and pct(sum((r.get("summary") or {}).get(lab) or 0 for r in an) / sent))
put("ResAnnoJudgeGroqN", len(an) and sum(1 for r in an if "Groq" in (r.get("verifier") or "")))
put("ResAnnoJudgeGeminiN", len(an) and sum(1 for r in an if "Gemini" in (r.get("verifier") or "")))

# ── note-quality steps and the held-out re-check (score_ablation.py) ──
abl = (load("ablation_scores.json") or {}).get("test1") or {}
ast = abl.get("stages") or {}
put("ResAblNotes", abl.get("notes"))
put("ResAblSentences", (ast.get("verified") or {}).get("sentences"))
for st, mkey in (("verified", "Ver"), ("repaired", "Rep")):
    put(f"ResAbl{mkey}Supported", pct(((ast.get(st) or {}).get("supported") or {}).get("rate")))
    put(f"ResAbl{mkey}Partial", pct(((ast.get(st) or {}).get("partial") or {}).get("rate")))
    put(f"ResAbl{mkey}Unsupported", pct(((ast.get(st) or {}).get("unsupported") or {}).get("rate")))
    put(f"ResAbl{mkey}NotesUnsupported", (ast.get(st) or {}).get("notes_with_unsupported"))
for k in ("flagged", "rewritten", "removed"):
    put(f"ResAblRepair{k.capitalize()}", (abl.get("repair") or {}).get(k))
q = abl.get("quality") or {}
put("ResAblRougeOne", None if q.get("rouge1") is None else f"{q['rouge1'] * 100:.1f}")
put("ResAblRougeTwo", None if q.get("rouge2") is None else f"{q['rouge2'] * 100:.1f}")
put("ResAblRougeL", None if q.get("rougeLsum") is None else f"{q['rougeLsum'] * 100:.1f}")
put("ResAblBert", None if q.get("bertscore_f1") is None else f"{q['bertscore_f1'] * 100:.1f}")
rg = abl.get("recheck_groq") or {}
put("ResAblHeldNotes", rg.get("notes"))
put("ResAblHeldSentences", rg.get("sentences"))
put("ResAblHeldSupported", pct((rg.get("supported") or {}).get("rate")))
put("ResAblHeldPartial", pct((rg.get("partial") or {}).get("rate")))
put("ResAblHeldUnsupported", pct((rg.get("unsupported") or {}).get("rate")))
put("ResAblHeldAgree", pct((rg.get("agreement_with_pipeline") or {}).get("rate")))
ci = (rg.get("supported") or {}).get("ci95") or (None, None)
put("ResAblHeldSupportedCi", None if ci[0] is None else f"{ci[0] * 100:.1f}--{ci[1] * 100:.1f}")
cu = (rg.get("unsupported") or {}).get("ci95") or (None, None)
put("ResAblHeldUnsupportedCi", None if cu[0] is None else f"{cu[0] * 100:.1f}--{cu[1] * 100:.1f}")
put("ResAblHeldNotesUnsupported", (abl.get("paired_gain") or {}).get("notes_with_unsupported_final"))
eg = abl.get("earlier_groq") or {}
put("ResAblEarlierSentences", eg.get("sentences"))
put("ResAblEarlierSupported", pct((eg.get("supported") or {}).get("rate")))
put("ResAblEarlierUnsupported", pct((eg.get("unsupported") or {}).get("rate")))
put("ResAblEarlierNotesUnsupported", eg.get("notes_with_unsupported"))
ec = (eg.get("supported") or {}).get("ci95") or (None, None)
put("ResAblEarlierSupportedCi", None if ec[0] is None else f"{ec[0] * 100:.1f}--{ec[1] * 100:.1f}")
pg = abl.get("paired_gain") or {}
put("ResAblGain", pg.get("mean_points"))
put("ResAblGainCi", None if not pg else f"{pg['ci95_points'][0]:.1f}--{pg['ci95_points'][1]:.1f}")
put("ResAblImproved", pg.get("improved"))
put("ResAblWorse", pg.get("worse"))

# ── mentoring-session benchmark (mentoring_eval.js, score_mentoring.py) ──
mn = load("mentoring_scores_whisper.json") or load("mentoring_scores.json") or {}
put("ResMenSessions", mn.get("sessions"))
put("ResMenMinutes", None if mn.get("audio_minutes") is None else f"{mn['audio_minutes']:.0f}")
put("ResMenMentees", len(mn.get("mentees") or []) or None)
put("ResMenRtf", ((mn.get("processing") or {}).get("seconds_per_audio_minute_median")))
sp = mn.get("speakers") or {}
put("ResMenTwoSpk", None if not sp else f"{sp['two_speakers_found']['k']}/{sp['two_speakers_found']['n']}")
put("ResMenRoles", None if not sp else f"{sp['one_mentor_one_mentee']['k']}/{sp['one_mentor_one_mentee']['n']}")
gw = mn.get("grow") or {}
put("ResMenGrowAll", None if not gw else f"{gw['all_four_sections']['k']}/{gw['all_four_sections']['n']}")
gr = mn.get("grounding") or {}
put("ResMenSentences", gr.get("sentences"))
put("ResMenPerNote", gr.get("sentences_per_note_mean"))
for lab, mkey in (("cited", "Cited"), ("supported", "Supported"), ("partial", "Partial"), ("unsupported", "Unsupported")):
    put(f"ResMen{mkey}", pct((gr.get(lab) or {}).get("rate")))
rp = mn.get("repair") or {}
for k in ("flagged", "rewritten", "removed"):
    put(f"ResMenRepair{k.capitalize()}", rp.get(k))
mh = mn.get("recheck_groq") or mn.get("recheck_openrouter") or {}
put("ResMenHeldSupported", pct((mh.get("supported") or {}).get("rate")))
put("ResMenHeldNotes", mh.get("notes"))

# ── AnnoMI notes judged again by the held-out Groq judge ──
ah = jsonl("recheck_groq_annomi.jsonl")
ahs = sum(r["sentences"] for r in ah)
put("ResAnnoHeldNotes", len(ah) or None)
put("ResAnnoHeldSupported", ahs and pct(sum(r["supported"] for r in ah) / ahs))
put("ResAnnoHeldUnsupported", ahs and pct(sum(r["unsupported"] for r in ah) / ahs))

# ── role-played mentoring sessions recorded by the team (tag _roleplay) ──
rpm = load("mentoring_scores_roleplay.json") or {}
put("ResRpSessions", rpm.get("sessions"))
put("ResRpMinutes", None if rpm.get("audio_minutes") is None else f"{rpm['audio_minutes']:.0f}")
rsp = rpm.get("speakers") or {}
put("ResRpTwoSpk", None if not rsp else f"{rsp['two_speakers_found']['k']}/{rsp['two_speakers_found']['n']}")
put("ResRpRoles", None if not rsp else f"{rsp['one_mentor_one_mentee']['k']}/{rsp['one_mentor_one_mentee']['n']}")
rgw = rpm.get("grow") or {}
put("ResRpGrowAll", None if not rgw else f"{rgw['all_four_sections']['k']}/{rgw['all_four_sections']['n']}")
rgr = rpm.get("grounding") or {}
put("ResRpSentences", rgr.get("sentences"))
put("ResRpSupported", pct((rgr.get("supported") or {}).get("rate")))
rhh = rpm.get("recheck_groq") or {}
put("ResRpHeldSupported", pct((rhh.get("supported") or {}).get("rate")))
put("ResRpHeldUnsupported", pct((rhh.get("unsupported") or {}).get("rate")))

# ── switches: pending work appears in the paper only when its results are complete ──
n_recheck = len(jsonl("recheck_groq_test1.jsonl"))
switches = (
    ("recheck", n_recheck >= 40),
    ("mentoring", (mn.get("sessions") or 0) >= 19),
)
switch_lines = "".join(f"\\newif\\if{name}\n" + (f"\\{name}true\n" if on else "") for name, on in switches)

OUT.write_text("% Generated by eval/make_macros.py — do not edit by hand\n" + switch_lines +
               "".join(f"\\newcommand{{\\{k}}}{{{v}}}\n" for k, v in sorted(macros.items())), encoding="utf-8")
missing = [k for k, v in macros.items() if v == MISSING]
print(f"wrote {len(macros)} macros to {OUT} ({len(missing)} still missing)")
