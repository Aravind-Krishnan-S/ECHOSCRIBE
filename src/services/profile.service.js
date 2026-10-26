/* src/services/profile.service.js
   User profile, preferences, onboarding progress and model settings
   (table user_profiles, row-level security: each user reads and writes only their own row). */

const { getAuthClient } = require('./db.service');
const { AppError } = require('../middleware/errorHandler');

const PROFILE_FIELDS = [
    'full_name', 'avatar_url', 'title', 'organisation', 'license_id', 'specialisations',
    'phone', 'preferred_contact', 'role', 'prefs', 'onboarding', 'model_settings',
];

function missingTable(error) {
    return error && (error.code === '42P01' || /user_profiles/.test(error.message || '') && /does not exist|schema cache/.test(error.message || ''));
}

/** The user's profile; creates it on first use, seeded from the signup metadata. */
async function getProfile(token, user) {
    const db = getAuthClient(token);
    const { data, error } = await db.from('user_profiles').select('*').eq('user_id', user.id).maybeSingle();
    if (missingTable(error)) {
        throw new AppError('Profiles are not set up yet: run supabase/migrations/user_profiles_and_keys.sql.', 503);
    }
    if (error) throw new AppError(error.message, 500);
    if (data) return data;

    const meta = user.metadata || {};
    const seed = {
        user_id: user.id,
        full_name: meta.full_name || null,
        role: ['therapist', 'mentor', 'both'].includes(meta.role) ? meta.role : 'therapist',
    };
    const { data: created, error: insertError } = await db.from('user_profiles').insert(seed).select().single();
    if (insertError) throw new AppError(insertError.message, 500);
    return created;
}

/** Partial update; jsonb fields (prefs, onboarding, model_settings) are merged, not replaced. */
async function updateProfile(token, user, patch) {
    const current = await getProfile(token, user);
    const update = {};
    for (const field of PROFILE_FIELDS) {
        if (!(field in patch)) continue;
        if (['prefs', 'onboarding', 'model_settings'].includes(field)) {
            update[field] = { ...(current[field] || {}), ...(patch[field] || {}) };
        } else {
            update[field] = patch[field];
        }
    }
    update.updated_at = new Date().toISOString();

    const db = getAuthClient(token);
    const { data, error } = await db.from('user_profiles').update(update).eq('user_id', user.id).select().single();
    if (error) throw new AppError(error.message, 500);
    return data;
}

/** Upload a profile photo to the public "avatars" bucket under the user's own folder. */
async function uploadAvatar(token, userId, buffer, mimeType) {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mimeType];
    if (!ext) throw new AppError('Use a PNG, JPEG or WebP image.', 400);

    const db = getAuthClient(token);
    const path = `${userId}/avatar-${Date.now()}.${ext}`;
    const { error } = await db.storage.from('avatars').upload(path, buffer, { contentType: mimeType, upsert: true });
    if (error) throw new AppError('Photo upload failed: ' + error.message, 500);
    return db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

module.exports = { getProfile, updateProfile, uploadAvatar };
