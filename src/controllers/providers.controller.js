/* src/controllers/providers.controller.js
   Backs the dashboard Provider Settings panel. */

const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { listFamilies, getFamily } = require('../services/provider-registry');
const { describeServerChains, SLOTS } = require('../services/provider-chain');
const { classifyError } = require('../services/provider-pool');

// GET /api/providers — registered families + the server's chain per slot (keys masked)
const getProviders = asyncHandler(async (req, res) => {
    res.json({
        families: listFamilies(),
        slots: describeServerChains(),
        userOverrides: Object.keys(req.providerChains || {}),
    });
});

// POST /api/providers/test — validate one key with a lightweight test call before it is saved
const testProvider = asyncHandler(async (req, res) => {
    const { family, model, key, slot } = req.body || {};
    const def = getFamily(family);
    if (!def) throw new AppError(`Unknown provider family "${family}".`, 400);
    if (!model || typeof model !== 'string') throw new AppError('Model is required.', 400);
    if (def.requiresKey && (!key || typeof key !== 'string')) throw new AppError('API key is required.', 400);
    if (slot && SLOTS[slot] && !def.capabilities.includes(SLOTS[slot].capability)) {
        throw new AppError(`${def.label} cannot be used for ${SLOTS[slot].label}.`, 400);
    }

    const adapter = def.create({ apiKey: key ? key.trim() : null, model: model.trim() });
    const started = Date.now();
    try {
        await Promise.race([
            adapter.testConnection(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Test call timed out after 20s')), 20_000)),
        ]);
        res.json({ ok: true, latencyMs: Date.now() - started });
    } catch (err) {
        const kind = classifyError(err);
        const message = String(err.message || 'Test call failed').split(key || '\u0000').join('[key]').slice(0, 300);
        res.status(200).json({ ok: false, reason: kind, error: message });
    }
});

module.exports = { getProviders, testProvider };
