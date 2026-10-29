/* eval/recheck_openrouter.js — held-out re-check of the final notes (eval/results/ablation_notes*.jsonl)
   by a judge that is neither the writer's vendor (Gemini) nor the judges used during the pipeline.

   Usage: node eval/recheck_openrouter.js [test1|test2]      (resumable; free models only)
   Groq and Gemini keys are removed from this process, so the only verifier left in the chain is
   OpenRouter's free NVIDIA Nemotron models (paid models are refused by the registry). Each note's
   sentences are judged against the turns they cite, exactly as the app does, in one call per note
   (OpenRouter's free tier allows about 50 requests a day). Writes eval/results/recheck_<split>.jsonl. */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
// RECHECK_JUDGE=openrouter (default) | groq: every other vendor's keys are removed from this process
const JUDGE = (process.env.RECHECK_JUDGE || 'openrouter').toLowerCase();
for (const k of Object.keys(process.env)) {
    if (/KEY/i.test(k) && !new RegExp(`^${JUDGE}`, 'i').test(k) && /^(GROQ|OPENROUTER|GEMINI|\d+_GEMINI|MISTRAL|DEEPGRAM|OPENAI|ANTHROPIC)/i.test(k)) process.env[k] = '';
}
process.env.ROLE_TIMEOUT_VERIFY = '180000';

const grounding = require('../src/services/grounding');
const split = process.argv[2] || 'test1';
const FILES = { test1: 'clinicalnlp_taskB_test1', test2: 'clinicalnlp_taskC_test2' };
const aci = require(`./data/aci-bench/data/challenge_data_json/${FILES[split]}.json`).data;
const inFile = path.join(__dirname, 'results', split === 'test1' ? 'ablation_notes.jsonl' : `ablation_notes_${split}.jsonl`);
const outFile = path.join(__dirname, 'results', `recheck_${JUDGE}_${split}.jsonl`);
const notes = fs.readFileSync(inFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
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

/** OpenRouter's free tier allows 50 requests a day: when it is used up, wait for the reset it reports (failed calls are not charged). */
async function waitForOpenRouterQuota() {
    if (JUDGE !== 'openrouter') return;
    for (;;) {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', messages: [{ role: 'user', content: 'ok' }], max_tokens: 5 }),
        });
        if (r.status !== 429) return;
        const reset = Number(r.headers.get('x-ratelimit-reset')) || Date.now() + 600_000;
        const wait = Math.min(Math.max(reset - Date.now() + 60_000, 60_000), 3_600_000);
        console.log(`OpenRouter daily free quota used up; waiting ${(wait / 60000).toFixed(0)} min for the reset`);
        await sleep(wait);
    }
}

(async () => {
    await waitForOpenRouterQuota();
    let fails = 0;
    for (const note of notes) {
        if (done.has(note.file)) continue;
        const item = aci.find(a => a.file === note.file);
        if (!item) continue;
        const { turns } = grounding.numberTranscript(toTranscript(item.src));
        const flat = Object.values(note.sections).flat().map(s => ({ text: s.text, turns: s.turns || [], pipeline_label: s.label }));
        if (!flat.length) continue;
        const v = await grounding.verifyStatements(flat, turns, {});
        if (!v) { console.log(`${note.file} judge unavailable (rate limit?)`); if (++fails >= 4) { console.log('STOPPED: OpenRouter free quota looks exhausted; re-run later, finished notes are kept.'); process.exit(2); } await sleep(30_000); continue; }
        fails = 0;
        const count = l => v.verdicts.filter(x => x.label === l).length;
        const row = {
            file: note.file, judge: v.provider, sentences: flat.length,
            supported: count('supported'), partial: count('partial'), unsupported: count('unsupported'), unverified: count('unverified'),
            labels: v.verdicts.map((x, i) => ({ pipeline: flat[i].pipeline_label, recheck: x.label })),
        };
        fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
        console.log(`${note.file} ${v.provider.replace(/.*\(|\)/g, '')} ${row.supported}/${row.sentences} supported, ${row.unsupported} unsupported`);
        await sleep(4000); // free tier: 20 requests per minute
    }
    console.log('done');
})();
