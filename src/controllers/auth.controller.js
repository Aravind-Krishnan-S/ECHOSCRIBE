const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const { getSupabase } = require('../services/db.service');
const profileService = require('../services/profile.service');
const { invalidateUserChains } = require('../services/provider-chain');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// POST /api/auth/signup
const signup = asyncHandler(async (req, res) => {
    const { email, password, full_name, role } = req.body;
    const supabase = getSupabase();

    // Name and role ride along as signup metadata; the profile row is created from them on first login
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name, role } },
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

    let data, error;
    try {
        ({ data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        }));
    } catch (networkErr) {
        // Network-level failure (DNS, timeout, Supabase project paused, etc.)
        console.error('[Auth] Supabase unreachable:', networkErr.message);
        throw new AppError(
            'Unable to reach authentication service. Please check your internet connection and try again.',
            503
        );
    }

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

// GET /api/auth/profile
const getProfile = asyncHandler(async (req, res) => {
    const profile = await profileService.getProfile(req.supabaseToken, req.user);
    res.json({ ...profile, email: req.user.email });
});

// PUT /api/auth/profile
const updateProfile = asyncHandler(async (req, res) => {
    const profile = await profileService.updateProfile(req.supabaseToken, req.user, req.body);
    invalidateUserChains(req.user.id);
    res.json({ ...profile, email: req.user.email });
});

// POST /api/auth/avatar  (multipart field "photo")
const uploadAvatar = asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Choose a photo to upload.', 400);
    try {
        const buffer = fs.readFileSync(req.file.path);
        const url = await profileService.uploadAvatar(req.supabaseToken, req.user.id, buffer, req.file.mimetype);
        const profile = await profileService.updateProfile(req.supabaseToken, req.user, { avatar_url: url });
        res.json({ ...profile, email: req.user.email });
    } finally {
        fs.unlink(req.file.path, () => { });
    }
});

// POST /api/auth/password
const changePassword = asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body;
    // A fresh client per request, so the shared server client never holds this user's session
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await client.auth.signInWithPassword({ email: req.user.email, password: current_password });
    if (signInError) throw new AppError('Your current password is not correct.', 400);
    const { error } = await client.auth.updateUser({ password: new_password });
    if (error) throw new AppError(error.message, 400);
    await client.auth.signOut();
    res.json({ message: 'Password changed.' });
});

module.exports = { signup, login, logout, me, refresh, getProfile, updateProfile, uploadAvatar, changePassword };
