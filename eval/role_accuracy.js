/* eval/role_accuracy.js — E4: enrolment-free role identification on ACI-Bench (test1).

   Usage: node eval/role_accuracy.js
   Doctor/patient labels are replaced by speaker_0/speaker_1 in a seeded random order (other
   speakers are dropped). Three methods name the clinician:
     stats    — the eight conversation statistics alone (rule below, no LLM)
     llm      — the ROLE_LABEL model on the transcript alone
     combined — EchoScribe: statistics passed to the ROLE_LABEL model (identifyRoles)
   Turn times are word-proportional (text-only dataset). Writes eval/results/role_accuracy.jsonl. */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
process.env.ROLE_TIMEOUT_ROLE_LABEL = '240000';
// Gemini models in turn (Groq's daily token cap is spent on the note experiments); the serving model is recorded per row
const GEMINI_ROTATION = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || 'gemini-2.0-flash').split(',').map(m => m.trim()).filter(Boolean);
process.env.ROLE_CHAIN_ROLE_LABEL = GEMINI_ROTATION.map(m => `gemini:${m}`).join(',');

const ai = require('../src/services/ai.service');
const aci = require('./data/aci-bench/data/challenge_data_json/clinicalnlp_taskB_test1.json').data;
const outFile = path.join(__dirname, 'results', 'role_accuracy.jsonl');
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).file) : []);

let seed = 11;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Statistics-only rule: per turn, (questions + professional vocabulary + guiding phrases − personal/emotional phrases), +0.5 for speaking first. */
function statsRule(turns) {
    const stats = ai.computeSpeakerStats(turns);
    const score = id => {
        const s = stats[id];
        if (!s) return -Infinity;
        return (s.questionCount + s.clinicalTerms + s.guidingPhrases - s.emotionalPhrases) / Math.max(1, s.turnCount) + (s.firstTurnIndex === 0 ? 0.5 : 0);
    };
    return score('0') >= score('1') ? '0' : '1';
}

(async () => {
    for (const item of aci) {
        if (done.has(item.file)) continue;
        const flip = rand() < 0.5;                // which speaker id the doctor gets
        const docId = flip ? '1' : '0';
        let t = 0;
        const turns = [];
        for (const line of item.src.split('\n')) {
            const m = line.trim().match(/^\[(doctor|patient)\]\s*(.*)$/i);
            if (!m || !m[2].trim()) continue;
            const isDoc = m[1].toLowerCase() === 'doctor';
            const words = m[2].trim().split(/\s+/).length;
            turns.push({ speaker: isDoc ? docId : (docId === '0' ? '1' : '0'), text: m[2].trim(), start: t, end: t + words * 0.4 });
            t += words * 0.4;
        }
        const merged = turns.map(x => `speaker_${x.speaker}:\n${x.text}`).join('\n\n');
        const wordsBy = id => turns.filter(x => x.speaker === id).reduce((a, x) => a + x.text.split(/\s+/).length, 0);
        const patientMoreWords = wordsBy(docId === '0' ? '1' : '0') > wordsBy(docId);

        const statsPick = statsRule(turns);
        const proOf = map => (map.speaker_0 === 'Therapist' ? '0' : map.speaker_1 === 'Therapist' ? '1' : null);

        let llm = null, combined = null;
        for (let attempt = 1; attempt <= 3 && (!llm || !combined); attempt++) {
            if (!llm) {
                const r = await ai.identifyRoles(merged, 'Therapy', []);
                if (!/Default mapping/.test(r._provider)) llm = r;
            }
            if (!combined) {
                const r = await ai.identifyRoles(merged, 'Therapy', turns);
                if (!/Default mapping/.test(r._provider)) combined = r;
            }
            if (!llm || !combined) await sleep(30_000 * attempt);
        }
        const row = {
            file: item.file, doctor: docId, turns: turns.length, patient_more_words: patientMoreWords,
            stats: { pick: statsPick, correct: statsPick === docId },
            llm: llm ? { pick: proOf(llm.roleMap), correct: proOf(llm.roleMap) === docId, provider: llm._provider } : null,
            combined: combined ? { pick: proOf(combined.roleMap), correct: proOf(combined.roleMap) === docId, provider: combined._provider } : null,
        };
        fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
        console.log(`${item.file} stats=${row.stats.correct} llm=${row.llm?.correct} combined=${row.combined?.correct} patientMoreWords=${patientMoreWords}`);
    }
    console.log('done');
})();
