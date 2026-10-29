/* eval/primock57_roles.js — enrolment-free clinician identification on PriMock57, the way the app does it:
   pyannote turns (primock57_diar.jsonl) filled with Whisper words by timestamp (src/services/alignment.js),
   then the eight-statistics rule of eval/role_accuracy.js (no language model). The correct clinician
   cluster is the pyannote speaker that overlaps the reference Doctor speech most.
   Usage: node eval/primock57_roles.js   Writes eval/results/primock57_roles.jsonl. */
const fs = require('fs');
const path = require('path');
const ai = require('../src/services/ai.service');
const alignment = require('../src/services/alignment');

const R = path.join(__dirname, 'results');
const DATA = path.join(__dirname, 'data', 'primock57', 'prepared');
const read = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const diar = Object.fromEntries(read(path.join(R, 'primock57_diar.jsonl')).map(r => [r.id, r]));
const words = Object.fromEntries(read(path.join(R, 'primock57_words.jsonl')).map(r => [r.id, r]));

function statsRule(turns) {
    const stats = ai.computeSpeakerStats(turns);
    const score = id => {
        const s = stats[id];
        if (!s) return -Infinity;
        return (s.questionCount + s.clinicalTerms + s.guidingPhrases - s.emotionalPhrases) / Math.max(1, s.turnCount) + (s.firstTurnIndex === 0 ? 0.5 : 0);
    };
    return score('0') >= score('1') ? '0' : '1';
}

const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const rows = [];
for (const id of Object.keys(diar).sort()) {
    if (!words[id]) continue;
    const ref = JSON.parse(fs.readFileSync(path.join(DATA, `${id}.json`), 'utf8'));
    const turns = alignment.tidyTurns(alignment.assignWords(words[id].words, diar[id].turns.map(t => ({ ...t, speaker: String(t.speaker) }))));
    const docTime = { 0: 0, 1: 0 };
    for (const h of diar[id].turns) for (const r of ref.turns) if (r.speaker === 'Doctor') docTime[h.speaker] = (docTime[h.speaker] || 0) + overlap(h, r);
    const truth = (docTime[1] || 0) > (docTime[0] || 0) ? '1' : '0';
    const pick = statsRule(turns);
    rows.push({ id, truth, pick, correct: pick === truth, turns: turns.length });
}
fs.writeFileSync(path.join(R, 'primock57_roles.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(`roles: ${rows.filter(r => r.correct).length}/${rows.length} correct`);
