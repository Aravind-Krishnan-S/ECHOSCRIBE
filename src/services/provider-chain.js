/* src/services/provider-chain.js
   Embedded model router: every processing role ("slot") is served by a combo —
   an ordered list of { family, model, keys[] } targets plus a routing strategy.
   The design follows OmniRoute's combos (MIT, https://github.com/diegosouzapw/OmniRoute),
   running in-process instead of as a separate gateway:

     1. order the targets with the combo's strategy (routing/strategies.js)
     2. skip providers and keys that are cooling down (routing/cooldown-tracker.js)
     3. try targets until one succeeds; key-specific failures try the next key first
     4. if everything fails, throw HTTP 503 with a structured log of the attempts

   Where a slot's combo comes from (first match wins):
     1. The signed-in user's Provider Settings (X-Provider-Chain header) — not for DIARIZE
     2. ROLE_CHAIN_<SLOT> — comma-separated family:model:key targets, e.g.
        ROLE_CHAIN_NOTE_SYNTH=groq:openai/gpt-oss-120b:gsk_a,gemini:gemini-2.0-flash:AIza_b
        Omitting the key (family:model) uses that family's keys from the legacy variables
        (GEMINI_API_KEYS, GROQ_API_KEY, DEEPGRAM_API_KEY, ...).
        Repeating the same family:model with different keys forms a multi-key pool.
     3. The shipped reference configuration (Gemini / Groq / Deepgram / SpeechBrain).
   The strategy comes from the user's settings, ROLE_STRATEGY_<SLOT>, ROUTING_STRATEGY, or "priority". */

const { AppError } = require('../middleware/errorHandler');
const { getFamily } = require('./provider-registry');
const { getPool, poolId } = require('./provider-pool');
const tracker = require('./routing/cooldown-tracker');
const strategies = require('./routing/strategies');

const SLOTS = {
    STT: { label: 'Speech-to-text', capability: 'transcribe', userConfigurable: true, timeoutMs: 180_000 },
    DIARIZE: { label: 'Speaker separation', capability: 'diarize', userConfigurable: false, timeoutMs: 600_000 },
    ROLE_LABEL: { label: 'Role labelling (clinician/client)', capability: 'chat', userConfigurable: true, timeoutMs: 90_000 },
    NOTE_SYNTH: { label: 'Note synthesis (SOAP/GROW)', capability: 'chat', userConfigurable: true, timeoutMs: 120_000 },
    PROFILE_GEN: { label: 'Longitudinal profile', capability: 'chat', userConfigurable: true, timeoutMs: 120_000 },
    VERIFY: { label: 'Note verification & second-opinion risk screen', capability: 'chat', userConfigurable: true, timeoutMs: 90_000 },
};

// ─── Legacy key discovery (keeps existing .env files working) ───

function collectKeys(...values) {
    const keys = [];
    const seen = new Set();
    values.flat().forEach(v => {
        String(v || '').split(',').forEach(k => {
            const t = k.trim();
            if (t && !seen.has(t)) { seen.add(t); keys.push(t); }
        });
    });
    return keys;
}

function legacyKeys(family) {
    const env = process.env;
    switch (family) {
        case 'gemini': {
            // GEMINI_API_KEYS=k1,k2 · GEMINI_API_KEY=k · numbered 1_GEMINI_API_KEY=k (any case)
            const numbered = Object.keys(env)
                .filter(n => /gemini_api_key/i.test(n) && n !== 'GEMINI_API_KEY' && n !== 'GEMINI_API_KEYS')
                .map(n => env[n]);
            return collectKeys(env.GEMINI_API_KEYS, env.GEMINI_API_KEY, numbered);
        }
        case 'groq': return collectKeys(env.GROQ_API_KEYS, env.GROQ_API_KEY);
        case 'deepgram': return collectKeys(env.DEEPGRAM_API_KEYS, env.DEEPGRAM_API_KEY);
        default: return collectKeys(env[`${family.toUpperCase()}_API_KEYS`], env[`${family.toUpperCase()}_API_KEY`]);
    }
}

// ─── Target parsing ───

/** Merge targets that share family+model into one multi-key target (first position wins). */
function mergeEntries(entries) {
    const merged = [];
    const byId = new Map();
    for (const e of entries) {
        const id = `${e.family}|${e.model}`;
        if (byId.has(id)) {
            const target = byId.get(id);
            e.keys.forEach(k => { if (!target.keys.includes(k)) target.keys.push(k); });
        } else {
            const copy = { family: e.family, model: e.model, keys: [...e.keys] };
            byId.set(id, copy);
            merged.push(copy);
        }
    }
    return merged;
}

/** Drop targets whose family needs a key but has none. */
function usable(entries) {
    return entries.filter(e => {
        const def = getFamily(e.family);
        return def && (!def.requiresKey || e.keys.length > 0);
    });
}

/**
 * Parse "family:model[:key],family:model[:key],..." — the key is the last
 * segment when three or more are present, so model names may contain ':'.
 */
function parseChainString(str, slot) {
    const entries = String(str).split(',').map(s => s.trim()).filter(Boolean).map(token => {
        const parts = token.split(':');
        const family = parts[0].toLowerCase();
        const def = getFamily(family);
        if (!def) throw new Error(`ROLE_CHAIN_${slot}: unknown provider family "${family}"`);
        if (!def.capabilities.includes(SLOTS[slot].capability)) {
            throw new Error(`ROLE_CHAIN_${slot}: family "${family}" cannot ${SLOTS[slot].capability}`);
        }
        let model, keys;
        if (parts.length >= 3 && def.requiresKey) {
            model = parts.slice(1, -1).join(':');
            keys = [parts[parts.length - 1]];
        } else {
            model = parts.slice(1).join(':');
            keys = def.requiresKey ? legacyKeys(family) : [];
        }
        if (!model) throw new Error(`ROLE_CHAIN_${slot}: missing model in "${family}"`);
        return { family, model, keys };
    });
    return usable(mergeEntries(entries));
}

function referenceTargets(slot) {
    const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    // Llama 3.3 70B (used in the paper's evaluation) has been retired by Groq; gpt-oss-120b replaces it
    const groqModel = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
    const groqSttModel = process.env.GROQ_STT_MODEL || 'whisper-large-v3';
    const deepgramModel = process.env.DEEPGRAM_MODEL || 'nova-2';
    const gemini = { family: 'gemini', model: geminiModel, keys: legacyKeys('gemini') };
    const groq = { family: 'groq', model: groqModel, keys: legacyKeys('groq') };
    const deepgram = { family: 'deepgram', model: deepgramModel, keys: legacyKeys('deepgram') };
    const sb = { family: 'speechbrain', model: 'ecapa-tdnn', keys: [] };

    const reference = {
        STT: [gemini, deepgram, { family: 'groq', model: groqSttModel, keys: legacyKeys('groq') }],
        DIARIZE: [sb, deepgram, gemini],
        ROLE_LABEL: [groq, gemini],
        NOTE_SYNTH: [gemini, groq],
        PROFILE_GEN: [gemini, groq],
        // Opposite order to NOTE_SYNTH so the checker is normally a different vendor from the writer
        VERIFY: [groq, gemini],
    };
    return usable(reference[slot].map(e => ({ ...e, keys: [...e.keys] })));
}

function serverStrategy(slot) {
    return strategies.normalizeStrategy(process.env[`ROLE_STRATEGY_${slot}`] || process.env.ROUTING_STRATEGY);
}

/** Server-side combo for a slot: { targets, strategy, source }. */
function getServerChain(slot) {
    const strategy = serverStrategy(slot);
    const custom = process.env[`ROLE_CHAIN_${slot}`];
    if (custom && custom.trim()) {
        try {
            return { entries: parseChainString(custom, slot), strategy, source: `ROLE_CHAIN_${slot}` };
        } catch (err) {
            console.error(`[Router] ${err.message} — using reference configuration`);
        }
    }
    return { entries: referenceTargets(slot), strategy, source: 'reference' };
}

// ─── Per-user combos (Settings → Models & API keys) ───

const MAX_ENTRIES = 10;
const MAX_KEYS = 20;

function cleanKeys(list) {
    return Array.isArray(list)
        ? list.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim().slice(0, 400)).slice(0, MAX_KEYS)
        : [];
}

/**
 * Parse the X-Provider-Chain header: base64-encoded JSON.
 *   { "keys": { "gemini": ["..."], "groq": ["..."] } }        — keys kept only in this browser
 * Older clients sent whole combos per slot instead, still accepted:
 *   { "NOTE_SYNTH": { "strategy": "round-robin", "targets": [{ "family", "model", "keys": [...] }] } }
 *   { "NOTE_SYNTH": [ { "family", "model", "keys": [...] } ] }
 * Returns { localKeys, combos }.
 */
function parseHeader(headerValue) {
    if (!headerValue) return { localKeys: {}, combos: {} };
    let data;
    try {
        data = JSON.parse(Buffer.from(String(headerValue), 'base64').toString('utf8'));
    } catch {
        throw new AppError('Provider Settings are corrupted. Re-save them on the Settings page.', 400);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { localKeys: {}, combos: {} };

    const localKeys = {};
    for (const [family, list] of Object.entries(data.keys || {})) {
        const def = getFamily(family);
        if (def && def.requiresKey) localKeys[def.key] = cleanKeys(list);
    }

    const combos = {};
    for (const [slot, value] of Object.entries(data)) {
        const def = SLOTS[slot];
        const list = Array.isArray(value) ? value : value?.targets;
        if (!def || !def.userConfigurable || !Array.isArray(list) || list.length === 0) continue;
        const entries = list.slice(0, MAX_ENTRIES).map(e => {
            const family = getFamily(e?.family);
            const model = typeof e?.model === 'string' ? e.model.trim().slice(0, 120) : '';
            if (!family || !family.capabilities.includes(def.capability) || !model) {
                throw new AppError(`Provider Settings: invalid entry for ${slot}.`, 400);
            }
            return { family: family.key, model, keys: cleanKeys(e?.keys) };
        });
        const ok = usable(mergeEntries(entries));
        if (ok.length > 0) {
            combos[slot] = { entries: ok, strategy: strategies.normalizeStrategy(Array.isArray(value) ? null : value.strategy) };
        }
    }
    return { localKeys, combos };
}

/** Backwards-compatible name used by tests: header combos only. */
function parseUserChains(headerValue) {
    return parseHeader(headerValue).combos;
}

function mergeKeyMaps(...maps) {
    const out = {};
    for (const map of maps) {
        for (const [family, keys] of Object.entries(map || {})) {
            out[family] = [...new Set([...(out[family] || []), ...keys])];
        }
    }
    return out;
}

/**
 * Build the user's combo for every user-configurable slot.
 *   modelSettings: { strategy?, combos?: { SLOT: { strategy, targets: [{ family, model }] } } }  (no secrets)
 *   userKeys: { family: [keys] } — browser-local keys merged with synced keys
 * A slot with chosen models uses them with the user's keys. A slot with no chosen models but a key for
 * one of the server chain's families tries the user's key first, then the server's targets.
 */
function buildUserCombos({ headerCombos = {}, modelSettings = {}, userKeys = {} }) {
    const combos = {};
    for (const [slot, def] of Object.entries(SLOTS)) {
        if (!def.userConfigurable) continue;
        const withUserKeys = (e) => ({ ...e, keys: [...new Set([...(e.keys || []), ...(userKeys[e.family] || [])])] });

        if (headerCombos[slot]) {
            combos[slot] = { ...headerCombos[slot], entries: usable(headerCombos[slot].entries.map(withUserKeys)) };
            continue;
        }

        const chosen = modelSettings.combos && modelSettings.combos[slot];
        const strategy = strategies.normalizeStrategy(chosen?.strategy || modelSettings.strategy || serverStrategy(slot));
        if (chosen && Array.isArray(chosen.targets) && chosen.targets.length) {
            const entries = chosen.targets.slice(0, MAX_ENTRIES)
                .map(t => ({ family: String(t.family || '').toLowerCase(), model: String(t.model || '').trim().slice(0, 120), keys: [] }))
                .filter(t => {
                    const fam = getFamily(t.family);
                    return fam && fam.capabilities.includes(def.capability) && t.model;
                })
                .map(withUserKeys);
            const ok = usable(mergeEntries(entries));
            if (ok.length) combos[slot] = { entries: ok, strategy };
            continue;
        }

        const server = getServerChain(slot).entries;
        if (!server.some(e => (userKeys[e.family] || []).length)) continue;
        const entries = [];
        for (const e of server) {
            if ((userKeys[e.family] || []).length) entries.push({ family: e.family, model: e.model, keys: [...userKeys[e.family]] });
            entries.push(e);
        }
        // Same family+model with user keys first: keep them as separate targets so the user's key is tried first
        combos[slot] = { entries: usable(entries), strategy };
    }
    return combos;
}

// Profile model settings and synced keys, cached briefly per user
const USER_CACHE_MS = 30_000;
const userCache = new Map();

function invalidateUserChains(userId) {
    userCache.delete(userId);
}

async function loadUserRouting(req) {
    const userId = req.user && req.user.id;
    if (!userId || !req.supabaseToken) return { modelSettings: {}, syncedKeys: {} };
    const hit = userCache.get(userId);
    if (hit && Date.now() - hit.at < USER_CACHE_MS) return hit.value;

    let modelSettings = {};
    let syncedKeys = {};
    try {
        const { getAuthClient } = require('./db.service');
        const { data } = await getAuthClient(req.supabaseToken)
            .from('user_profiles').select('model_settings').eq('user_id', userId).maybeSingle();
        modelSettings = (data && data.model_settings) || {};
    } catch { /* profiles not migrated yet: no user model settings */ }
    try {
        syncedKeys = await require('./key-vault').keysByFamily(req.supabaseToken, userId);
    } catch { /* key sync not configured */ }

    const value = { modelSettings, syncedKeys };
    userCache.set(userId, { at: Date.now(), value });
    return value;
}

/** Express middleware — resolves the user's combos once per request. */
async function attachProviderChains(req, res, next) {
    try {
        const { localKeys, combos: headerCombos } = parseHeader(req.get('x-provider-chain'));
        const { modelSettings, syncedKeys } = await loadUserRouting(req);
        req.providerChains = buildUserCombos({
            headerCombos,
            modelSettings,
            userKeys: mergeKeyMaps(localKeys, syncedKeys),
        });
        next();
    } catch (err) {
        next(err);
    }
}

// ─── Execution ───

class ProviderChainError extends AppError {
    constructor(slot, attempts) {
        const tried = attempts.length
            ? attempts.map(a => `${a.provider}: ${a.outcome}`).join('; ')
            : 'no providers configured';
        super(`All configured providers for ${SLOTS[slot]?.label || slot} failed (${tried}).`, 503);
        this.publicDetails = { slot, attempts };
    }
}

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const err = new Error(`Provider timed out after ${Math.round(ms / 1000)}s`);
            err.isTimeout = true;
            reject(err);
        }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function scrub(message, key) {
    let msg = String(message || 'Unknown error').slice(0, 300);
    if (key) msg = msg.split(key).join('[key]');
    return msg;
}

/**
 * Run one task through a slot's combo.
 * @param {string} slot      — STT | DIARIZE | ROLE_LABEL | NOTE_SYNTH | PROFILE_GEN
 * @param {(adapter, pool) => Promise<any>} invoke — performs the task with one adapter;
 *        throw (including on unparseable output) to move on.
 * @param {{ chains?: object, avoidFamily?: string }} opts — per-request user combos (req.providerChains);
 *        avoidFamily moves that vendor's targets to the end (cross-vendor verification)
 * @returns {Promise<{ result, provider: string, family: string, strategy: string, attempts: object[] }>}
 */
async function runChain(slot, invoke, { chains, avoidFamily } = {}) {
    const def = SLOTS[slot];
    if (!def) throw new Error(`Unknown provider slot "${slot}"`);

    const userCombo = def.userConfigurable && chains && chains[slot];
    const { entries, strategy } = userCombo || getServerChain(slot);
    const comboName = `${userCombo ? 'user' : 'server'}:${slot}`;
    const timeoutMs = Number(process.env[`ROLE_TIMEOUT_${slot}`]) || def.timeoutMs;
    let ordered = strategies.orderTargets(strategy, entries.map(e => ({ id: poolId(e), entry: e })), comboName);
    if (avoidFamily) {
        ordered = [...ordered.filter(t => t.entry.family !== avoidFamily), ...ordered.filter(t => t.entry.family === avoidFamily)];
    }
    const attempts = [];

    for (const { id, entry } of ordered) {
        let pool;
        try {
            pool = getPool(entry);
        } catch (err) {
            attempts.push({ provider: `${entry.family} (${entry.model})`, outcome: 'error', error: err.message });
            continue;
        }

        const providerCoolMs = tracker.remainingMs(pool.family);
        if (providerCoolMs > 0) {
            attempts.push({ provider: pool.name, outcome: 'skipped', error: `Provider cooling down (${Math.ceil(providerCoolMs / 1000)}s left)` });
            continue;
        }

        const keys = pool.availableKeys();
        if (keys.length === 0) {
            attempts.push({ provider: pool.name, outcome: 'skipped', error: 'No available keys (cooling down or retired)' });
            continue;
        }

        strategies.recordAttempt(id);
        for (const k of keys) {
            try {
                const result = await withTimeout(Promise.resolve().then(() => invoke(k.adapter, pool)), timeoutMs);
                pool.reportSuccess(k);
                strategies.recordSuccess(comboName, id);
                attempts.push({ provider: pool.name, key: k.id, outcome: 'success' });
                if (attempts.length > 1) {
                    console.log(`[Router] ${slot} (${strategy}) served by ${pool.name} after ${attempts.length - 1} failed attempt(s)`);
                }
                return { result, provider: pool.name, family: pool.family, strategy, attempts };
            } catch (err) {
                const kind = pool.reportError(k, err);
                attempts.push({ provider: pool.name, key: k.id, outcome: kind, error: scrub(err.message, k.key) });
                console.warn(`[Router] ${slot} → ${pool.name} [${k.id}] ${kind}: ${scrub(err.message, k.key)}`);
                // Key-specific failures try the next key of this target; anything else moves to the next target
                if (kind !== 'auth' && kind !== 'rate_limit') break;
            }
        }
    }

    throw new ProviderChainError(slot, attempts);
}

/** Masked, key-free description of the server combos — for /api/health and the settings panel. */
function describeServerChains() {
    const out = {};
    for (const slot of Object.keys(SLOTS)) {
        const { entries, strategy, source } = getServerChain(slot);
        out[slot] = {
            ...SLOTS[slot],
            source,
            strategy,
            entries: entries.map(e => {
                const status = getPool(e).getStatus();
                return {
                    family: e.family,
                    model: e.model,
                    keyCount: status.totalKeys,
                    activeKeys: status.activeKeys,
                    providerCooldownSeconds: status.providerCooldownSeconds,
                    keys: status.keys,
                };
            }),
        };
    }
    return out;
}

module.exports = {
    SLOTS,
    STRATEGIES: strategies.STRATEGIES,
    runChain,
    getServerChain,
    parseChainString,
    parseUserChains,
    parseHeader,
    buildUserCombos,
    attachProviderChains,
    invalidateUserChains,
    describeServerChains,
    ProviderChainError,
};
