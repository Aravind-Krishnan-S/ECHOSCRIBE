const { transcribeAudio, identifySpeakers, diarizeTranscript } = require('../services/ai.service');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const fs = require('fs');

// POST /api/transcribe-audio
const transcribe = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new AppError('No audio file provided.', 400);
    }

    const lang = req.body.language || 'en';

    try {
        const result = await transcribeAudio(req.file.path, lang);

        // Clean up temp file
        fs.unlink(req.file.path, () => { });

        // Return text + segments with timestamps
        res.json({
            text: result.text,
            segments: result.segments,
        });
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
    const { transcript } = req.body;
    if (!transcript || !transcript.trim()) {
        throw new AppError('Transcript is required.', 400);
    }

    const result = await identifySpeakers(transcript);
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
