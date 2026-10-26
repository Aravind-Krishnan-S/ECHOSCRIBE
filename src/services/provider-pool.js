/* src/services/provider-pool.js
   Multi-key pool for one combo target ({ family, model, keys[] }).

   Keys rotate round-robin. A key that fails authentication is retired for good;
   rate limits and other failures put the key into an exponential-backoff
   cooldown held by routing/cooldown-tracker.js (OmniRoute-style), so health
   survives across requests. */

const crypto = require('crypto');
const { getFamily } = require('./provider-registry');
const tracker = require('./routing/cooldown-tracker');

/**
 * Classify a provider error so the router knows what to do with it.
 *   auth        — key rejected: retire the key, try the next key
 *   rate_limit  — quota / 429: cool the key down, try the next key
 *   bad_request — HTTP 400 for this request only: no cooldown, try the next target
 *                 (OmniRoute open-sse/services/accountFallback/requestScoped400.ts)
 *   timeout     — no answer in time: cool down, try the next target
 *   error       — anything else (5xx, unparseable output): cool down, try the next target
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
    if (status === 400 || /\[400 Bad Request\]/.test(msg)) {
        return 'bad_request';
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
        this.keys = keyList.map(k => {
            const trimmed = k ? k.trim() : null;
            return {
                key: trimmed,
                id: maskKey(trimmed),
                // Stable cooldown id per (family, model, key) without holding the raw key in the tracker
                connectionId: crypto.createHash('sha256').update(`${def.key}|${model}|${trimmed}`).digest('hex').slice(0, 12),
                adapter: def.create({ apiKey: trimmed, model }),
                invalid: false,
                errors: 0,
            };
        });
    }

    get name() {
        return `${this.label} (${this.model})`;
    }

    /** Keys that may be tried right now (not retired, not cooling), round-robin from the cursor. */
    availableKeys() {
        const ordered = [];
        for (let i = 0; i < this.keys.length; i++) {
            const k = this.keys[(this.index + i) % this.keys.length];
            if (!k.invalid && !tracker.isInCooldown(this.family, k.connectionId)) ordered.push(k);
        }
        if (ordered.length > 0) this.index = (this.keys.indexOf(ordered[0]) + 1) % this.keys.length;
        return ordered;
    }

    reportSuccess(k) {
        tracker.recordSuccess(this.family, k.connectionId);
        tracker.recordSuccess(this.family);
    }

    /** Update key / provider health after a failure. Returns the error class. */
    reportError(k, err) {
        const kind = classifyError(err);
        k.errors++;
        if (kind === 'auth') {
            k.invalid = true;
            console.error(`[ProviderPool] ${this.name} key ${k.id} failed authentication — retired`);
        } else if (kind !== 'bad_request') {
            tracker.recordFailure(this.family, k.connectionId);
            tracker.recordFailure(this.family);
            const waitS = Math.round(tracker.remainingMs(this.family, k.connectionId) / 1000);
            console.warn(`[ProviderPool] ${this.name} key ${k.id} ${kind} — cooling down for ${waitS}s`);
        }
        return kind;
    }

    getStatus() {
        const keys = this.keys.map(k => {
            const coolMs = tracker.remainingMs(this.family, k.connectionId);
            return {
                id: k.id,
                state: k.invalid ? 'invalid' : coolMs > 0 ? 'cooling' : 'active',
                cooldownSeconds: Math.ceil(coolMs / 1000),
                errors: k.errors,
            };
        });
        return {
            family: this.family,
            model: this.model,
            totalKeys: keys.length,
            activeKeys: keys.filter(k => k.state === 'active').length,
            providerCooldownSeconds: Math.ceil(tracker.remainingMs(this.family) / 1000),
            keys,
        };
    }
}

// ─── Pool cache ───
// Pools are cached by (family, model, key set) so key state survives across
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

module.exports = { ProviderPool, getPool, poolId, classifyError, maskKey };
