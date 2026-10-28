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

    const result = await aiService.summarizeTranscript(text, language || 'en', mode, { chains: req.providerChains });

    // Keep the speaker-turn timings (roles and times only) and the pipeline's providers with the note,
    // so the conversation strip and provenance can be shown for any saved session
    if (req.body.conversation) {
        try {
            const conv = JSON.parse(req.body.conversation);
            result.conversation = {
                turns: (Array.isArray(conv.turns) ? conv.turns : []).slice(0, 2000).map(t => ({
                    role: String(t.role || '').slice(0, 30),
                    start: Number(t.start) || 0,
                    end: Number(t.end) || 0,
                    words: Number(t.words) || 0,
                })),
                providers: {
                    stt: conv.providers?.stt ? String(conv.providers.stt).slice(0, 80) : null,
                    diarization: conv.providers?.diarization ? String(conv.providers.diarization).slice(0, 80) : null,
                    roles: conv.providers?.roles ? String(conv.providers.roles).slice(0, 80) : null,
                },
                durationSec: Number(conv.durationSec) || null,
            };
        } catch { /* malformed conversation metadata is ignored */ }
    }

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
    const patientId = req.query.patientId;

    if (!mode || (mode !== 'Therapy' && mode !== 'Mentoring')) {
        throw new AppError("Strict Data Isolation: 'mode' is required.", 400);
    }

    let data;
    if (patientId) {
        data = await dbService.getPatientSessions(req.supabaseToken, patientId, userId, mode);
    } else {
        data = await dbService.getHistory(req.supabaseToken, userId, mode);
    }
    
    res.json(data);
});

// DELETE /api/session/:id
const deleteSessionHandler = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;
    const mode = req.query.mode;

    if (!mode || (mode !== 'Therapy' && mode !== 'Mentoring')) {
        throw new AppError("Strict Data Isolation: 'mode' query is required.", 400);
    }

    await dbService.deleteSession(req.supabaseToken, id, userId, mode);
    res.json({ success: true, message: 'Session deleted.' });
});

// GET /api/session/:id?mode=
const getSession = asyncHandler(async (req, res) => {
    try {
        res.json(await dbService.getSessionById(req.supabaseToken, req.params.id, req.user.id, req.query.mode));
    } catch (err) {
        throw new AppError('Session not found in this workspace.', 404);
    }
});

// PUT /api/session/:id?mode= — save an edited note
const updateSession = asyncHandler(async (req, res) => {
    const { analysisJson } = req.body || {};
    if (!analysisJson || typeof analysisJson !== 'object') {
        throw new AppError('analysisJson is required.', 400);
    }
    const summary = analysisJson.soap ? analysisJson.soap.subjective : (analysisJson.grow ? analysisJson.grow.goal : undefined);
    const data = await dbService.updateSession(req.supabaseToken, req.params.id, req.user.id, req.query.mode, { analysisJson, summary });
    res.json(data);
});

// GET /api/session/:id/audio?mode=Therapy[&clean=1] — the saved recording for listening again.
// clean=1 returns a copy with background noise reduced (FFmpeg); the note was made from the original.
const getSessionAudio = asyncHandler(async (req, res) => {
    const session = await dbService.getSessionById(req.supabaseToken, req.params.id, req.user.id, req.query.mode);
    if (!session?.audio_url) throw new AppError('No recording was saved with this session.', 404);
    const upstream = await fetch(session.audio_url);
    if (!upstream.ok) throw new AppError('The saved recording could not be read.', 502);
    let buffer = Buffer.from(await upstream.arrayBuffer());
    let type = upstream.headers.get('content-type') || 'audio/webm';
    if (req.query.clean === '1') {
        const cleaned = await require('../services/audio-prep').cleanForListening(buffer);
        buffer = cleaned.buffer;
        type = cleaned.mimeType;
    }
    res.set({ 'Content-Type': type, 'Content-Length': buffer.length, 'Cache-Control': 'private, no-store' });
    res.send(buffer);
});

module.exports = { summarize, saveSession, getHistory, getSession, getSessionAudio, updateSession, deleteSession: deleteSessionHandler };
