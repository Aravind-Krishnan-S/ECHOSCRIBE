/* eval/mentoring_eval.js — the full EchoScribe pipeline on the mentoring session recordings.

   Usage: node eval/mentoring_eval.js [folder] [limit]      (resumable; free providers only)
   Default folder: C:/Users/aravi/Downloads/voicebox audio  (<Mentee>_Session<N>.wav)
   Each recording goes through the same steps as the app: bundled-FFmpeg compaction, speaker separation
   (local pyannote, cloud fallbacks), speech-to-text with word timestamps when the provider returns them,
   clinician/mentor identification, and the evidence-linked GROW note with one fact per sentence, sentence
   repair, two-judge agreement and the verification-gated cascade, as deployed.
   Writes eval/results/mentoring_eval.jsonl (one row per session) and eval/results/mentoring/<id>.json
   (transcript turns and the note, for re-checking and for injecting into the app). */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
process.env.RISK_SECOND_OPINION = 'off';          // burnout second opinion is not part of this measurement; saves quota
process.env.ROLE_TIMEOUT_NOTE_SYNTH = '300000';
process.env.ROLE_TIMEOUT_VERIFY = '240000';

const ai = require('../src/services/ai.service');
const audioPrep = require('../src/services/audio-prep');
const alignment = require('../src/services/alignment');

const dir = process.argv[2] && !/^\d+$/.test(process.argv[2]) ? process.argv[2] : 'C:/Users/aravi/Downloads/voicebox audio';
const limit = Number(process.argv[3] || (/^\d+$/.test(process.argv[2] || '') ? process.argv[2] : 0)) || Infinity;
const outFile = path.join(__dirname, 'results', 'mentoring_eval.jsonl');
const outDir = path.join(__dirname, 'results', 'mentoring');
fs.mkdirSync(outDir, { recursive: true });
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sec = t0 => +((Date.now() - t0) / 1000).toFixed(1);

function stopIfDailyQuota(err) {
    if (/per day|TPD|RPD|daily/i.test(JSON.stringify(err.publicDetails || {}) + err.message)) {
        console.log('STOPPED: a provider daily quota is exhausted. Re-run after it resets; finished sessions are kept.');
        process.exit(2);
    }
}

async function runSession(file) {
    const id = file.replace(/\.wav$/i, '');
    const buffer = fs.readFileSync(path.join(dir, file));
    const t = { };
    let t0 = Date.now();
    const durationSec = await audioPrep.probeDuration(buffer);
    const cloud = await audioPrep.toCompactOpus(buffer, 'audio/wav');
    t.prepare = sec(t0);

    t0 = Date.now();
    let turns = [], diarProvider = null;
    try {
        const d = await ai.diarizeAudio(buffer, 'audio/wav', 'en', { durationSec, cloudAudio: cloud });
        turns = d.turns; diarProvider = d._provider;
    } catch (e) { console.log(`${id} diarization failed: ${e.message.slice(0, 120)}`); }
    t.diarize = sec(t0);

    t0 = Date.now();
    const stt = await ai.transcribeAudio(cloud.buffer, cloud.mimeType, 'en', { durationSec, words: turns.length > 0 });
    t.stt = sec(t0);

    let alignedBy = null;
    if (turns.length && stt.text) {
        if (stt.words) { alignment.assignWords(stt.words, turns); turns = alignment.tidyTurns(turns); alignedBy = 'word timestamps'; }
        else { alignment.splitByDuration(stt.text, turns); alignedBy = 'turn duration'; }
    } else if (stt.text) {
        const tt = await ai.diarizeTranscript(stt.text, {});
        turns = tt.map((x, i) => ({ speaker: String(Math.max(0, (Number(x.speaker) || 1) - 1)), start: i, end: i + 1, text: x.text || '' }));
        diarProvider = 'Transcript-based (ROLE_LABEL model)'; alignedBy = 'transcript split';
    }

    t0 = Date.now();
    const merged = turns.map(x => `speaker_${x.speaker}:\n${x.text}`).join('\n\n');
    const roles = await ai.identifyRoles(merged, 'Mentoring', turns);
    t.roles = sec(t0);
    const labelled = turns.map(x => ({ role: roles.roleMap[`speaker_${x.speaker}`] || `Speaker ${x.speaker}`, text: (x.text || '').trim(), speaker: x.speaker, start: x.start, end: x.end })).filter(x => x.text);
    const transcript = labelled.map(x => `${x.role}: ${x.text}`).join('\n');

    t0 = Date.now();
    const note = await ai.summarizeTranscript(transcript, 'en', 'Mentoring');
    t.note = sec(t0);

    const g = note.grounding || {};
    const s = g.summary || {};
    const grow = note.grow || {};
    const filled = ['goal', 'reality', 'options', 'way_forward'].filter(k => grow[k] && !/^not discussed/i.test(String(grow[k]).trim()));
    const words = labelled.reduce((a, x) => a + x.text.split(/\s+/).length, 0);
    const mentorWords = labelled.filter(x => x.role === 'Mentor').reduce((a, x) => a + x.text.split(/\s+/).length, 0);
    const row = {
        id, mentee: id.split('_')[0], durationSec: +durationSec.toFixed(1), seconds: t,
        diarization: diarProvider, speakersFound: new Set(turns.map(x => x.speaker)).size, turns: labelled.length,
        stt: stt._provider, alignedBy, words, mentorShare: +(mentorWords / Math.max(words, 1)).toFixed(3),
        roleProvider: roles._provider, roleMap: roles.roleMap,
        writer: note._provider, verifier: g.verifier, sentences: s.statements, cited: s.cited, supported: s.supported,
        partial: s.partial, unsupported: s.unsupported, stages: g.stages || null, repair: g.repair || null, cascade: g.cascade || null,
        growFilled: filled.length, growSections: filled,
    };
    fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({ id, turns: labelled, transcript, note, durationSec }, null, 1));
    fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
    console.log(`${id} ${(durationSec / 60).toFixed(1)}min | ${diarProvider} ${row.speakersFound} spk ${row.turns} turns | stt ${stt._provider} (${alignedBy}) | roles ${JSON.stringify(roles.roleMap)} | GROW ${filled.length}/4 | ${s.statements} sentences, ${s.supported} supported, ${s.unsupported} unsupported | total ${Object.values(t).reduce((a, b) => a + b, 0).toFixed(0)}s`);
}

(async () => {
    const files = fs.readdirSync(dir).filter(f => /\.wav$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, limit);
    for (const file of files) {
        if (done.has(file.replace(/\.wav$/i, ''))) continue;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try { await runSession(file); break; }
            catch (err) {
                console.log(`${file} attempt ${attempt} failed: ${String(err.message).slice(0, 200)}`);
                stopIfDailyQuota(err);
                await sleep(60_000);
            }
        }
    }
    console.log('done');
})();
