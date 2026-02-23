const { createClient } = require('@deepgram/sdk');
const { validateEnv } = require('../config/env');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { AppError } = require('../middleware/errorHandler');

const env = validateEnv();

// Initialize Deepgram SDK
const deepgram = createClient(env.DEEPGRAM_API_KEY);

/**
 * Maps standard ISO codes to Deepgram specific tags if needed.
 * Deepgram supports many standard ISO 639-1 tags.
 */
const langMap = {
    'en': 'en', 'hi': 'hi', 'ml': 'ml', 'ta': 'ta',
    'es': 'es', 'fr': 'fr', 'de': 'de', 'ja': 'ja',
    'ko': 'ko', 'zh': 'zh', 'pt': 'pt', 'ar': 'ar',
};

/**
 * Runs a standalone Python child process to calculate Average Fundamental Frequency (F0/Pitch)
 * for each speaker using Librosa, since Deepgram API doesn't return pitch.
 */
async function extractPitch(filePath, turns) {
    return new Promise((resolve) => {
        const pythonProcess = spawn('python', [
            path.join(__dirname, '../python/pitch_extract.py'),
            filePath,
            JSON.stringify(turns)
        ]);

        let dataString = '';
        let errString = '';

        pythonProcess.stdout.on('data', (data) => { dataString += data.toString(); });
        pythonProcess.stderr.on('data', (data) => { errString += data.toString(); });

        pythonProcess.on('close', (code) => {
            try {
                const jsonMatch = dataString.match(/\{.*\}/);
                if (jsonMatch) {
                    const result = JSON.parse(jsonMatch[0]);
                    if (result.success) return resolve(result.pitches);
                    console.error('[Pitch Extraction] Script error:', result.error);
                } else {
                    console.error('[Pitch Extraction] Invalid output:', errString);
                }
            } catch (e) {
                console.error('[Pitch Extraction] Parse error:', e);
            }
            resolve({}); // Safe fallback
        });
    });
}

/**
 * Transcribes audio and performs speaker diarization using Deepgram
 * @param {string} filePath Path to the audio file
 * @param {string} lang Target language code
 * @returns {object} { text, segments, turns }
 */
async function transcribeAndDiarizeWithDeepgram(filePath, lang = 'en') {
    if (!deepgram) throw new AppError('Deepgram service not initialized', 500);

    const dgLang = langMap[lang] || 'en';

    try {
        const audioBuffer = fs.readFileSync(filePath);

        // Deepgram Pre-recorded API options
        // using "nova-2" model for high accuracy and speed
        const options = {
            model: 'nova-2',
            language: dgLang,
            smart_format: true,
            diarize: true, // Enables Speaker Diarization
            punctuate: true,
            utterances: true, // Auto-groups words into speaker utterances
        };

        const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
            audioBuffer,
            options
        );

        if (error) {
            console.error('[Deepgram] Transcription Error:', error);
            throw new AppError(error.message || 'Deepgram API Error', 500);
        }

        const transcriptData = result.results.channels[0].alternatives[0];
        const utterances = result.results.utterances;

        // The unified raw text
        const fullText = transcriptData.transcript;

        // Grouping the deepgram utterances into our speaker 'segments' format
        // e.g { speaker: 1, text: "hello there", start: 0.0, end: 1.5 }
        const segments = [];
        const turns = [];

        if (utterances && utterances.length > 0) {
            utterances.forEach(u => {
                const speakerId = (u.speaker || 0) + 1; // Deepgram is 0-indexed, make it 1-indexed

                const turnObj = {
                    speaker: speakerId,
                    text: u.transcript,
                    start: u.start,
                    end: u.end,
                    avgPitch: 0 // Will be assigned shortly by Python
                };

                // Add to standard segments list (same format frontend expects)
                segments.push(turnObj);
                turns.push(turnObj);
            });

            // Extract true F0 pitch using librosa microservice
            try {
                console.log('[Deepgram] Extracting valid vocal frequencies...');
                const pitchData = await extractPitch(filePath, turns);
                turns.forEach(t => {
                    t.avgPitch = pitchData[t.speaker] || 0;
                });
            } catch (pitchErr) {
                console.warn('[Deepgram] Pitch extraction failed, defaulting to 0:', pitchErr.message);
            }
        }

        return {
            text: fullText,
            segments: segments,
            turns: turns
        };

    } catch (err) {
        console.error('[Deepgram Service] Error:', err);
        throw new AppError(err.message || 'Failed to process audio with Deepgram.', 500);
    }
}

module.exports = {
    transcribeAndDiarizeWithDeepgram
};
