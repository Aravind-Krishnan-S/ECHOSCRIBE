/* eval/reverify.js — re-run only the cross-vendor verification for notes whose verifier call
   failed (quota or overload), using the sentences and citations already stored.
   Usage: node eval/reverify.js <gemini|groq>   (gemini-written notes need Groq, groq-written need Gemini) */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const writer = process.argv[2];
if (!['gemini', 'groq'].includes(writer)) throw new Error('writer must be gemini or groq');
const GEMINI_ROTATION = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || 'gemini-2.0-flash').split(',').map(m => m.trim()).filter(Boolean);
process.env.ROLE_CHAIN_VERIFY = [`groq:${process.env.GROQ_MODEL || 'openai/gpt-oss-120b'}`, ...GEMINI_ROTATION.map(m => `gemini:${m}`)].join(',');
process.env.ROLE_TIMEOUT_VERIFY = '240000';

const grounding = require('../src/services/grounding');
const aci = require('./data/aci-bench/data/challenge_data_json/clinicalnlp_taskB_test1.json').data;
const file = path.join(__dirname, 'results', `aci_notes_${writer}.jsonl`);
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

function toTranscript(src) {
    return src.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/^\[(doctor|patient|patient_guest|guest_family|guest_clinician|nurse)\]\s*(.*)$/i);
        if (!m) return l;
        const role = { doctor: 'Doctor', patient: 'Patient', nurse: 'Nurse' }[m[1].toLowerCase()] || 'Guest';
        return `${role}: ${m[2]}`;
    }).join('\n');
}

(async () => {
    let fixed = 0;
    for (const row of rows) {
        if (row.verifier && !(row.summary && row.summary.unverified > 0)) continue;
        const item = aci.find(a => a.file === row.file);
        const { turns } = grounding.numberTranscript(toTranscript(item.src));
        const flat = Object.values(row.sections).flat();
        const v = await grounding.verifyStatements(flat, turns, { avoidFamily: writer });
        if (!v || !v.family || v.family === writer) { console.log(`${row.file}  still unverified (no other-vendor verifier available)`); continue; }
        flat.forEach((st, k) => Object.assign(st, v.verdicts[k]));
        row.verifier = v.provider;
        row.summary = grounding.summarize(row.sections);
        fixed++;
        console.log(`${row.file}  verified by ${v.provider}: supported=${row.summary.supported} partial=${row.summary.partial} unsupported=${row.summary.unsupported}`);
    }
    fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    console.log(`re-verified ${fixed} note(s)`);
})();
