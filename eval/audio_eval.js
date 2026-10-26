/* eval/audio_eval.js — E5/E6: speech-to-text and speaker separation on simulated conversations.

   Usage: node eval/audio_eval.js [limit]   (SpeechBrain service must be running on SPEECHBRAIN_URL)
   For each conversation x condition (clean, snr5, snr0) it records:
     stt.<model>_raw / stt.<model>_enh   transcripts from Gemini and Groq Whisper, on the raw audio and on
                                         SepFormer-enhanced audio
     sb_raw / sb_enh                     SpeechBrain ECAPA-TDNN + spectral clustering turns, without / with SepFormer
     gemini_diar                         Gemini audio diarization (turns with text, no timings)
     text_diar                           transcript-based speaker split of the raw Gemini transcript (ROLE_LABEL model)
     seconds.<stage>                     wall-clock time per stage
   Results: eval/results/audio_eval.jsonl (resumable). Scored by eval/score_audio.py. */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const GEMINI_ROTATION = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || 'gemini-2.0-flash').split(',').map(m => m.trim()).filter(Boolean);
// The transcript-based speaker split uses the same Gemini rotation
process.env.ROLE_CHAIN_ROLE_LABEL = GEMINI_ROTATION.map(m => `gemini:${m}`).join(',');
const GROQ_STT = process.env.GROQ_STT_MODEL || 'whisper-large-v3';
process.env.ROLE_TIMEOUT_STT = '300000';
process.env.ROLE_TIMEOUT_ROLE_LABEL = '240000';

const ai = require('../src/services/ai.service');
const sb = require('../src/services/speechbrain-client');
const { getFamily } = require('../src/services/provider-registry');

const DIR = path.join(__dirname, 'data', 'conversations');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const limit = Number(process.argv[2]) || manifest.length;
const outFile = path.join(__dirname, 'results', 'audio_eval.jsonl');
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return `${r.id}_${r.cond}`; }) : []);

const geminiKeys = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const longRequests = new (require('undici').Agent)({ headersTimeout: 0, bodyTimeout: 0 });
const lastProvider = {};
let diarTurn = 0;

async function timed(fn) {
    const t0 = Date.now();
    for (let attempt = 1; ; attempt++) {
        try {
            const value = await fn();
            return { value, seconds: +((Date.now() - t0) / 1000).toFixed(2) };
        } catch (err) {
            if (attempt >= 3) return { error: err.message.slice(0, 200), seconds: +((Date.now() - t0) / 1000).toFixed(2) };
            await sleep(20_000 * attempt);
        }
    }
}

async function stt(buffer, family) {
    process.env.ROLE_CHAIN_STT = family === 'gemini' ? GEMINI_ROTATION.map(m => `gemini:${m}`).join(',') : `groq:${GROQ_STT}`;
    const r = await ai.transcribeAudio(buffer, 'audio/wav', 'en');
    lastProvider[family] = r._provider;
    return r.text;
}

async function sbDiarizeRaw(buffer) {
    const form = new FormData();
    form.append('audio', new Blob([buffer], { type: 'audio/wav' }), 'audio.wav');
    form.append('num_speakers', '2');
    const res = await fetch(`${process.env.SPEECHBRAIN_URL || 'http://localhost:5050'}/diarize`, { method: 'POST', body: form, dispatcher: longRequests });
    if (!res.ok) throw new Error(`SpeechBrain /diarize ${res.status}`);
    return (await res.json()).turns;
}

(async () => {
    if (!(await sb.isAvailable())) throw new Error('SpeechBrain service is not running');
    for (const conv of manifest.slice(0, limit)) {
        for (const cond of ['clean', 'snr5', 'snr0']) {
            const key = `${conv.id}_${cond}`;
            if (done.has(key)) continue;
            const buffer = fs.readFileSync(path.join(DIR, `${key}.wav`));
            const row = { id: conv.id, cond, duration: conv.duration, stt: {}, seconds: {} };

            const geminiRaw = await timed(() => stt(buffer, 'gemini'));
            row.stt.gemini_raw = geminiRaw.value ?? null; row.seconds.stt_gemini = geminiRaw.seconds; row.stt.gemini_raw_provider = lastProvider.gemini; if (geminiRaw.error) row.stt.gemini_raw_error = geminiRaw.error;
            const groqRaw = await timed(() => stt(buffer, 'groq'));
            row.stt.groq_raw = groqRaw.value ?? null; row.seconds.stt_groq = groqRaw.seconds; if (groqRaw.error) row.stt.groq_raw_error = groqRaw.error;

            const sbRaw = await timed(() => sbDiarizeRaw(buffer));
            row.sb_raw = sbRaw.value ?? null; row.seconds.sb_diarize = sbRaw.seconds;

            const sbEnh = await timed(() => sb.processAudioBuffer(buffer, 2));
            row.seconds.sb_enhance_diarize = sbEnh.seconds;
            if (!sbEnh.value && /not available/i.test(sbEnh.error || '')) throw new Error(`SpeechBrain stopped responding on ${key}; restart it and re-run (finished rows are kept)`);
            if (sbEnh.value) {
                row.sb_enh = sbEnh.value.turns;
                const enhanced = Buffer.from(sbEnh.value.enhanced_audio_b64, 'base64');
                const gE = await timed(() => stt(enhanced, 'gemini'));
                row.stt.gemini_enh = gE.value ?? null; row.seconds.stt_gemini_enh = gE.seconds;
                const qE = await timed(() => stt(enhanced, 'groq'));
                row.stt.groq_enh = qE.value ?? null; row.seconds.stt_groq_enh = qE.seconds;
            } else {
                row.sb_enh_error = sbEnh.error;
            }

            const gemDiar = await timed(async () => {
                // Rotate model and key on every attempt; the serving model is recorded
                const n = diarTurn++;
                const model = GEMINI_ROTATION[n % GEMINI_ROTATION.length];
                const adapter = getFamily('gemini').create({ apiKey: geminiKeys[n % geminiKeys.length], model });
                const turns = (await adapter.diarizeAudioBuffer(buffer, 'audio/wav', { lang: 'en' })).turns;
                row.gemini_diar_model = model;
                return turns;
            });
            row.gemini_diar = gemDiar.value ?? null; row.seconds.gemini_diarize = gemDiar.seconds; if (gemDiar.error) row.gemini_diar_error = gemDiar.error;

            if (row.stt.gemini_raw) {
                const textDiar = await timed(() => ai.diarizeTranscript(row.stt.gemini_raw));
                row.text_diar = textDiar.value ?? null; row.seconds.text_diarize = textDiar.seconds;
            }

            fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
            console.log(`${key}  stt g=${row.seconds.stt_gemini}s q=${row.seconds.stt_groq}s  sb=${row.seconds.sb_diarize}s sb+enh=${row.seconds.sb_enhance_diarize}s  gemDiar=${row.seconds.gemini_diarize}s`);
        }
    }
    console.log('done');
})();
