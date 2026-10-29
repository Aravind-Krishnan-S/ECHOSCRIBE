/* eval/make_rater_kit.js — builds the blind verifier-agreement kit (eval/team_kit/verifier_agreement/).

   60 note sentences from the ACI-Bench runs (both writers), stratified by the independent verifier's label
   (20 supported, 20 partial, 20 unsupported; seed 0), each with the text of the turns it cites, numbered
   exactly as the pipeline numbers them (grounding.numberTranscript). Raters get items.csv without the
   verifier's labels; key.csv holds them for eval/verifier_agreement.py.
   Usage: node eval/make_rater_kit.js */

const fs = require('fs');
const path = require('path');
const grounding = require('../src/services/grounding');
const aci = require('./data/aci-bench/data/challenge_data_json/clinicalnlp_taskB_test1.json').data;

const OUT = path.join(__dirname, 'team_kit', 'verifier_agreement');
const PER_LABEL = 20;

// Same speaker mapping as eval/reverify.js
function toTranscript(src) {
    return src.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/^\[(doctor|patient|patient_guest|guest_family|guest_clinician|nurse)\]\s*(.*)$/i);
        if (!m) return l;
        const role = { doctor: 'Doctor', patient: 'Patient', nurse: 'Nurse' }[m[1].toLowerCase()] || 'Guest';
        return `${role}: ${m[2]}`;
    }).join('\n');
}

// Seeded PRNG (mulberry32) so the sample is reproducible
function rng(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = rng(0);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const pool = { supported: [], partial: [], unsupported: [] };
for (const writer of ['gemini', 'groq']) {
    const rows = fs.readFileSync(path.join(__dirname, 'results', `aci_notes_${writer}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    for (const row of rows) {
        if (!row.verifier) continue;
        const item = aci.find(a => a.file === row.file);
        const { turns } = grounding.numberTranscript(toTranscript(item.src));
        const byId = new Map(turns.map(t => [t.id, t]));
        for (const [section, sentences] of Object.entries(row.sections || {})) {
            sentences.forEach((s, i) => {
                if (!pool[s.label]) return;
                const evidence = s.turns.length
                    ? s.turns.map(id => byId.get(id)).filter(Boolean).map(t => `[T${t.id}] ${t.role}: ${t.text}`).join('\n')
                    : '(no turns cited)';
                pool[s.label].push({ dialogue: row.file, writer: row.writer, verifier: row.verifier, section, index: i, sentence: s.text, evidence, label: s.label });
            });
        }
    }
}

const picked = shuffle(Object.values(pool).flatMap(list => shuffle([...list]).slice(0, PER_LABEL)));
const csv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const items = ['item_id,dialogue,section,sentence,cited_turns,rater_label,rater_note']
    .concat(picked.map((p, k) => [`V${String(k + 1).padStart(2, '0')}`, p.dialogue, p.section, p.sentence, p.evidence, '', ''].map(csv).join(',')));
const key = ['item_id,verifier_label,writer,verifier']
    .concat(picked.map((p, k) => [`V${String(k + 1).padStart(2, '0')}`, p.label, p.writer, p.verifier].map(csv).join(',')));

fs.mkdirSync(OUT, { recursive: true });
// UTF-8 BOM so Excel opens the accents and quotes correctly
fs.writeFileSync(path.join(OUT, 'items.csv'), '﻿' + items.join('\r\n') + '\r\n', 'utf8');
fs.writeFileSync(path.join(OUT, 'key.csv'), '﻿' + key.join('\r\n') + '\r\n', 'utf8');
console.log(`items.csv: ${picked.length} sentences (${Object.entries(pool).map(([l, v]) => `${l} pool ${v.length}`).join(', ')}); key.csv written`);
