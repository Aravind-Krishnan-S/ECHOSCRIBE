/* eval/stt_words.js — Whisper (Groq) transcripts with word timestamps for the simulated conversations,
   on the original recordings, for word-timestamp speaker attribution (score_audio.py).
   Usage: node eval/stt_words.js        Appends to eval/results/stt_words.jsonl (resumable). */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { getFamily } = require('../src/services/provider-registry');
const { legacyKeys } = require('../src/services/provider-chain');

const CONV = path.join(__dirname, 'data', 'conversations');
const OUT = path.join(__dirname, 'results', 'stt_words.jsonl');
const MODEL = process.env.GROQ_STT_MODEL || 'whisper-large-v3';
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return `${r.id}_${r.cond}`; }) : []);
const adapter = getFamily('groq').create({ apiKey: legacyKeys('groq')[0], model: MODEL });

(async () => {
    for (const f of fs.readdirSync(CONV).filter(f => /^conv\d+_\w+\.wav$/.test(f)).sort()) {
        const [id, cond] = f.replace('.wav', '').split('_');
        if (done.has(`${id}_${cond}`)) continue;
        const t0 = Date.now();
        const r = await adapter.transcribeAudioBuffer(fs.readFileSync(path.join(CONV, f)), 'audio/wav', { lang: 'en', words: true });
        fs.appendFileSync(OUT, JSON.stringify({ id, cond, model: MODEL, seconds: (Date.now() - t0) / 1000, text: r.text, words: r.words.map(w => ({ word: w.word, start: w.start, end: w.end })) }) + '\n');
        console.log(`${id}_${cond}  ${r.words.length} words  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
})().catch(e => { console.error('stopped:', e.message); process.exit(1); });
