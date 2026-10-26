/* src/services/audio-prep.js
   Audio preparation for long local sessions (bundled ffmpeg, no system install needed).
     probeDuration()  — length of a recording in seconds
     toCompactOpus()  — 16 kHz mono Opus at 24 kbit/s: about 11 MB per hour, under the inline-audio
                        limits of the cloud speech models (Gemini ~20 MB, Groq Whisper 25 MB),
                        so sessions of up to about two hours go to the cloud in one request. */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let FFMPEG = null;
try {
    FFMPEG = require('@ffmpeg-installer/ffmpeg').path;
} catch {
    FFMPEG = null; // audio is sent as recorded
}

const COMPACT_ABOVE_BYTES = 8 * 1024 * 1024;

function tmpFile(ext) {
    const dir = path.join(os.tmpdir(), 'echoscribe-audio');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
}

function run(args) {
    return new Promise((resolve, reject) => {
        execFile(FFMPEG, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
            if (err && !/Duration:/.test(stderr || '')) reject(new Error('ffmpeg: ' + String(stderr || err.message).slice(-300)));
            else resolve({ stdout, stderr: stderr || '' });
        });
    });
}

/** Duration in seconds, or null if it cannot be read. */
async function probeDuration(buffer) {
    if (!FFMPEG) return null;
    const input = tmpFile('bin');
    fs.writeFileSync(input, buffer);
    try {
        const { stderr } = await run(['-hide_banner', '-i', input]).catch(e => ({ stderr: e.message }));
        const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
    } finally {
        fs.unlink(input, () => { });
    }
}

/** Re-encode to compact mono Opus when the recording is large; otherwise return it unchanged. */
async function toCompactOpus(buffer, mimeType) {
    if (!FFMPEG || buffer.length <= COMPACT_ABOVE_BYTES) return { buffer, mimeType, compacted: false };
    const input = tmpFile('bin');
    const output = tmpFile('ogg');
    fs.writeFileSync(input, buffer);
    try {
        await run(['-hide_banner', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', output]);
        return { buffer: fs.readFileSync(output), mimeType: 'audio/ogg', compacted: true };
    } finally {
        fs.unlink(input, () => { });
        fs.unlink(output, () => { });
    }
}

module.exports = { probeDuration, toCompactOpus, available: () => !!FFMPEG };
