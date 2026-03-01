/* src/services/gemini-pool.js
   Round-robin API key pool for Gemini with automatic failover.
   Accepts multiple keys and distributes calls evenly. */

const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiPool {
    constructor() {
        this.clients = [];   // { genAI, key, errors, disabled, disabledUntil }
        this.index = 0;
    }

    /**
     * Initialize the pool with one or more API keys.
     * @param {string|string[]} keys — single key or array of keys
     */
    init(keys) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        this.clients = keyList
            .filter(k => k && k.trim().length > 0)
            .map((key, i) => ({
                genAI: new GoogleGenerativeAI(key.trim()),
                key: key.trim().slice(0, 8) + '…',  // safe identifier for logs
                index: i,
                errors: 0,
                disabled: false,
                disabledUntil: 0,
            }));

        if (this.clients.length === 0) {
            throw new Error('GeminiPool: No valid API keys provided.');
        }

        console.log(`[GeminiPool] Initialized with ${this.clients.length} key(s)`);
    }

    /**
     * Get the next available client using round-robin.
     * Skips temporarily disabled keys.
     * @returns {{ genAI: GoogleGenerativeAI, keyId: string }}
     */
    _next() {
        const now = Date.now();
        const total = this.clients.length;

        // Re-enable keys whose cooldown has expired
        for (const c of this.clients) {
            if (c.disabled && now >= c.disabledUntil) {
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

        // All keys disabled — force-use the one with earliest re-enable time
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
     *   For string: e.g. 'gemini-2.0-flash'
     *   For object: { model: 'gemini-2.0-flash', systemInstruction: '...', generationConfig: {...} }
     * @returns {GenerativeModel}
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
     * @param {object} client — optional, the client that succeeded
     */
    reportSuccess(client) {
        if (client) client.errors = 0;
    }

    /**
     * Report an error on the current key. After 3 consecutive errors,
     * the key is disabled for 60 seconds.
     */
    reportError() {
        // Find the most recently used client (previous index)
        const prevIdx = (this.index - 1 + this.clients.length) % this.clients.length;
        const client = this.clients[prevIdx];
        client.errors++;

        if (client.errors >= 3) {
            client.disabled = true;
            client.disabledUntil = Date.now() + 60_000; // 60s cooldown
            console.warn(`[GeminiPool] Key ${client.key} disabled for 60s after ${client.errors} errors`);
        }
    }

    /**
     * Get pool status for health endpoint.
     */
    getStatus() {
        return {
            totalKeys: this.clients.length,
            activeKeys: this.clients.filter(c => !c.disabled).length,
            keys: this.clients.map(c => ({
                id: c.key,
                active: !c.disabled,
                errors: c.errors,
            })),
        };
    }
}

// Singleton
const geminiPool = new GeminiPool();

module.exports = { geminiPool };
