/**
 * EchoScribe — SpeechBrain Client Service
 * ========================================
 * HTTP client for the Python SpeechBrain microservice.
 * Provides noise cancellation and speaker diarization.
 * Falls back gracefully when the service is unavailable.
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const SPEECHBRAIN_URL = process.env.SPEECHBRAIN_URL || 'http://localhost:5050';
let serviceAvailable = false;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 15_000; // Re-check every 15s for faster pickup

/**
 * Check if the SpeechBrain service is running.
 * Caches result for 60s to avoid hammering the service.
 */
async function isAvailable() {
    const now = Date.now();
    if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
        return serviceAvailable;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`${SPEECHBRAIN_URL}/health`, {
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (response.ok) {
            const data = await response.json();
            // Require speaker_model specifically for diarization
            serviceAvailable = data.speaker_model === true;
            lastHealthCheck = now;
            console.log(`[SpeechBrain] Health check: speaker_model=${data.speaker_model}, enhancer=${data.enhancer}, available=${serviceAvailable}`);
            return serviceAvailable;
        }
    } catch (err) {
        serviceAvailable = false;
        lastHealthCheck = now;
    }
    return false;
}

/**
 * Process audio through SpeechBrain: enhance (noise cancel) + diarize.
 * @param {string} audioFilePath  — Path to the audio file on disk
 * @param {number} numSpeakers    — Expected number of speakers (default 2)
 * @returns {Object} { enhanced_audio_b64, turns, num_speakers, _provider }
 */
async function processAudio(audioFilePath, numSpeakers = 2) {
    const available = await isAvailable();
    if (!available) {
        throw new Error('SpeechBrain service not available');
    }

    const form = new FormData();
    form.append('audio', fs.createReadStream(audioFilePath));
    form.append('num_speakers', String(numSpeakers));

    const response = await fetch(`${SPEECHBRAIN_URL}/process`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders ? form.getHeaders() : {},
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`SpeechBrain /process failed (${response.status}): ${errText}`);
    }

    return await response.json();
}

/**
 * Enhance audio only (noise cancellation).
 * Returns the enhanced audio as a Buffer.
 * @param {string} audioFilePath — Path to the audio file
 * @returns {Buffer} Enhanced WAV audio
 */
async function enhanceAudio(audioFilePath) {
    const available = await isAvailable();
    if (!available) {
        throw new Error('SpeechBrain service not available');
    }

    const form = new FormData();
    form.append('audio', fs.createReadStream(audioFilePath));

    const response = await fetch(`${SPEECHBRAIN_URL}/enhance`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders ? form.getHeaders() : {},
    });

    if (!response.ok) {
        throw new Error(`SpeechBrain /enhance failed (${response.status})`);
    }

    const arrayBuf = await response.arrayBuffer();
    return Buffer.from(arrayBuf);
}

/**
 * Diarize audio only (speaker segmentation).
 * @param {string} audioFilePath — Path to audio file
 * @param {number} numSpeakers   — Expected speakers (default 2)
 * @returns {Object} { turns: [{speaker, start, end}], num_speakers }
 */
async function diarizeAudio(audioFilePath, numSpeakers = 2) {
    const available = await isAvailable();
    if (!available) {
        throw new Error('SpeechBrain service not available');
    }

    const form = new FormData();
    form.append('audio', fs.createReadStream(audioFilePath));
    form.append('num_speakers', String(numSpeakers));

    const response = await fetch(`${SPEECHBRAIN_URL}/diarize`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders ? form.getHeaders() : {},
    });

    if (!response.ok) {
        throw new Error(`SpeechBrain /diarize failed (${response.status})`);
    }

    return await response.json();
}

/**
 * Save enhanced audio (base64) to a temp file for further processing.
 * @param {string} base64Audio — Base64-encoded WAV audio
 * @returns {string} Path to temp WAV file
 */
function saveEnhancedToTemp(base64Audio) {
    const tmpDir = path.join(require('os').tmpdir(), 'echoscribe');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const tmpPath = path.join(tmpDir, `enhanced_${Date.now()}.wav`);
    const buffer = Buffer.from(base64Audio, 'base64');
    fs.writeFileSync(tmpPath, buffer);
    return tmpPath;
}

/**
 * Probe service on startup and log status.
 */
async function probe() {
    const available = await isAvailable();
    if (available) {
        try {
            const resp = await fetch(`${SPEECHBRAIN_URL}/health`);
            const data = await resp.json();
            console.log(`[SpeechBrain] ✅ Service available at ${SPEECHBRAIN_URL}`);
            console.log(`[SpeechBrain]    Device: ${data.device}, Enhancer: ${data.enhancer}, Speaker Model: ${data.speaker_model}`);
        } catch (e) {
            console.log(`[SpeechBrain] ✅ Service available at ${SPEECHBRAIN_URL}`);
        }
    } else {
        console.log(`[SpeechBrain] ⚠️ Service not available at ${SPEECHBRAIN_URL} — using Deepgram fallback`);
    }
    return available;
}

module.exports = {
    isAvailable,
    processAudio,
    enhanceAudio,
    diarizeAudio,
    saveEnhancedToTemp,
    probe
};
