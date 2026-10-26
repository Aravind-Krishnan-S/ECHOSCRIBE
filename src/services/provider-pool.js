/* src/services/provider-pool.js
   Family-agnostic multi-key pool for one provider-chain entry.
   Generalises the earlier single-provider GeminiPool.

   Each entry holds { family, model, keys[] }. Keys rotate round-robin; each key
   has a health state:
     active        — eligible for rotation
     rate_limited  — suspended for 60 s after a rate-limit / quota error
     invalid       — permanently retired after an authentication failure
   Quota headroom therefore scales with the number of keys supplied. */

const crypto = require('crypto');
const { getFamily } = require('./provider-registry');

const RATE_LIMIT_COOLDOWN_MS = 60_000;
const MAX_CONSECUTIVE_ERRORS = 3;

/**
 * Classify a provider error so the pool and the chain know what to do with it.
 * @returns {'auth'|'rate_limit'|'timeout'|'error'}
 */
function classifyError(err) {
    const status = err?.status || err?.statusCode || err?.response?.status;
    const msg = String(err?.message || err || '');

    if (status === 401 || status === 403 ||
        /API_KEY_INVALID|API key not valid|invalid[_ ]api[_ ]key|Invalid API Key|unauthori[sz]ed|INVALID_AUTH|permission denied/i.test(msg)) {
        return 'auth';
    }
    if (status === 429 ||
        /\b429\b|quota|rate[ -]?limit|Too Many Requests|RESOURCE_EXHAUSTED/i.test(msg)) {
        return 'rate_limit';
    }
    if (err?.name === 'AbortError' || err?.code === 'ETIMEDOUT' || err?.isTimeout ||
        /timed? ?out/i.test(msg)) {
        return 'timeout';
    }
    return 'error';
}

function maskKey(key) {
    if (!key) return '(no key)';
    return key.length <= 8 ? '…' + key.slice(-2) : key.slice(0, 6) + '…' + key.slice(-2);
}

class ProviderPool {
    /**
     * @param {{ family: string, model: string, keys: string[] }} entry
     */
    constructor({ family, model, keys = [] }) {
        const def = getFamily(family);
        if (!def) throw new Error(`Unknown provider family "${family}"`);

        this.family = def.key;
        this.label = def.label;
        this.model = model;
        this.index = 0;

        const keyList = def.requiresKey ? keys.filter(k => k && k.trim()) : [null];
        this.keys = keyList.map(k => ({
            key: k ? k.trim() : null,
            id: maskKey(k),
            adapter: def.create({ apiKey: k ? k.trim() : null, model }),
            state: 'active',
            suspendedUntil: 0,
            consecutiveErrors: 0,
            errors: 0,
        }));
    }

    get name() {
        return `${this.label} (${this.model})`;
    }

    /** Keys that may be tried right now, in round-robin order starting at the cursor. */
    availableKeys() {
        const now = Date.now();
        for (const k of this.keys) {
            if (k.state === 'rate_limited' && now >= k.suspendedUntil) {
                k.state = 'active';
                k.consecutiveErrors = 0;
            }
        }
        const ordered = [];
        for (let i = 0; i < this.keys.length; i++) {
            const k = this.keys[(this.index + i) % this.keys.length];
            if (k.state === 'active') ordered.push(k);
        }
        if (ordered.length > 0) this.index = (this.keys.indexOf(ordered[0]) + 1) % this.keys.length;
        return ordered;
    }

    reportSuccess(k) {
        k.consecutiveErrors = 0;
    }

    /** Update key health after a failure. Returns the error class. */
    reportError(k, err) {
        const kind = classifyError(err);
        k.errors++;
        if (kind === 'auth') {
            k.state = 'invalid';
            console.error(`[ProviderPool] ${this.name} key ${k.id} failed authentication — retired`);
        } else if (kind === 'rate_limit') {
            k.state = 'rate_limited';
            k.suspendedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
            console.warn(`[ProviderPool] ${this.name} key ${k.id} rate-limited — suspended for 60s`);
        } else if (++k.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            k.state = 'rate_limited';
            k.suspendedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
            console.warn(`[ProviderPool] ${this.name} key ${k.id} suspended for 60s after ${k.consecutiveErrors} consecutive errors`);
        }
        return kind;
    }

    getStatus() {
        return {
            family: this.family,
            model: this.model,
            totalKeys: this.keys.length,
            activeKeys: this.keys.filter(k => k.state === 'active').length,
            keys: this.keys.map(k => ({ id: k.id, state: k.state, errors: k.errors })),
        };
    }
}

// ─── Pool cache ───
// Pools are cached by (family, model, key set) so key health survives across
// requests — including pools built from keys a user supplied in the dashboard.

const POOL_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_POOLS = 500;
const poolCache = new Map();

function poolId({ family, model, keys = [] }) {
    const hash = crypto.createHash('sha256').update([...keys].sort().join('\n')).digest('hex').slice(0, 16);
    return `${String(family).toLowerCase()}|${model}|${hash}`;
}

function getPool(entry) {
    const id = poolId(entry);
    const cached = poolCache.get(id);
    if (cached) {
        cached.lastUsed = Date.now();
        return cached.pool;
    }

    const now = Date.now();
    for (const [cid, c] of poolCache) {
        if (now - c.lastUsed > POOL_TTL_MS || poolCache.size >= MAX_POOLS) poolCache.delete(cid);
    }

    const pool = new ProviderPool(entry);
    poolCache.set(id, { pool, lastUsed: now });
    return pool;
}

module.exports = { ProviderPool, getPool, classifyError, maskKey, RATE_LIMIT_COOLDOWN_MS };
