/* src/controllers/session.controller.js */
const aiService = require('../services/ai.service');
const dbService = require('../services/db.service');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const fs = require('fs');

// POST /api/summarize — analyze + auto-save
const summarize = asyncHandler(async (req, res) => {
    let { text, patientId, language, mode } = req.body;

    if (mode) {
        mode = mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase();
    }

    if (!mode || (mode !== 'Therapy' && mode !== 'Mentoring')) {
        if (req.file) fs.unlink(req.file.path, () => { });
        throw new AppError("Strict Data Isolation: 'mode' in form data is required and must be Therapy or Mentoring.", 400);
    }

    if (!text || text.trim().length === 0) {
        if (req.file) fs.unlink(req.file.path, () => { });
        throw new AppError('No transcript text provided.', 400);
    }

    const result = await aiService.summarizeTranscript(text, language || 'en', mode);

    // 1. Upload audio if present
    let audioUrl = null;
    if (req.file) {
        try {
            const fileBuffer = fs.readFileSync(req.file.path);
            audioUrl = await dbService.uploadAudioToStorage(
                req.supabaseToken,
                req.user.id,
                fileBuffer,
                req.file.filename
            );
            fs.unlink(req.file.path, () => { }); // clean up local temp file
        } catch (uploadErr) {
            console.error('[SessionController] Audio upload failed:', uploadErr.message);
            // Non-fatal, we still want to save the SOAP note
            if (req.file) fs.unlink(req.file.path, () => { });
        }
    }

    // 2. Auto-save the session to the database
    let sessionId = null;
    try {
        const saved = await dbService.saveSession(req.supabaseToken, {
            userId: req.user.id,
            transcript: text,
            summary: result.soap ? result.soap.subjective : (result.grow ? result.grow.goal : ''),
            analysisJson: result,
            patientId: patientId || null,
            audioUrl: audioUrl,
            sessionMode: mode
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
    const { transcript, summary, analysisJson, patientId, mode } = req.body;
    const userId = req.user.id;

    if (!mode || (mode !== 'Therapy' && mode !== 'Mentoring')) {
        if (req.file) fs.unlink(req.file.path, () => { });
        throw new AppError("Strict Data Isolation: 'mode' is required and must be Therapy or Mentoring.", 400);
    }

    let parsedAnalysis = {};
    if (typeof analysisJson === 'string') {
        try { parsedAnalysis = JSON.parse(analysisJson); } catch (e) { }
    } else {
        parsedAnalysis = analysisJson || {};
    }

    // 1. Upload audio if present
    let audioUrl = null;
    if (req.file) {
        try {
            const fileBuffer = fs.readFileSync(req.file.path);
            audioUrl = await dbService.uploadAudioToStorage(
                req.supabaseToken,
                userId,
                fileBuffer,
                req.file.filename
            );
            fs.unlink(req.file.path, () => { });
        } catch (uploadErr) {
            console.error('[SessionController] Audio upload failed:', uploadErr.message);
            if (req.file) fs.unlink(req.file.path, () => { });
        }
    }

    const data = await dbService.saveSession(req.supabaseToken, {
        userId,
        transcript,
        summary,
        analysisJson: parsedAnalysis,
        patientId: patientId || null,
        audioUrl: audioUrl,
        sessionMode: mode
    });

    res.json({ success: true, data });
});

// GET /api/history
const getHistory = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const mode = req.query.mode;

    if (!mode || (mode !== 'Therapy' && mode !== 'Mentoring')) {
        throw new AppError("Strict Data Isolation: 'mode' is required.", 400);
    }

    const data = await dbService.getHistory(req.supabaseToken, userId, mode);
    res.json(data);
});

module.exports = { summarize, saveSession, getHistory };
