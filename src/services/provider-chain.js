/* src/services/provider-chain.js
   Vendor-agnostic, per-role ordered provider chain.

   Each processing role ("slot") resolves its provider at request time from an
   ordered list of { family, model, keys[] } entries. The runtime walks the list
   top to bottom until one entry succeeds; when every entry is exhausted it
   throws HTTP 503 with a structured log of the providers attempted.

   Where a slot's chain comes from (first match wins):
     1. The signed-in user's Provider Settings (X-Provider-Chain header) — not for DIARIZE
     2. ROLE_CHAIN_<SLOT> environment variable — comma-separated family:model:key triplets,
        e.g. ROLE_CHAIN_NOTE_SYNTH=groq:llama-3.3-70b-versatile:gsk_a,gemini:gemini-2.0-flash:AIza_b
        Omitting the key (family:model) uses that family's keys from the legacy variables
        (GEMINI_API_KEYS, GROQ_API_KEY, DEEPGRAM_API_KEY, ...).
        Repeating the same family:model with different keys forms a multi-key sub-pool.
     3. The shipped reference configuration (Gemini / Groq / Deepgram / SpeechBrain). */

const { AppError } = require('../middleware/errorHandler');
const { getFamily } = require('./provider-registry');
const { getPool } = require('./provider-pool');

const SLOTS = {
    STT: { label: 'Speech-to-text', capability: 'transcribe', userConfigurable: true, timeoutMs: 180_000 },
    DIARIZE: { label: 'Speaker separation', capability: 'diarize', userConfigurable: false, timeoutMs: 600_000 },
    ROLE_LABEL: { label: 'Role labelling (clinician/client)', capability: 'chat', userConfigurable: true, timeoutMs: 90_000 },
    NOTE_SYNTH: { label: 'Note synthesis (SOAP/GROW)', capability: 'chat', userConfigurable: true, timeoutMs: 120_000 },
    PROFILE_GEN: { label: 'Longitudinal profile', capability: 'chat', userConfigurable: true, timeoutMs: 120_000 },
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

// ─── Chain parsing ───

/** Merge entries that share family+model into one multi-key entry (first position wins). */
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

/** Drop entries whose family needs a key but has none. */
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

/** True when an OmniRoute key is configured — the gateway then owns model switching. */
function omniRouteEnabled() {
    return legacyKeys('omniroute').length > 0;
}

function referenceChain(slot) {
    const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    // Llama 3.3 70B (used in the paper's evaluation) has been retired by Groq; gpt-oss-120b replaces it
    const groqModel = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
    const groqSttModel = process.env.GROQ_STT_MODEL || 'whisper-large-v3';
    const deepgramModel = process.env.DEEPGRAM_MODEL || 'nova-2';
    const gemini = { family: 'gemini', model: geminiModel, keys: legacyKeys('gemini') };
    const groq = { family: 'groq', model: groqModel, keys: legacyKeys('groq') };
    const deepgram = { family: 'deepgram', model: deepgramModel, keys: legacyKeys('deepgram') };
    const sb = { family: 'speechbrain', model: 'ecapa-tdnn', keys: [] };

    // OmniRoute mode: one OmniRoute call per role and OmniRoute's combos do the model
    // switching. Diarization stays on the local SpeechBrain service; when it is down the
    // pipeline splits the transcript into speakers with an OmniRoute text call instead.
    if (omniRouteEnabled()) {
        const omni = (model) => ({ family: 'omniroute', model, keys: legacyKeys('omniroute') });
        const chatModel = (s) => process.env[`OMNIROUTE_MODEL_${s}`] || process.env.OMNIROUTE_MODEL || 'auto';
        const omniRoute = {
            STT: [omni(process.env.OMNIROUTE_MODEL_STT || 'groq/whisper-large-v3')],
            DIARIZE: [sb],
            ROLE_LABEL: [omni(chatModel('ROLE_LABEL'))],
            NOTE_SYNTH: [omni(chatModel('NOTE_SYNTH'))],
            PROFILE_GEN: [omni(chatModel('PROFILE_GEN'))],
        };
        return usable(omniRoute[slot]);
    }

    // Direct mode (no OmniRoute key): the in-house ordered fallback across vendors
    const reference = {
        STT: [gemini, deepgram, { family: 'groq', model: groqSttModel, keys: legacyKeys('groq') }],
        DIARIZE: [sb, deepgram, gemini],
        ROLE_LABEL: [groq, gemini],
        NOTE_SYNTH: [gemini, groq],
        PROFILE_GEN: [gemini, groq],
    };
    return usable(reference[slot].map(e => ({ ...e, keys: [...e.keys] })));
}

/** Server-side chain for a slot (env override, else reference configuration). */
function getServerChain(slot) {
    const custom = process.env[`ROLE_CHAIN_${slot}`];
    if (custom && custom.trim()) {
        try {
            return { entries: parseChainString(custom, slot), source: `ROLE_CHAIN_${slot}` };
        } catch (err) {
            console.error(`[ProviderChain] ${err.message} — using reference configuration`);
        }
    }
    return { entries: referenceChain(slot), source: omniRouteEnabled() ? 'omniroute' : 'reference' };
}

// ─── Per-user overrides (Provider Settings panel) ───

const MAX_ENTRIES = 10;
const MAX_KEYS = 20;

/**
 * Parse the X-Provider-Chain header: base64-encoded JSON
 *   { "NOTE_SYNTH": [{ "family": "groq", "model": "...", "keys": ["..."] }], ... }
 * Only user-configurable slots are accepted. Returns {} when the header is absent.
 */
function parseUserChains(headerValue) {
    if (!headerValue) return {};
    let data;
    try {
        data = JSON.parse(Buffer.from(String(headerValue), 'base64').toString('utf8'));
    } catch {
        throw new AppError('Provider Settings are corrupted. Re-save them on the Settings page.', 400);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};

    const chains = {};
    for (const [slot, list] of Object.entries(data)) {
        const def = SLOTS[slot];
        if (!def || !def.userConfigurable || !Array.isArray(list) || list.length === 0) continue;
        const entries = list.slice(0, MAX_ENTRIES).map(e => {
            const family = getFamily(e?.family);
            const model = typeof e?.model === 'string' ? e.model.trim().slice(0, 120) : '';
            const keys = Array.isArray(e?.keys)
                ? e.keys.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim().slice(0, 400)).slice(0, MAX_KEYS)
                : [];
            if (!family || !family.capabilities.includes(def.capability) || !model) {
                throw new AppError(`Provider Settings: invalid entry for ${slot}.`, 400);
            }
            return { family: family.key, model, keys };
        });
        const ok = usable(mergeEntries(entries));
        if (ok.length > 0) chains[slot] = ok;
    }
    return chains;
}

/** Express middleware — resolves the user's chains once per request. */
function attachProviderChains(req, res, next) {
    try {
        req.providerChains = parseUserChains(req.get('x-provider-chain'));
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
 * Run one task through a slot's ordered chain.
 * @param {string} slot      — STT | DIARIZE | ROLE_LABEL | NOTE_SYNTH | PROFILE_GEN
 * @param {(adapter, pool) => Promise<any>} invoke — performs the task with one adapter;
 *        throw (including on unparseable output) to move on.
 * @param {{ chains?: object }} opts — per-request user chains (req.providerChains)
 * @returns {Promise<{ result, provider: string, attempts: object[] }>}
 */
async function runChain(slot, invoke, { chains } = {}) {
    const def = SLOTS[slot];
    if (!def) throw new Error(`Unknown provider slot "${slot}"`);

    const userEntries = def.userConfigurable && chains && chains[slot];
    const entries = userEntries || getServerChain(slot).entries;
    const timeoutMs = Number(process.env[`ROLE_TIMEOUT_${slot}`]) || def.timeoutMs;
    const attempts = [];

    for (const entry of entries) {
        let pool;
        try {
            pool = getPool(entry);
        } catch (err) {
            attempts.push({ provider: `${entry.family} (${entry.model})`, outcome: 'error', error: err.message });
            continue;
        }

        const keys = pool.availableKeys();
        if (keys.length === 0) {
            attempts.push({ provider: pool.name, outcome: 'skipped', error: 'No active keys (all suspended or invalid)' });
            continue;
        }

        for (const k of keys) {
            try {
                const result = await withTimeout(Promise.resolve().then(() => invoke(k.adapter, pool)), timeoutMs);
                pool.reportSuccess(k);
                attempts.push({ provider: pool.name, key: k.id, outcome: 'success' });
                if (attempts.length > 1) {
                    console.log(`[ProviderChain] ${slot} served by ${pool.name} after ${attempts.length - 1} failed attempt(s)`);
                }
                return { result, provider: pool.name, attempts };
            } catch (err) {
                const kind = pool.reportError(k, err);
                attempts.push({ provider: pool.name, key: k.id, outcome: kind, error: scrub(err.message, k.key) });
                console.warn(`[ProviderChain] ${slot} → ${pool.name} [${k.id}] ${kind}: ${scrub(err.message, k.key)}`);
                // Key-specific failures try the next key in this entry; anything else moves down the chain
                if (kind !== 'auth' && kind !== 'rate_limit') break;
            }
        }
    }

    throw new ProviderChainError(slot, attempts);
}

/** Masked, key-free description of the server chains — for /api/health and the settings panel. */
function describeServerChains() {
    const out = {};
    for (const slot of Object.keys(SLOTS)) {
        const { entries, source } = getServerChain(slot);
        out[slot] = {
            ...SLOTS[slot],
            source,
            entries: entries.map(e => {
                const status = getPool(e).getStatus();
                return { family: e.family, model: e.model, keyCount: status.totalKeys, activeKeys: status.activeKeys, keys: status.keys };
            }),
        };
    }
    return out;
}

module.exports = {
    SLOTS,
    runChain,
    getServerChain,
    omniRouteEnabled,
    parseChainString,
    parseUserChains,
    attachProviderChains,
    describeServerChains,
    ProviderChainError,
};
