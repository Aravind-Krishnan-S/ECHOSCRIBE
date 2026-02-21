const aiService = require('../services/ai.service');
const dbService = require('../services/db.service');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// GET /api/profile
const getProfile = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const sessions = await dbService.getRecentSessions(req.supabaseToken, userId, 20);

    if (!sessions || sessions.length === 0) {
        throw new AppError('No sessions found. Record some sessions first.', 404);
    }

    const profile = await aiService.generateProfile(sessions);
    res.json(profile);
});

module.exports = { getProfile };
