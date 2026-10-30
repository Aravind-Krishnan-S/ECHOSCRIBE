/* eval/make_grow_rating_kit.js — blind rating sheet for the GROW notes (eval/results/mentoring/<id>.json).

   Usage: node eval/make_grow_rating_kit.js
   Writes eval/team_kit/grow_rating/: items.csv (one row per session: the four GROW sections with their cited
   turn numbers, the numbered transcript path, and empty rating columns), transcripts/<id>.txt (numbered turns)
   and INSTRUCTIONS.md. A rater reads the transcript, then scores each section. Two raters work independently. */

const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'results', 'mentoring');
const out = path.join(__dirname, 'team_kit', 'grow_rating');
fs.mkdirSync(path.join(out, 'transcripts'), { recursive: true });

const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const cols = ['id', 'goal', 'reality', 'options', 'way_forward',
    'goal_score', 'reality_score', 'options_score', 'way_forward_score', 'invented_facts', 'usable_without_edit', 'rater_note'];
const lines = [cols.join(',')];
for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    fs.writeFileSync(path.join(out, 'transcripts', `${r.id}.txt`), r.turns.map((t, i) => `[T${i + 1}] ${t.role}: ${t.text}`).join('\n'));
    const sec = (r.note.grounding && r.note.grounding.sections) || {};
    const text = key => (sec[key] || []).map(s => `${s.text}${s.turns && s.turns.length ? ` [${s.turns.map(t => 'T' + t).join(', ')}]` : ''}`).join(' ');
    lines.push([r.id, text('goal'), text('reality'), text('options'), text('way_forward'), '', '', '', '', '', '', ''].map(esc).join(','));
}
fs.writeFileSync(path.join(out, 'items.csv'), lines.join('\n'));
fs.writeFileSync(path.join(out, 'INSTRUCTIONS.md'), `# Rating the GROW notes

You rate ${files.length} mentoring-session notes. Work alone; do not discuss scores with the other rater until both files are saved.

For each row of \`items.csv\`: read \`transcripts/<id>.txt\` (turns are numbered T1, T2, ...), then read the four sections of the note and score:

| Column | Question | Scale |
|---|---|---|
| goal_score | Does the **Goal** section state what the mentee wants to achieve, correctly and completely? | 0 = missing or wrong, 1 = partly, 2 = correct |
| reality_score | Does **Reality** describe the mentee's current situation as the session described it? | 0 / 1 / 2 |
| options_score | Does **Options** list the alternatives that were actually discussed? | 0 / 1 / 2 |
| way_forward_score | Does **Way forward** state the agreed next steps and commitments? | 0 / 1 / 2 |
| invented_facts | How many statements in the whole note are **not** in the transcript (made up or wrong)? | a number, 0 or more |
| usable_without_edit | Would a mentor keep this note as it is? | yes / no |

Save your copy as \`rater_A.csv\` or \`rater_B.csv\` (keep the columns). \`rater_note\` is free text.
Role-played or synthetic sessions only; no real mentee data is in these notes.
`);
console.log(`wrote ${files.length} rows to ${out}`);
