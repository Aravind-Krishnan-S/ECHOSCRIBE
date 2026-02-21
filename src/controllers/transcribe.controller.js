const { transcribeAudio } = require('../services/ai.service');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const fs = require('fs');

// POST /api/transcribe-audio
const transcribe = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new AppError('No audio file provided.', 400);
    }

    const lang = req.body.language || 'en';

    try {
        const text = await transcribeAudio(req.file.path, lang);

        // Clean up temp file
        fs.unlink(req.file.path, () => { });

        res.json({ text });
    } catch (err) {
        // Clean up temp file on error too
        if (req.file && req.file.path) {
            fs.unlink(req.file.path, () => { });
        }
        console.error('[Transcribe] Error:', err.message || err);
        throw new AppError(err.message || 'Transcription failed.', 500);
    }
});

module.exports = { transcribe };
