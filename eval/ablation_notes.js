/* eval/ablation_notes.js — note-quality steps on ACI-Bench test1 (40 dialogues), Gemini writer.

   Usage: node eval/ablation_notes.js [limit] [split]    split: test1 (default) | test2 (held-out confirmation)
   Every note is written with one fact per sentence, then verified, repaired and re-checked by a second
   judge; the pipeline records the support summary after each step (grounding.stages), so one run gives
   the ablation: as written (atomic) → + sentence repair → + two-judge agreement. The plain evidence-linked
   run (eval/results/aci_notes_gemini.jsonl) is the starting row. The regeneration gate is off here, as in
   aci_notes.js, so each step is measured on its own. Free providers only.
   Writes eval/results/ablation_notes.jsonl (resumable). */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
process.env.GROUNDING_GATE = '1';
process.env.RISK_SECOND_OPINION = 'off';
process.env.GROUNDING_ATOMIC = 'on';
process.env.GROUNDING_REPAIR = 'on';
process.env.VERIFY_CONSENSUS = 'on';
const GEMINI_ROTATION = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || 'gemini-2.0-flash').split(',').map(m => m.trim()).filter(Boolean);
process.env.ROLE_CHAIN_NOTE_SYNTH = GEMINI_ROTATION.map(m => `gemini:${m}`).join(',');
process.env.ROLE_TIMEOUT_NOTE_SYNTH = '240000';
process.env.ROLE_TIMEOUT_VERIFY = '240000';

const ai = require('../src/services/ai.service');
const limit = Number(process.argv[2]) || 40;
const split = process.argv[3] || 'test1';
const FILES = { test1: 'clinicalnlp_taskB_test1', test2: 'clinicalnlp_taskC_test2', test3: 'clef_taskC_test3' };
const data = require(`./data/aci-bench/data/challenge_data_json/${FILES[split]}.json`).data.slice(0, limit);
const outFile = path.join(__dirname, 'results', split === 'test1' ? 'ablation_notes.jsonl' : `ablation_notes_${split}.jsonl`);
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).file) : []);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function toTranscript(src) {
    return src.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/^\[(doctor|patient|patient_guest|guest_family|guest_clinician|nurse)\]\s*(.*)$/i);
        if (!m) return l;
        const role = { doctor: 'Doctor', patient: 'Patient', nurse: 'Nurse' }[m[1].toLowerCase()] || 'Guest';
        return `${role}: ${m[2]}`;
    }).join('\n');
}

function stopIfDailyQuota(err) {
    if (/per day|TPD|RPD|daily/i.test(JSON.stringify(err.publicDetails || {}) + err.message)) {
        console.log('STOPPED: a provider daily quota is exhausted. Re-run after it resets; finished items are kept.');
        process.exit(2);
    }
}

(async () => {
    for (const item of data) {
        if (done.has(item.file)) continue;
        for (let attempt = 1; attempt <= 6; attempt++) {
            const t0 = Date.now();
            try {
                const note = await ai.summarizeTranscript(toTranscript(item.src), 'en', 'Therapy');
                const g = note.grounding;
                const row = {
                    file: item.file, writer: note._provider, verifier: g.verifier, seconds: +((Date.now() - t0) / 1000).toFixed(1),
                    stages: g.stages, repair: g.repair, consensus: g.consensus, summary: g.summary, sections: g.sections,
                    note_text: ['subjective', 'objective', 'assessment', 'plan'].map(k => note.soap[k]).join('\n'), reference: item.tgt,
                };
                fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
                const s = g.stages || {};
                const fmt = x => (x ? `${x.supported}/${x.statements} u${x.unsupported}` : '-');
                console.log(`${item.file} ${row.seconds}s verified ${fmt(s.verified)} repaired ${fmt(s.repaired)} consensus ${fmt(s.consensus)} | ${row.verifier} / 2nd ${g.consensus?.provider || '-'}`);
                break;
            } catch (err) {
                console.log(`${item.file} attempt ${attempt} failed: ${err.message.slice(0, 160)}`);
                stopIfDailyQuota(err);
                await sleep(65_000);
            }
        }
    }
    console.log('done');
})();
