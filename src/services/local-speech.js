/* src/services/local-speech.js
   Client for the local speech service (src/python/speech_service.py): speaker diarization with
   pyannote community-1 on this computer. Recordings are converted to 16 kHz mono WAV with the
   bundled FFmpeg before they are sent, so the Python side never decodes compressed audio. */

const { Agent } = require('undici');
const audioPrep = require('./audio-prep');

const SPEECH_SERVICE_URL = (process.env.SPEECH_SERVICE_URL || process.env.SPEECHBRAIN_URL || 'http://localhost:5050').replace(/\/+$/, '');
// A long session can take longer than fetch's default 300 s header timeout; the router applies a
// duration-scaled timeout of its own, so the request itself waits as long as needed.
const longRequests = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
const HEALTH_TTL_MS = 15_000;

let health = { at: 0, ok: false, info: null };

/** True when the service is up and its diarization model is loaded (cached for 15 s). */
async function isAvailable() {
    if (Date.now() - health.at < HEALTH_TTL_MS) return health.ok;
    try {
        const res = await fetch(`${SPEECH_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) });
        const info = res.ok ? await res.json() : null;
        health = { at: Date.now(), ok: !!info?.models_loaded, info };
    } catch {
        health = { at: Date.now(), ok: false, info: null };
    }
    return health.ok;
}

/** Speaker turns [{ speaker, start, end, text: '' }] for a recording in any format FFmpeg reads. */
async function diarize(buffer, { numSpeakers = 2 } = {}) {
    if (!(await isAvailable())) {
        throw new Error(`Local speech service not available at ${SPEECH_SERVICE_URL}${health.info?.error ? `: ${health.info.error}` : ''}`);
    }
    const wav = await audioPrep.toWav16k(buffer);
    const form = new FormData();
    form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    form.append('num_speakers', String(numSpeakers));
    const res = await fetch(`${SPEECH_SERVICE_URL}/diarize`, { method: 'POST', body: form, dispatcher: longRequests });
    if (!res.ok) {
        const err = new Error(`Local speech service /diarize failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
        err.status = res.status;
        throw err;
    }
    return (await res.json()).turns || [];
}

/** Startup log line: whether diarization runs locally, and on which device. */
async function probe() {
    health.at = 0;
    if (await isAvailable()) {
        const i = health.info;
        console.log(`[Speech] Local diarization ready: ${i.diarizer} on ${i.device}${i.gpu ? ` (${i.gpu})` : ''}`);
    } else {
        console.log(`[Speech] Local speech service not reachable at ${SPEECH_SERVICE_URL}; diarization uses the next provider in the DIARIZE chain`);
    }
}

module.exports = { isAvailable, diarize, probe, SPEECH_SERVICE_URL };
