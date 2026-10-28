/* src/services/routing/cooldown-tracker.js
   Cross-request cooldown state for failing provider connections (API keys) and
   whole providers, so later requests stop re-walking targets that just failed.

   Ported from OmniRoute (MIT License, https://github.com/diegosouzapw/OmniRoute):
     open-sse/services/providerCooldownTracker.ts
     open-sse/config/constants.ts (PROVIDER_PROFILES breaker defaults)
     src/lib/resilience/settings.ts (min/max retry cooldown defaults)

   Two scopes, as in OmniRoute:
     connection — one API key. Exponential backoff: min · 2^(failures-1), capped at max.
     provider   — the whole family (e.g. every Gemini key). Trips only after
                  `threshold` failures inside `windowMs`, then cools for `cooldownMs`. */

const envInt = (name, fallback) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
};

const MIN_RETRY_COOLDOWN_MS = envInt('PROVIDER_COOLDOWN_MIN_MS', 5_000);
const MAX_RETRY_COOLDOWN_MS = envInt('PROVIDER_COOLDOWN_MAX_MS', 300_000);

// OmniRoute PROVIDER_PROFILES: "apikey" for cloud vendors, "local" for on-box services
const PROVIDER_PROFILES = {
    apikey: {
        failureThreshold: envInt('PROVIDER_BREAKER_API_KEY_FAILURE_THRESHOLD', 15),
        failureWindowMs: envInt('PROVIDER_BREAKER_API_KEY_FAILURE_WINDOW_MS', 1_800_000),
        cooldownMs: envInt('PROVIDER_BREAKER_API_KEY_COOLDOWN_MS', 600_000),
    },
    local: {
        failureThreshold: envInt('PROVIDER_BREAKER_LOCAL_FAILURE_THRESHOLD', 2),
        failureWindowMs: envInt('PROVIDER_BREAKER_LOCAL_FAILURE_WINDOW_MS', 300_000),
        cooldownMs: envInt('PROVIDER_BREAKER_LOCAL_COOLDOWN_MS', 60_000),
    },
};

const LOCAL_PROVIDERS = new Set(['pyannote']);
const RETENTION_MS = Math.max(30 * 60 * 1000, MAX_RETRY_COOLDOWN_MS, PROVIDER_PROFILES.apikey.failureWindowMs);

const cooldowns = new Map();
let cleanupTimer = null;

function profileFor(provider) {
    return LOCAL_PROVIDERS.has(provider) ? PROVIDER_PROFILES.local : PROVIDER_PROFILES.apikey;
}

function key(provider, connectionId) {
    return connectionId ? `${provider}:${connectionId}` : provider;
}

function pruneWindow(timestamps, windowMs, now) {
    const pruned = timestamps.filter(t => t >= now - windowMs);
    return pruned.length > 200 ? pruned.slice(-200) : pruned;
}

function startCleanup() {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [k, e] of cooldowns) {
            if (now - e.lastFailureAt > RETENTION_MS) cooldowns.delete(k);
        }
    }, 60_000);
    if (cleanupTimer.unref) cleanupTimer.unref();
}

/** Record a failure. Omit connectionId to record against the whole provider. */
function recordFailure(provider, connectionId) {
    if (!provider) return;
    const now = Date.now();
    const k = key(provider, connectionId);
    const entry = cooldowns.get(k) || { lastFailureAt: now, failureCount: 0, failureTimestamps: [] };
    entry.lastFailureAt = now;
    entry.failureCount++;
    if (!connectionId) {
        entry.failureTimestamps = pruneWindow([...entry.failureTimestamps, now], profileFor(provider).failureWindowMs, now);
    }
    cooldowns.set(k, entry);
    startCleanup();
}

/** A success resets the failure streak for that scope. */
function recordSuccess(provider, connectionId) {
    const entry = cooldowns.get(key(provider, connectionId));
    if (entry) {
        entry.failureCount = 0;
        entry.failureTimestamps = [];
    }
}

/** Milliseconds left before this connection / provider may be tried again (0 = available). */
function remainingMs(provider, connectionId) {
    const entry = cooldowns.get(key(provider, connectionId));
    if (!entry || entry.failureCount === 0) return 0;
    const now = Date.now();
    const elapsed = now - entry.lastFailureAt;

    if (!connectionId) {
        const { failureThreshold, failureWindowMs, cooldownMs } = profileFor(provider);
        if (pruneWindow(entry.failureTimestamps, failureWindowMs, now).length < failureThreshold) return 0;
        return Math.max(0, cooldownMs - elapsed);
    }

    const exponent = Math.min(Math.max(0, entry.failureCount - 1), 10);
    const scaled = Math.min(MIN_RETRY_COOLDOWN_MS * Math.pow(2, exponent), MAX_RETRY_COOLDOWN_MS);
    return Math.max(0, scaled - elapsed);
}

function isInCooldown(provider, connectionId) {
    return remainingMs(provider, connectionId) > 0;
}

function reset() {
    cooldowns.clear();
}

module.exports = { recordFailure, recordSuccess, remainingMs, isInCooldown, reset, PROVIDER_PROFILES };
