/* src/services/gemini-pool.js
   Round-robin API key pool for Gemini with automatic failover.
   Accepts multiple keys and distributes calls evenly.
   Validates keys on init by making a test call. */

const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiPool {
    constructor() {
        this.clients = [];   // { genAI, key, errors, disabled, disabledUntil, valid }
        this.index = 0;
    }

    /**
     * Initialize the pool with one or more API keys.
     * Keys are validated asynchronously — invalid keys are logged and skipped.
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
            key: key.trim().slice(0, 8) + '…',  // safe identifier for logs
            fullKeyPrefix: key.trim().slice(0, 12),  // slightly longer for diagnostics
            index: i,
            errors: 0,
            disabled: false,
            disabledUntil: 0,
            valid: null,  // null = untested, true/false after validation
        }));

        console.log(`[GeminiPool] Loaded ${this.clients.length} key(s). Validating in background...`);

        // Validate keys asynchronously — don't block server startup
        this._validateAllKeys();
    }

    /**
     * Test each key by making a tiny API call. Invalid keys are disabled permanently.
     */
    async _validateAllKeys() {
        for (const client of this.clients) {
            try {
                const model = client.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
                const result = await model.generateContent('Reply with OK');
                const text = (await result.response).text();
                client.valid = true;
                client.errors = 0;
                console.log(`[GeminiPool] ✅ Key ${client.key} is valid`);
            } catch (err) {
                const msg = err.message || '';
                if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
                    client.valid = false;
                    client.disabled = true;
                    client.disabledUntil = Infinity;  // permanently disabled
                    console.error(`[GeminiPool] ❌ Key ${client.key} is INVALID — permanently disabled`);
                } else if (msg.includes('429') || msg.includes('quota')) {
                    client.valid = true;  // key is valid but quota exhausted
                    client.disabled = true;
                    client.disabledUntil = Date.now() + 60_000;
                    console.warn(`[GeminiPool] ⚠️ Key ${client.key} is valid but quota-limited — disabled for 60s`);
                } else {
                    client.valid = true;  // assume valid, transient error
                    console.warn(`[GeminiPool] ⚠️ Key ${client.key} validation inconclusive: ${msg.slice(0, 100)}`);
                }
            }
        }

        const activeCount = this.clients.filter(c => !c.disabled).length;
        const validCount = this.clients.filter(c => c.valid === true).length;
        console.log(`[GeminiPool] Validation complete: ${validCount} valid, ${activeCount} active out of ${this.clients.length}`);

        if (activeCount === 0 && validCount > 0) {
            // All valid keys are quota-limited, enable the first valid one
            const firstValid = this.clients.find(c => c.valid === true);
            if (firstValid) {
                firstValid.disabled = false;
                firstValid.errors = 0;
                console.log(`[GeminiPool] Force-enabled ${firstValid.key} (all keys are quota-limited)`);
            }
        }
    }

    /**
     * Get the next available client using round-robin.
     * Skips disabled keys.
     */
    _next() {
        const now = Date.now();
        const total = this.clients.length;

        // Re-enable keys whose cooldown has expired (but not permanently invalid ones)
        for (const c of this.clients) {
            if (c.disabled && c.disabledUntil !== Infinity && now >= c.disabledUntil) {
                c.disabled = false;
                c.errors = 0;
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

        // All keys disabled — try force-enabling the first VALID one
        const firstValid = this.clients.find(c => c.valid === true);
        if (firstValid) {
            firstValid.disabled = false;
            firstValid.errors = 0;
            console.warn(`[GeminiPool] All keys disabled. Force-enabling valid key ${firstValid.key}`);
            return firstValid;
        }

        // Last resort — use any key
        const earliest = this.clients.reduce((a, b) =>
            a.disabledUntil < b.disabledUntil ? a : b
        );
        earliest.disabled = false;
        earliest.errors = 0;
        console.warn(`[GeminiPool] All keys disabled. Force-enabling key ${earliest.key}`);
        return earliest;
    }

    /**
     * Get a Gemini model from the next available key.
     * @param {string|object} modelConfig — model name string or full config object
     */
    getModel(modelConfig = 'gemini-2.0-flash') {
        const client = this._next();
        if (typeof modelConfig === 'string') {
            return client.genAI.getGenerativeModel({ model: modelConfig });
        }
        return client.genAI.getGenerativeModel(modelConfig);
    }

    /**
     * Report a successful call (resets error counter).
     */
    reportSuccess(client) {
        if (client) {
            client.errors = 0;
            client.valid = true;
        }
    }

    /**
     * Report an error. After 3 consecutive errors, key is disabled for 60s.
     * API_KEY_INVALID errors instantly and permanently disable the key.
     */
    reportError(errorMsg = '') {
        const prevIdx = (this.index - 1 + this.clients.length) % this.clients.length;
        const client = this.clients[prevIdx];

        // Permanently disable invalid keys
        if (errorMsg.includes('API_KEY_INVALID') || errorMsg.includes('API key not valid')) {
            client.valid = false;
            client.disabled = true;
            client.disabledUntil = Infinity;
            console.error(`[GeminiPool] ❌ Key ${client.key} permanently disabled — invalid key`);
            return;
        }

        client.errors++;
        if (client.errors >= 3) {
            client.disabled = true;
            client.disabledUntil = Date.now() + 60_000;
            console.warn(`[GeminiPool] Key ${client.key} disabled for 60s after ${client.errors} errors`);
        }
    }

    /**
     * Get pool status for health/diagnostics endpoint.
     */
    getStatus() {
        return {
            totalKeys: this.clients.length,
            activeKeys: this.clients.filter(c => !c.disabled).length,
            validKeys: this.clients.filter(c => c.valid === true).length,
            invalidKeys: this.clients.filter(c => c.valid === false).length,
            keys: this.clients.map(c => ({
                id: c.key,
                active: !c.disabled,
                valid: c.valid,
                errors: c.errors,
            })),
        };
    }
}

// Singleton
const geminiPool = new GeminiPool();

module.exports = { geminiPool };
