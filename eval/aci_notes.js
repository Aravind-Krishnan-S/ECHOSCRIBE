/* eval/aci_notes.js — E2/E3: evidence-linked note generation on ACI-Bench (test1, 40 dialogues).

   Usage: node eval/aci_notes.js <gemini|groq> [limit]
   For each dialogue, the chosen vendor writes the SOAP note with [T#] citations and the other
   vendor verifies every sentence (cross-vendor). The quality gate is disabled here (GROUNDING_GATE=1)
   so each writer is measured on its own; the cascade outcome is computed later from both runs.
   Results are appended to eval/results/aci_notes_<writer>.jsonl and resumed on re-run. */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const writer = process.argv[2];
const limit = Number(process.argv[3]) || 40;
if (!['gemini', 'groq'].includes(writer)) throw new Error('writer must be gemini or groq');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
process.env.GROUNDING_GATE = '1';
process.env.RISK_SECOND_OPINION = 'off';
process.env.ROLE_CHAIN_NOTE_SYNTH = writer === 'gemini' ? `gemini:${GEMINI_MODEL}` : `groq:${GROQ_MODEL}`;
process.env.ROLE_CHAIN_VERIFY = `groq:${GROQ_MODEL},gemini:${GEMINI_MODEL}`;
process.env.ROLE_TIMEOUT_NOTE_SYNTH = '240000';
process.env.ROLE_TIMEOUT_VERIFY = '240000';

const ai = require('../src/services/ai.service');

const data = require('./data/aci-bench/data/challenge_data_json/clinicalnlp_taskB_test1.json').data.slice(0, limit);
const outFile = path.join(__dirname, 'results', `aci_notes_${writer}.jsonl`);
const done = new Set(fs.existsSync(outFile)
    ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).file) : []);

/** "[doctor] hi\n[patient] hello" → "Doctor: hi\nPatient: hello" */
function toTranscript(src) {
    return src.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/^\[(doctor|patient|patient_guest|guest_family|guest_clinician|nurse)\]\s*(.*)$/i);
        if (!m) return l;
        const role = { doctor: 'Doctor', patient: 'Patient', nurse: 'Nurse' }[m[1].toLowerCase()] || 'Guest';
        return `${role}: ${m[2]}`;
    }).join('\n');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// A daily quota (e.g. Groq's tokens-per-day) will not clear by waiting minutes: stop and say so
function stopIfDailyQuota(err) {
    if (/per day|TPD|RPD|daily/i.test(JSON.stringify(err.publicDetails || {}) + err.message)) {
        console.log('STOPPED: a provider daily quota is exhausted. Re-run this script after it resets; finished items are kept.');
        process.exit(2);
    }
}


(async () => {
    for (const item of data) {
        if (done.has(item.file)) continue;
        const transcript = toTranscript(item.src);
        let attempt = 0;
        while (true) {
            const t0 = Date.now();
            try {
                const note = await ai.summarizeTranscript(transcript, 'en', 'Therapy');
                const soap = note.soap;
                const row = {
                    file: item.file,
                    writer: note._provider,
                    verifier: note.grounding.verifier,
                    seconds: +((Date.now() - t0) / 1000).toFixed(1),
                    turns: note.grounding.turns.length,
                    summary: note.grounding.summary,
                    sections: note.grounding.sections,
                    note_text: ['subjective', 'objective', 'assessment', 'plan'].map(k => soap[k]).join('\n'),
                    reference: item.tgt,
                };
                fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
                console.log(`${item.file}  ${row.seconds}s  statements=${row.summary?.statements} supported=${row.summary?.supported} partial=${row.summary?.partial} unsupported=${row.summary?.unsupported} verifier=${row.verifier}`);
                break;
            } catch (err) {
                attempt++;
                console.log(`${item.file}  attempt ${attempt} failed: ${err.message.slice(0, 160)}`);
                stopIfDailyQuota(err);
                if (attempt >= 6) break;
                await sleep(65_000); // per-minute token windows (Groq: 8,000 TPM) reset after 60 s
            }
        }
    }
    console.log('done');
})();
