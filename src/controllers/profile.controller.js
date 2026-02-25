/* src/controllers/profile.controller.js */
const aiService = require('../services/ai.service');
const dbService = require('../services/db.service');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// GET /api/profile
const getProfile = asyncHandler(async (req, res) => {
    const mode = req.query.mode;
    if (!mode || (mode !== 'Therapy' && mode !== 'Mentoring')) {
        throw new AppError("Strict Data Isolation: A valid 'mode' (Therapy or Mentoring) is required to generate a profile.", 400);
    }

    const userId = req.user.id;

    const sessions = await dbService.getRecentSessions(req.supabaseToken, userId, mode, 20);

    if (!sessions || sessions.length === 0) {
        throw new AppError(`No sessions found for ${mode} mode. Record some sessions first.`, 404);
    }

    const profile = await aiService.generateProfile(sessions);
    res.json(profile);
});

module.exports = { getProfile };
