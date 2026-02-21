const { getSupabase } = require('../services/db.service');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// POST /api/auth/signup
const signup = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const supabase = getSupabase();

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
    });

    if (error) {
        throw new AppError(error.message, 400);
    }

    res.status(201).json({
        message: 'Account created successfully. Please check your email to verify your account.',
        user: data.user ? { id: data.user.id, email: data.user.email } : null,
        session: data.session,
    });
});

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const supabase = getSupabase();

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (error) {
        throw new AppError('Invalid email or password.', 401);
    }

    res.json({
        message: 'Login successful',
        user: { id: data.user.id, email: data.user.email },
        session: {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at,
        },
    });
});

// POST /api/auth/logout
const logout = asyncHandler(async (req, res) => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    res.json({ message: 'Logged out successfully' });
});

// GET /api/auth/me
const me = asyncHandler(async (req, res) => {
    res.json({
        user: req.user,
    });
});

// POST /api/auth/refresh
const refresh = asyncHandler(async (req, res) => {
    const { refresh_token } = req.body;
    const supabase = getSupabase();

    const { data, error } = await supabase.auth.refreshSession({
        refresh_token,
    });

    if (error) {
        throw new AppError('Failed to refresh session.', 401);
    }

    res.json({
        session: {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at,
        },
    });
});

module.exports = { signup, login, logout, me, refresh };
