/* src/services/key-vault.js
   Provider API keys a user chose to "Sync to my account".
   Encrypted with AES-256-GCM using PROVIDER_KEYS_SECRET before they reach the database;
   the API only ever returns family, label and the last four characters. */

const crypto = require('crypto');
const { getAuthClient } = require('./db.service');
const { getFamily } = require('./provider-registry');
const { AppError } = require('../middleware/errorHandler');

function secretKey() {
    const secret = process.env.PROVIDER_KEYS_SECRET;
    if (!secret || secret.length < 32) {
        throw new AppError('Key sync is not configured: set PROVIDER_KEYS_SECRET (32+ characters) in .env.', 503);
    }
    return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), auth_tag: cipher.getAuthTag().toString('base64') };
}

function decrypt({ ciphertext, iv, auth_tag }) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(auth_tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

const publicView = (row) => ({ id: row.id, family: row.family, label: row.label, last4: row.last4, created_at: row.created_at });

async function listKeys(token, userId) {
    const db = getAuthClient(token);
    const { data, error } = await db.from('user_provider_keys').select('id, family, label, last4, created_at')
        .eq('user_id', userId).order('created_at', { ascending: true });
    if (error) throw new AppError(error.message, 500);
    return data.map(publicView);
}

async function addKey(token, userId, { family, key, label }) {
    const def = getFamily(family);
    if (!def || !def.requiresKey) throw new AppError(`Unknown provider family "${family}".`, 400);
    const trimmed = String(key || '').trim();
    if (trimmed.length < 8 || trimmed.length > 400) throw new AppError('That does not look like an API key.', 400);

    const db = getAuthClient(token);
    const { data, error } = await db.from('user_provider_keys').insert({
        user_id: userId,
        family: def.key,
        label: label ? String(label).slice(0, 60) : null,
        last4: trimmed.slice(-4),
        ...encrypt(trimmed),
    }).select('id, family, label, last4, created_at').single();
    if (error) throw new AppError(error.message, 500);
    return publicView(data);
}

async function deleteKey(token, userId, id) {
    const db = getAuthClient(token);
    const { error } = await db.from('user_provider_keys').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
}

/** Decrypted synced keys grouped by family — server-side only, never sent to the client. */
async function keysByFamily(token, userId) {
    if (!process.env.PROVIDER_KEYS_SECRET) return {};
    const db = getAuthClient(token);
    const { data, error } = await db.from('user_provider_keys').select('family, ciphertext, iv, auth_tag').eq('user_id', userId);
    if (error || !data) return {};
    const out = {};
    for (const row of data) {
        try {
            (out[row.family] = out[row.family] || []).push(decrypt(row));
        } catch (err) {
            console.error(`[KeyVault] Could not decrypt a ${row.family} key (PROVIDER_KEYS_SECRET changed?)`);
        }
    }
    return out;
}

module.exports = { listKeys, addKey, deleteKey, keysByFamily, encrypt, decrypt };
