/* eval/annomi_eval.js — therapy-domain evaluation on 40 AnnoMI counselling dialogues
   (eval/data/annomi/selected.json, made by annomi_prepare.py; public domain, Wu et al. 2022).

   Usage: node eval/annomi_eval.js [notes|roles]   (both when omitted; resumable)
     notes — evidence-linked SOAP note with turn citations, each sentence checked by an independent
             model (default chains: Gemini writes; Groq / OpenRouter free models verify). There are no
             reference notes, so this measures citation coverage and support, not ROUGE.
     roles — enrolment-free therapist identification with the speaker labels hidden, as in
             role_accuracy.js: statistics alone, the model alone, and both (as deployed). In counselling
             the client usually speaks more, the case the statistics are designed for.
   Writes eval/results/annomi_notes.jsonl and eval/results/annomi_roles.jsonl. Free providers only. */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
process.env.RISK_SECOND_OPINION = 'off';
process.env.ROLE_TIMEOUT_NOTE_SYNTH = '240000';
process.env.ROLE_TIMEOUT_VERIFY = '240000';
process.env.ROLE_TIMEOUT_ROLE_LABEL = '240000';

const ai = require('../src/services/ai.service');
const dialogues = require('./data/annomi/selected.json');
const which = process.argv[2] || 'both';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const doneIn = file => new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);

function stopIfDailyQuota(err) {
    if (/per day|TPD|RPD|daily/i.test(JSON.stringify(err.publicDetails || {}) + err.message)) {
        console.log('STOPPED: a provider daily quota is exhausted. Re-run after it resets; finished items are kept.');
        process.exit(2);
    }
}

async function notes() {
    const out = path.join(__dirname, 'results', 'annomi_notes.jsonl');
    const done = doneIn(out);
    for (const d of dialogues) {
        if (done.has(d.id)) continue;
        for (let attempt = 1; attempt <= 6; attempt++) {
            const t0 = Date.now();
            try {
                const note = await ai.summarizeTranscript(d.transcript, 'en', 'Therapy');
                const row = {
                    id: d.id, topic: d.topic, writer: note._provider, verifier: note.grounding.verifier,
                    seconds: +((Date.now() - t0) / 1000).toFixed(1), turns: note.grounding.turns.length,
                    summary: note.grounding.summary, sections: note.grounding.sections, cascade: note.grounding.cascade || null,
                };
                fs.appendFileSync(out, JSON.stringify(row) + '\n');
                console.log(`${d.id} notes ${row.seconds}s statements=${row.summary?.statements} supported=${row.summary?.supported} unsupported=${row.summary?.unsupported} verifier=${row.verifier}`);
                break;
            } catch (err) {
                console.log(`${d.id} notes attempt ${attempt} failed: ${err.message.slice(0, 160)}`);
                stopIfDailyQuota(err);
                await sleep(65_000);
            }
        }
    }
}

// Same seeded generator and statistics rule as role_accuracy.js
let seed = 11;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
function statsRule(turns) {
    const stats = ai.computeSpeakerStats(turns);
    const score = id => {
        const s = stats[id];
        if (!s) return -Infinity;
        return (s.questionCount + s.clinicalTerms + s.guidingPhrases - s.emotionalPhrases) / Math.max(1, s.turnCount) + (s.firstTurnIndex === 0 ? 0.5 : 0);
    };
    return score('0') >= score('1') ? '0' : '1';
}

async function roles() {
    const out = path.join(__dirname, 'results', 'annomi_roles.jsonl');
    const done = doneIn(out);
    for (const d of dialogues) {
        const flip = rand() < 0.5;   // drawn for every dialogue so assignments do not depend on resume order
        if (done.has(d.id)) continue;
        const proId = flip ? '1' : '0';
        const otherId = proId === '0' ? '1' : '0';
        let t = 0;
        const turns = d.turns.map(x => {
            const words = x.text.split(/\s+/).length;
            const turn = { speaker: x.role === 'Therapist' ? proId : otherId, text: x.text, start: t, end: t + words * 0.4 };
            t += words * 0.4;
            return turn;
        });
        const merged = turns.map(x => `speaker_${x.speaker}:\n${x.text}`).join('\n\n');
        const wordsBy = id => turns.filter(x => x.speaker === id).reduce((a, x) => a + x.text.split(/\s+/).length, 0);
        const proOf = map => (map.speaker_0 === 'Therapist' ? '0' : map.speaker_1 === 'Therapist' ? '1' : null);

        const statsPick = statsRule(turns);
        let llm = null, combined = null;
        for (let attempt = 1; attempt <= 3 && (!llm || !combined); attempt++) {
            if (!llm) { const r = await ai.identifyRoles(merged, 'Therapy', []); if (!/Default mapping/.test(r._provider)) llm = r; }
            if (!combined) { const r = await ai.identifyRoles(merged, 'Therapy', turns); if (!/Default mapping/.test(r._provider)) combined = r; }
            if (!llm || !combined) await sleep(30_000 * attempt);
        }
        const row = {
            id: d.id, therapist: proId, turns: turns.length, client_more_words: wordsBy(otherId) > wordsBy(proId),
            stats: { pick: statsPick, correct: statsPick === proId },
            llm: llm ? { pick: proOf(llm.roleMap), correct: proOf(llm.roleMap) === proId, provider: llm._provider } : null,
            combined: combined ? { pick: proOf(combined.roleMap), correct: proOf(combined.roleMap) === proId, provider: combined._provider } : null,
        };
        fs.appendFileSync(out, JSON.stringify(row) + '\n');
        console.log(`${d.id} roles stats=${row.stats.correct} llm=${row.llm?.correct} combined=${row.combined?.correct} clientMoreWords=${row.client_more_words}`);
    }
}

(async () => {
    if (which === 'roles' || which === 'both') await roles();
    if (which === 'notes' || which === 'both') await notes();
    console.log('done');
})();
