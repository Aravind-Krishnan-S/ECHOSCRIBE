/* eval/baseline_notes.js — single-pass baseline for the ACI-Bench note evaluation (test1, 40 dialogues).

   Phase "write":  the same Gemini writer as the evidence-linked run (GEMINI_MODEL, keys taking turns)
                   writes a SOAP note from the plain transcript with the app's note prompt minus the
                   evidence rule: no turn citations, no verification, no cascade.
                   → eval/results/baseline_notes.jsonl
   Phase "verify": baseline and evidence-linked sentences of the same dialogue are shuffled together and
                   judged in one blinded request against the FULL numbered transcript (citations ignored),
                   so both sides are labelled identically. Judge: Groq gpt-oss-120b, then free OpenRouter
                   Nemotron models; never Gemini (the writer). → eval/results/baseline_verify.jsonl
   Usage: node eval/baseline_notes.js [write|verify|all]   (resumable; stops cleanly on a daily quota) */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { getFamily } = require('../src/services/provider-registry');
const { legacyKeys } = require('../src/services/provider-chain');
const grounding = require('../src/services/grounding');

const phase = process.argv[2] || 'all';
const RESULTS = path.join(__dirname, 'results');
const NOTES_OUT = path.join(RESULTS, 'baseline_notes.jsonl');
const VERIFY_OUT = path.join(RESULTS, 'baseline_verify.jsonl');
const LINKED = path.join(RESULTS, 'aci_notes_gemini.jsonl');
const WRITER_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const SECTIONS = ['subjective', 'objective', 'assessment', 'plan'];
const data = require('./data/aci-bench/data/challenge_data_json/clinicalnlp_taskB_test1.json').data;

const readRows = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isDaily = e => /per day|TPD|RPD|daily|free-models-per-day/i.test(String(e && e.message));
const isRate = e => e && (e.status === 429 || /429|rate limit|quota|RESOURCE_EXHAUSTED/i.test(String(e.message)));

function toTranscript(src) {
    return src.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/^\[(doctor|patient|patient_guest|guest_family|guest_clinician|nurse)\]\s*(.*)$/i);
        if (!m) return l;
        const role = { doctor: 'Doctor', patient: 'Patient', nurse: 'Nurse' }[m[1].toLowerCase()] || 'Guest';
        return `${role}: ${m[2]}`;
    }).join('\n');
}

function parseJson(reply) {
    const s = String(reply || '').replace(/```json|```/g, '').trim();
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    return JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
}

// ─── Baseline writer: the app's Therapy note prompt (src/services/ai.service.js) without the evidence rule ───

const SYSTEM = `You are an expert clinical documentation specialist trained in SOAP note formatting for mental health counseling sessions.
You analyze speech transcripts from sessions and produce structured documentation.
CRITICAL INSTRUCTION: Pay strict attention to the speaker labels (e.g., "Therapist:", "Patient:", "Mentor:", "Mentee:") in the transcript.
- The "Therapist" or "Mentor" is the professional guiding the session.
- The "Patient" or "Mentee" is the client seeking help.
Do NOT attribute the professional's statements, questions, or guidance to the client.
Do NOT attribute the client's symptoms, experiences, or answers to the professional.
You MUST respond with valid JSON only. No markdown, no code fences, no extra text.
Be thorough but precise. Do not fabricate information not present in the transcript.
If information for a field is not available from the transcript, use "Not discussed" or empty arrays as appropriate.
You must also generate a client-facing communication summary translated into the locale: en.`;

const baselinePrompt = transcript => `Analyze the following session transcript and return a STRICT structured note in JSON format.

TRANSCRIPT:
"""
${transcript}
"""

Return ONLY valid JSON with this exact structure:
{
  "soap": {
    "subjective": "Client's reported symptoms, feelings, concerns, and history as stated in their own words. Include chief complaint and relevant history.",
    "objective": "Observable behaviors, affect, appearance cues noted from speech patterns. Include speech rate, coherence, emotional expression.",
    "assessment": "Clinical assessment of the client's current state, diagnostic impressions, and clinical reasoning. Identify patterns and risk factors.",
    "plan": "Recommended next steps, therapeutic interventions to continue, referrals, and follow-up actions."
  },
  "risk_assessment": {
    "suicidal_ideation": false,
    "self_harm_risk": "low",
    "notes": "Brief risk assessment notes based on transcript content"
  },
  "auto_booking": {
    "needs_follow_up": false,
    "suggested_timeframe": "string (e.g., '2 weeks', 'next Tuesday' or 'None')",
    "reason": "string"
  },
  "referral_form": {
    "referral_needed": false,
    "specialty_or_service": "string",
    "reason": "string"
  },
  "patient_communication": {
    "instructions_english": "A warm, supportive summary and instructions for the individual to take home, in English.",
    "instructions_translated": "The exact same supportive summary and instructions, translated to language code: en."
  },
  "diagnostic_impressions": ["Possible diagnostic considerations based on presentation"],
  "interventions_used": ["Therapeutic interventions or techniques evident in the session"],
  "medication_changes": ["Any medication-related discussions or changes mentioned"],
  "progress_indicators": ["Signs of progress, improvement, or regression noted"],
  "emotional_tone": "Primary emotional tone of the session",
  "topics": ["Key topics discussed in the session"],
  "confidence_score": 0.85,
  "counselingStats": {
    "name": "Individual name if mentioned, otherwise Unknown",
    "age": "Individual age if mentioned, otherwise Unknown",
    "presentingProblem": "The main issue described",
    "reasonForCounseling": "Why the individual is seeking help/mentorship",
    "lastMajorProgress": "Any recent positive developments",
    "currentEmotionalState": "One-word emotion descriptor"
  }
}`;

async function write() {
    const keys = legacyKeys('gemini');
    const writers = keys.map(apiKey => getFamily('gemini').create({ apiKey, model: WRITER_MODEL }));
    const done = new Set(readRows(NOTES_OUT).map(r => r.file));
    let k = 0;
    for (const item of data) {
        if (done.has(item.file)) continue;
        const transcript = toTranscript(item.src);
        for (let attempt = 0; ; attempt++) {
            const t0 = Date.now();
            try {
                const raw = parseJson(await writers[k % writers.length].chatCompletion(SYSTEM, baselinePrompt(transcript), { json: true, temperature: 0.3 }));
                const soap = raw.soap || {};
                const sections = {};
                for (const key of SECTIONS) sections[key] = grounding.extractStatements(String(soap[key] || ''), 0).statements.map(s => s.text);
                const row = {
                    file: item.file, writer: `Google Gemini (${WRITER_MODEL})`, seconds: +((Date.now() - t0) / 1000).toFixed(1),
                    sections, note_text: SECTIONS.map(key => String(soap[key] || 'Not discussed')).join('\n'), reference: item.tgt,
                };
                fs.appendFileSync(NOTES_OUT, JSON.stringify(row) + '\n');
                console.log(`write  ${item.file}  ${row.seconds}s  sentences=${Object.values(sections).flat().length}`);
                k++;
                break;
            } catch (err) {
                if (isDaily(err)) { console.log('STOPPED: Gemini daily quota exhausted; re-run after it resets.'); process.exit(2); }
                k++; // next key
                console.log(`write  ${item.file}  attempt ${attempt + 1} failed: ${String(err.message).slice(0, 140)}`);
                if (attempt >= 3 * writers.length) { console.log('giving up on this dialogue for now'); break; }
                if (isRate(err) && (attempt + 1) % writers.length === 0) await sleep(65_000);
            }
        }
    }
}

// ─── Blinded full-transcript verification of both note types ───

const JUDGE_SYSTEM = 'You are a meticulous clinical documentation auditor. You check whether each statement in a session note is supported by the session transcript. You MUST respond with valid JSON only.';
const judgePrompt = (numbered, statements) => `Label every statement against the transcript below.
- "supported": every claim in the statement is stated or directly implied somewhere in the transcript.
- "partial": some of the statement is supported, but it adds a detail, number, name or judgement the transcript does not contain.
- "unsupported": the transcript does not support it.
Clinical interpretation clearly framed as the clinician's impression (for example "presentation is consistent with…") counts as supported when the transcript contains the observations it rests on.

TRANSCRIPT (numbered turns):
"""
${numbered}
"""

STATEMENTS:
${statements.map((s, i) => `S${i + 1}: ${s}`).join('\n')}

Return ONLY valid JSON: {"verdicts":[{"id":"S1","label":"supported|partial|unsupported","reason":"at most 12 words"}, ...]} with one entry per statement, in order.`;

function shuffle(arr, seedText) {
    let seed = [...seedText].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
}

async function verify() {
    const judges = [
        ...legacyKeys('groq').map(apiKey => ({ name: 'Groq (openai/gpt-oss-120b)', adapter: getFamily('groq').create({ apiKey, model: 'openai/gpt-oss-120b' }) })),
        ...['nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'].flatMap(model =>
            legacyKeys('openrouter').map(apiKey => ({ name: `OpenRouter (${model})`, adapter: getFamily('openrouter').create({ apiKey, model }) }))),
    ];
    const exhausted = new Set();
    const baseline = Object.fromEntries(readRows(NOTES_OUT).map(r => [r.file, r]));
    const linked = Object.fromEntries(readRows(LINKED).map(r => [r.file, r]));
    const done = new Set(readRows(VERIFY_OUT).map(r => r.file));
    for (const item of data) {
        const b = baseline[item.file];
        const l = linked[item.file];
        if (!b || !l || done.has(item.file)) continue;
        const pool = [
            ...SECTIONS.flatMap(key => b.sections[key].map(text => ({ src: 'baseline', text }))),
            ...SECTIONS.flatMap(key => (l.sections[key] || []).map(s => ({ src: 'linked', text: s.text }))),
        ];
        const mixed = shuffle(pool, item.file);
        const numbered = grounding.numberTranscript(toTranscript(item.src)).prompt;
        let row = null;
        for (const judge of judges) {
            if (exhausted.has(judge.name)) continue;
            for (let attempt = 0; attempt < 3 && !row; attempt++) {
                try {
                    const parsed = parseJson(await judge.adapter.chatCompletion(JUDGE_SYSTEM, judgePrompt(numbered, mixed.map(m => m.text)), { json: true, temperature: 0, maxTokens: 6000 }));
                    const verdicts = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
                    if (verdicts.length < mixed.length * 0.9) throw new Error(`judge returned ${verdicts.length}/${mixed.length} verdicts`);
                    const labels = mixed.map((_, i) => {
                        const v = verdicts.find(x => String(x.id).toUpperCase() === `S${i + 1}`) || verdicts[i] || {};
                        const label = String(v.label || '').toLowerCase();
                        return ['supported', 'partial', 'unsupported'].includes(label) ? label : 'unverified';
                    });
                    row = {
                        file: item.file, judge: judge.name,
                        baseline: mixed.map((m, i) => (m.src === 'baseline' ? labels[i] : null)).filter(Boolean),
                        linked: mixed.map((m, i) => (m.src === 'linked' ? labels[i] : null)).filter(Boolean),
                    };
                } catch (err) {
                    console.log(`verify ${item.file}  ${judge.name} failed: ${String(err.message).slice(0, 120)}`);
                    if (isDaily(err)) { exhausted.add(judge.name); break; }
                    if (isRate(err)) await sleep(30_000);
                }
            }
            if (row) break;
        }
        if (!row) {
            if (judges.every(j => exhausted.has(j.name))) { console.log('STOPPED: every free judge is out of daily quota; re-run after it resets.'); process.exit(2); }
            continue;
        }
        fs.appendFileSync(VERIFY_OUT, JSON.stringify(row) + '\n');
        const n = (arr, x) => arr.filter(y => y === x).length;
        console.log(`verify ${item.file}  ${row.judge}  baseline ${n(row.baseline, 'supported')}/${row.baseline.length}  linked ${n(row.linked, 'supported')}/${row.linked.length}`);
    }
}

(async () => {
    if (phase === 'write' || phase === 'all') await write();
    if (phase === 'verify' || phase === 'all') await verify();
    console.log('done');
})();
