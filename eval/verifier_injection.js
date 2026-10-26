/* eval/verifier_injection.js — E3: can the cross-vendor verifier catch planted errors?

   Usage: node eval/verifier_injection.js <gemini|groq>
   Takes the notes written by <writer> (eval/results/aci_notes_<writer>.jsonl). In each note, up to
   three statements the verifier had accepted are perturbed — a changed number (NUM), a flipped
   negation (NEG) or a sentence borrowed from another dialogue's note (FAB) — and up to three other
   accepted statements are kept unchanged as controls. The same verifier vendor re-judges the mixed
   list. A perturbation counts as detected when it is labelled unsupported or partial.
   Writes eval/results/injection_<writer>.jsonl (resumable). */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const writer = process.argv[2];
if (!['gemini', 'groq'].includes(writer)) throw new Error('writer must be gemini or groq');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
process.env.ROLE_CHAIN_VERIFY = `groq:${GROQ_MODEL},gemini:${GEMINI_MODEL}`;
process.env.ROLE_TIMEOUT_VERIFY = '240000';

const grounding = require('../src/services/grounding');
const aci = require('./data/aci-bench/data/challenge_data_json/clinicalnlp_taskB_test1.json').data;
const notes = fs.readFileSync(path.join(__dirname, 'results', `aci_notes_${writer}.jsonl`), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l));
const outFile = path.join(__dirname, 'results', `injection_${writer}.jsonl`);
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).file) : []);

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);

function toTranscript(src) {
    return src.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/^\[(doctor|patient|patient_guest|guest_family|guest_clinician|nurse)\]\s*(.*)$/i);
        if (!m) return l;
        const role = { doctor: 'Doctor', patient: 'Patient', nurse: 'Nurse' }[m[1].toLowerCase()] || 'Guest';
        return `${role}: ${m[2]}`;
    }).join('\n');
}

function perturbNumber(text) {
    const m = text.match(/\d+(\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    const changed = n === 0 ? 3 : n < 10 ? n + 3 : Math.round(n * 1.6);
    return text.replace(m[0], String(changed));
}

const NEGATIONS = [
    [/\bdenies\b/i, 'reports'], [/\breports\b/i, 'denies'], [/\bno\s+/i, 'significant '],
    [/\bnegative\b/i, 'positive'], [/\bpositive\b/i, 'negative'], [/\bis\b/i, 'is not'],
    [/\bwas\b/i, 'was not'], [/\bhas\b/i, 'has no'], [/\bwill\b/i, 'will not'], [/\bcontinue\b/i, 'stop'],
];
function perturbNegation(text) {
    for (const [re, rep] of NEGATIONS) if (re.test(text)) return text.replace(re, rep);
    return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    for (const note of notes) {
        if (done.has(note.file)) continue;
        const item = aci.find(a => a.file === note.file);
        const { turns } = grounding.numberTranscript(toTranscript(item.src));
        const accepted = Object.values(note.sections).flat().filter(s => s.label === 'supported' && s.turns.length);
        if (accepted.length < 4) continue;

        const pool = [...accepted].sort(() => rand() - 0.5);
        const others = notes.filter(n => n.file !== note.file).flatMap(n => Object.values(n.sections).flat().filter(s => s.label === 'supported'));
        const items = [];
        const kinds = ['NUM', 'NEG', 'FAB'];
        for (const kind of kinds) {
            const idx = pool.findIndex(s => kind !== 'NUM' || /\d/.test(s.text));
            if (idx < 0) continue;
            const [s] = pool.splice(idx, 1);
            let text = kind === 'NUM' ? perturbNumber(s.text) : kind === 'NEG' ? perturbNegation(s.text) : others[Math.floor(rand() * others.length)].text;
            if (!text || text === s.text) { pool.push(s); continue; }
            items.push({ kind, original: s.text, text, turns: s.turns });
        }
        for (const s of pool.slice(0, 3)) items.push({ kind: 'CONTROL', original: s.text, text: s.text, turns: s.turns });
        const shuffled = items.sort(() => rand() - 0.5);

        let verified = null;
        for (let attempt = 1; attempt <= 4 && !verified; attempt++) {
            verified = await grounding.verifyStatements(shuffled.map(i => ({ text: i.text, turns: i.turns })), turns, { avoidFamily: writer });
            if (!verified) await sleep(30_000 * attempt);
        }
        if (!verified) { console.log(`${note.file} verification failed`); continue; }
        const row = {
            file: note.file,
            verifier: verified.provider,
            items: shuffled.map((it, k) => ({ ...it, label: verified.verdicts[k].label, reason: verified.verdicts[k].reason })),
        };
        fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
        console.log(`${note.file}  ${row.items.map(i => `${i.kind}:${i.label}`).join(' ')}`);
    }
    console.log('done');
})();
