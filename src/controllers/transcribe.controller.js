const { transcribeAudio, identifySpeakers, diarizeTranscript } = require('../services/ai.service');
const { transcribeAndDiarizeWithDeepgram } = require('../services/deepgram.service');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const fs = require('fs');

// POST /api/transcribe-audio
const transcribe = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new AppError('No audio file provided.', 400);
    }

    const lang = req.body.language || 'en';

    try {
        let result;

        if (req.body.live === 'true') {
            // Live chunks just need raw text fast for visual feedback
            result = await transcribeAudio(req.file.path, lang);

            res.json({
                text: result.text,
                segments: result.segments // whisper segments
            });
        } else {
            // Full completed recordings go to Deepgram for perfect diarization
            result = await transcribeAndDiarizeWithDeepgram(req.file.path, lang);

            res.json({
                text: result.text,
                segments: result.segments,
                turns: result.turns // deepgram speaker turns
            });
        }

        // Clean up temp file
        fs.unlink(req.file.path, () => { });
    } catch (err) {
        // Clean up temp file on error too
        if (req.file && req.file.path) {
            fs.unlink(req.file.path, () => { });
        }
        console.error('[Transcribe] Error:', err.message || err);
        throw new AppError(err.message || 'Transcription failed.', 500);
    }
});

// POST /api/identify-speakers
const identifySpeakersHandler = asyncHandler(async (req, res) => {
    const { transcript, pitchMetadata, mode } = req.body;
    if (!transcript || !transcript.trim()) {
        throw new AppError('Transcript is required.', 400);
    }

    const sessionMode = mode || 'Therapy';
    const result = await identifySpeakers(transcript, pitchMetadata, sessionMode);
    res.json(result);
});

// POST /api/diarize-transcript
const diarizeHandler = asyncHandler(async (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) {
        throw new AppError('Transcript text is required.', 400);
    }

    const turns = await diarizeTranscript(text);
    res.json({ turns });
});

module.exports = { transcribe, identifySpeakers: identifySpeakersHandler, diarize: diarizeHandler };
