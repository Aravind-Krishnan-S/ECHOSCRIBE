const aiService = require('../services/ai.service');
const dbService = require('../services/db.service');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// POST /api/summarize — analyze + auto-save
const summarize = asyncHandler(async (req, res) => {
    const { text, patientId, language } = req.body;

    if (!text || text.trim().length === 0) {
        throw new AppError('No transcript text provided.', 400);
    }

    const result = await aiService.summarizeTranscript(text, language || 'en');

    // Auto-save the session to the database
    let sessionId = null;
    try {
        const saved = await dbService.saveSession(req.supabaseToken, {
            userId: req.user.id,
            transcript: text,
            summary: result.soap ? result.soap.subjective : '',
            analysisJson: result,
            patientId: patientId || null,
        });
        if (saved && saved.length > 0) {
            sessionId = saved[0].id;
        }
    } catch (saveErr) {
        console.error('[EchoScribe] Auto-save failed:', saveErr.message);
        // Don't fail the request — still return the analysis
    }

    res.json({ ...result, sessionId, saved: !!sessionId });
});

// POST /api/session
const saveSession = asyncHandler(async (req, res) => {
    const { transcript, summary, analysisJson, patientId } = req.body;
    const userId = req.user.id;

    const data = await dbService.saveSession(req.supabaseToken, {
        userId,
        transcript,
        summary,
        analysisJson,
        patientId: patientId || null,
    });

    res.json({ success: true, data });
});

// GET /api/history
const getHistory = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const data = await dbService.getHistory(req.supabaseToken, userId);
    res.json(data);
});

module.exports = { summarize, saveSession, getHistory };
