/* eval/primock57_words.js — Whisper (Groq, free tier) transcripts with word timestamps for the mixed
   PriMock57 consultations, for word-timestamp speaker attribution (score_primock57.py).

   Usage: node eval/primock57_words.js        Appends to eval/results/primock57_words.jsonl (resumable).
   Groq's free tier caps audio at about 7,200 s per hour and 28,800 s per day; the 57 consultations are
   about 31,000 s, so the run waits out hourly limits (up to 20 min) and stops cleanly at the daily one. */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { getFamily } = require('../src/services/provider-registry');
const { legacyKeys } = require('../src/services/provider-chain');
const os = require('os');
const { execFileSync } = require('child_process');
const FFMPEG = require('@ffmpeg-installer/ffmpeg').path;

/** 16 kHz mono AAC in an .m4a container (about 3.5 MB per 10 min). Groq accepts m4a, and the adapter names
    audio/mp4 uploads ".m4a"; the app's Opus-in-Ogg copy would be named ".oga", which Groq rejects. */
function toM4a(wavBuffer) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm57-'));
    const input = path.join(dir, 'in.wav'), output = path.join(dir, 'out.m4a');
    fs.writeFileSync(input, wavBuffer);
    try {
        execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', output], { windowsHide: true });
        return { buffer: fs.readFileSync(output), mimeType: 'audio/mp4' };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const DATA = path.join(__dirname, 'data', 'primock57', 'prepared');
const OUT = path.join(__dirname, 'results', 'primock57_words.jsonl');
const MODEL = process.env.GROQ_STT_MODEL || 'whisper-large-v3';
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
const adapter = getFamily('groq').create({ apiKey: legacyKeys('groq')[0], model: MODEL });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Seconds to wait from a Groq rate-limit message ("Please try again in 12m3.5s"), or null. */
function retryAfter(msg) {
    const m = String(msg).match(/try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i);
    if (!m) return null;
    return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

(async () => {
    for (const f of fs.readdirSync(DATA).filter(f => f.endsWith('.wav')).sort()) {
        const id = f.replace('.wav', '');
        if (done.has(id)) continue;
        const wav = fs.readFileSync(path.join(DATA, f));
        const audio = toM4a(wav);
        for (;;) {
            const t0 = Date.now();
            try {
                const r = await adapter.transcribeAudioBuffer(audio.buffer, audio.mimeType, { lang: 'en', words: true });
                fs.appendFileSync(OUT, JSON.stringify({ id, model: MODEL, seconds: (Date.now() - t0) / 1000, format: 'm4a-aac-48k', text: r.text, words: r.words.map(w => ({ word: w.word, start: w.start, end: w.end })) }) + '\n');
                console.log(`${id}  ${r.words.length} words  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
                break;
            } catch (e) {
                const msg = String(e.message || e);
                const wait = retryAfter(msg);
                if (/per day|ASD/i.test(msg) || (wait !== null && wait > 1200)) {
                    console.log(`STOPPED at ${id}: Groq audio quota (${msg.slice(0, 160)}). Re-run after it resets; finished files are kept.`);
                    process.exit(2);
                }
                if (e.status === 429 || /rate limit/i.test(msg)) {
                    const s = Math.ceil((wait ?? 60) + 5);
                    console.log(`${id}  rate limited, waiting ${s}s`);
                    await sleep(s * 1000);
                    continue;
                }
                console.log(`${id}  failed: ${msg.slice(0, 200)}`);
                break;
            }
        }
    }
    console.log('done');
})();
