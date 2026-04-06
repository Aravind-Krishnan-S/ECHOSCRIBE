/* src/services/gemini-pool.js
   Round-robin API key pool for Gemini with automatic failover.
   Accepts multiple keys and distributes calls evenly.
   Keys are validated lazily on first actual use — no startup test calls. */

const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiPool {
    constructor() {
        this.clients = [];
        this.index = 0;
    }

    /**
     * Initialize the pool with one or more API keys.
     * No test calls are made — keys are validated lazily on first use.
     * @param {string|string[]} keys — single key or array of keys
     */
    init(keys) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        const validKeys = keyList.filter(k => k && k.trim().length > 0);

        if (validKeys.length === 0) {
            throw new Error('GeminiPool: No API keys provided.');
        }

        this.clients = validKeys.map((key, i) => ({
            genAI: new GoogleGenerativeAI(key.trim()),
            key: key.trim().slice(0, 8) + '…',
            index: i,
            errors: 0,
            consecutiveErrors: 0,
            disabled: false,
            disabledUntil: 0,
            invalidKey: false,  // permanently invalid
        }));

        console.log(`[GeminiPool] Initialized with ${this.clients.length} key(s): ${this.clients.map(c => c.key).join(', ')}`);
    }

    /**
     * Get the next available client using round-robin.
     * Skips permanently invalid and temporarily disabled keys.
     */
    _next() {
        const now = Date.now();
        const total = this.clients.length;

        // Re-enable keys whose cooldown has expired (but not permanently invalid ones)
        for (const c of this.clients) {
            if (c.disabled && !c.invalidKey && now >= c.disabledUntil) {
                c.disabled = false;
                c.consecutiveErrors = 0;
                console.log(`[GeminiPool] Re-enabled key ${c.key}`);
            }
        }

        // Round-robin through available keys
        for (let i = 0; i < total; i++) {
            const idx = (this.index + i) % total;
            const client = this.clients[idx];
            if (!client.disabled) {
                this.index = (idx + 1) % total;
                return client;
            }
        }

        // All keys disabled — try to force-enable a non-invalid one
        const nonInvalid = this.clients.filter(c => !c.invalidKey);
        if (nonInvalid.length > 0) {
            // Pick the one with the earliest re-enable time
            const best = nonInvalid.reduce((a, b) => a.disabledUntil < b.disabledUntil ? a : b);
            best.disabled = false;
            best.consecutiveErrors = 0;
            console.warn(`[GeminiPool] All keys disabled. Force-enabling key ${best.key}`);
            return best;
        }

        // All keys permanently invalid — throw
        throw new Error('GeminiPool: All API keys are invalid. Please check your GEMINI_API_KEY or GEMINI_API_KEYS environment variables.');
    }

    /**
     * Get a Gemini model from the next available key.
     * @param {string|object} modelConfig — model name or full config object
     */
    getModel(modelConfig = process.env.GEMINI_MODEL || 'gemini-2.5-flash') {
        const client = this._next();
        if (typeof modelConfig === 'string') {
            return client.genAI.getGenerativeModel({ model: modelConfig });
        }
        return client.genAI.getGenerativeModel(modelConfig);
    }

    /**
     * Report a successful call — resets error counters for the last-used key.
     */
    reportSuccess() {
        const prevIdx = (this.index - 1 + this.clients.length) % this.clients.length;
        const client = this.clients[prevIdx];
        client.consecutiveErrors = 0;
    }

    /**
     * Report an error on the last-used key.
     * - API_KEY_INVALID → permanently disable
     * - 429/quota → disable for 60s
     * - 3+ consecutive errors → disable for 60s
     */
    reportError(errorMsg = '') {
        const prevIdx = (this.index - 1 + this.clients.length) % this.clients.length;
        const client = this.clients[prevIdx];

        // Permanently disable invalid keys
        if (errorMsg.includes('API_KEY_INVALID') || errorMsg.includes('API key not valid')) {
            client.invalidKey = true;
            client.disabled = true;
            client.disabledUntil = Infinity;
            console.error(`[GeminiPool] ❌ Key ${client.key} is INVALID — permanently disabled`);
            return;
        }

        // Quota/rate limit — disable for 60s
        if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('Too Many Requests')) {
            client.disabled = true;
            client.disabledUntil = Date.now() + 60_000;
            console.warn(`[GeminiPool] ⚠️ Key ${client.key} quota-limited — disabled for 60s`);
            return;
        }

        // Generic error — count consecutive failures
        client.consecutiveErrors++;
        client.errors++;
        if (client.consecutiveErrors >= 3) {
            client.disabled = true;
            client.disabledUntil = Date.now() + 60_000;
            console.warn(`[GeminiPool] Key ${client.key} disabled for 60s after ${client.consecutiveErrors} consecutive errors`);
        }
    }

    /**
     * Get pool status for health/diagnostics.
     */
    getStatus() {
        return {
            totalKeys: this.clients.length,
            activeKeys: this.clients.filter(c => !c.disabled).length,
            invalidKeys: this.clients.filter(c => c.invalidKey).length,
            keys: this.clients.map(c => ({
                id: c.key,
                active: !c.disabled,
                invalid: c.invalidKey,
                errors: c.errors,
                consecutiveErrors: c.consecutiveErrors,
            })),
        };
    }
}

// Singleton
const geminiPool = new GeminiPool();

module.exports = { geminiPool };
