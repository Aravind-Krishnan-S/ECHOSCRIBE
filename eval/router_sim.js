/* eval/router_sim.js — E1: router resilience under injected faults.

   Drives the real router (src/services/provider-chain.js + routing/) with simulated
   providers on a simulated clock: Date.now() is replaced by a virtual clock that advances
   by each call's latency, so an hour of traffic runs in seconds and every run is reproducible.

   Usage: node eval/router_sim.js <condition> <scenario> <seed>
     condition: nomemory | fixed60 | priority | round-robin | lkgp
     scenario:  quota | outage | mixed
   Prints one JSON line of metrics. eval/run_router_sim.js runs the full grid. */

const path = require('path');
const [condition = 'priority', scenario = 'quota', seedArg = '1'] = process.argv.slice(2);

// ── conditions map onto the router's own settings (read when the modules load) ──
const CONDITIONS = {
    nomemory: { strategy: 'priority', env: { PROVIDER_COOLDOWN_MIN_MS: '1', PROVIDER_COOLDOWN_MAX_MS: '1', PROVIDER_BREAKER_API_KEY_FAILURE_THRESHOLD: '1000000' } },
    fixed60: { strategy: 'priority', env: { PROVIDER_COOLDOWN_MIN_MS: '60000', PROVIDER_COOLDOWN_MAX_MS: '60000', PROVIDER_BREAKER_API_KEY_FAILURE_THRESHOLD: '1000000' } },
    priority: { strategy: 'priority', env: {} },
    'round-robin': { strategy: 'round-robin', env: {} },
    lkgp: { strategy: 'lkgp', env: {} },
};
const cond = CONDITIONS[condition];
// Silence the router's own logging; only the final JSON line is printed
const print = console.log.bind(console);
console.log = console.warn = console.error = () => {};
if (!cond) throw new Error('unknown condition ' + condition);
Object.assign(process.env, cond.env);

// ── virtual clock and seeded randomness ──
let now = Date.UTC(2026, 9, 1, 9, 0, 0);
Date.now = () => now;
let seed = Number(seedArg) * 2654435761 % 2 ** 32 || 1;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const lognormal = (median, sigma = 0.35) => median * Math.exp(sigma * Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand()));

const MIN = 60_000;
const DURATION = 60 * MIN;
const RATE_PER_MIN = 10;          // requests per minute (Poisson)
const TIMEOUT_MS = 30_000;

// ── simulated providers: A is the preferred vendor, B and C are fallbacks ──
const PROVIDERS = {
    simA: { median: 1400, keys: ['A1', 'A2'] },
    simB: { median: 900, keys: ['B1', 'B2'] },
    simC: { median: 1800, keys: ['C1'] },
};

const SCENARIOS = {
    // Per-key quota on the preferred vendor below the offered load: 429s whenever a key exceeds 4/min (2 keys x 4 < 10/min)
    quota: { quota: { A1: 4, A2: 4 }, outage: null, invalid: [], timeoutP: {}, errorP: { simA: 0.01, simB: 0.01, simC: 0.01 } },
    // The preferred vendor returns 503 for 15 minutes, plus background errors
    outage: { quota: {}, outage: { provider: 'simA', from: 15 * MIN, to: 30 * MIN }, invalid: [], timeoutP: {}, errorP: { simA: 0.05, simB: 0.02, simC: 0.02 } },
    // A revoked key, a quota and a fallback vendor that times out 20% of the time
    mixed: { quota: { A2: 6 }, outage: null, invalid: ['A1'], timeoutP: { simB: 0.2 }, errorP: { simA: 0.02, simB: 0.02, simC: 0.02 } },
};
const sc = SCENARIOS[scenario];
if (!sc) throw new Error('unknown scenario ' + scenario);

const usage = {};         // key → successful calls
const windowCount = {};   // key → { minute, count }
let callsTotal = 0;

const reg = require(path.join(__dirname, '..', 'src/services/provider-registry'));
for (const [family, def] of Object.entries(PROVIDERS)) {
    reg.registerFamily(family, {
        label: family,
        capabilities: ['chat'],
        create: ({ apiKey }) => ({
            chatCompletion: async () => {
                callsTotal++;
                const t0 = now;
                const minute = Math.floor((t0 - START) / MIN);
                // revoked key: fast 401
                if (sc.invalid.includes(apiKey)) { now += 150; throw Object.assign(new Error('Invalid API Key'), { status: 401 }); }
                // per-key quota per minute
                const w = windowCount[apiKey] && windowCount[apiKey].minute === minute ? windowCount[apiKey] : (windowCount[apiKey] = { minute, count: 0 });
                w.count++;
                if (sc.quota[apiKey] && w.count > sc.quota[apiKey]) { now += 200; throw Object.assign(new Error('429 Too Many Requests'), { status: 429 }); }
                // outage window
                if (sc.outage && sc.outage.provider === family && t0 - START >= sc.outage.from && t0 - START < sc.outage.to) {
                    now += 400; throw Object.assign(new Error('503 Service Unavailable'), { status: 503 });
                }
                if (rand() < (sc.timeoutP[family] || 0)) { now += TIMEOUT_MS; throw Object.assign(new Error('Provider timed out after 30s'), { isTimeout: true }); }
                if (rand() < (sc.errorP[family] || 0)) { now += 500; throw Object.assign(new Error('500 upstream error'), { status: 500 }); }
                now += lognormal(def.median);
                usage[apiKey] = (usage[apiKey] || 0) + 1;
                return 'ok';
            },
        }),
    });
}

const START = now;
process.env.ROLE_TIMEOUT_NOTE_SYNTH = String(10 * 60_000); // timeouts are simulated by the providers
process.env.ROLE_STRATEGY_NOTE_SYNTH = cond.strategy;
process.env.ROLE_CHAIN_NOTE_SYNTH = Object.entries(PROVIDERS)
    .flatMap(([family, def]) => def.keys.map(k => `${family}:m:${k}`)).join(',');

const { runChain } = require(path.join(__dirname, '..', 'src/services/provider-chain'));

(async () => {
    const latencies = [];
    let ok = 0, failed = 0, attemptsTotal = 0;
    let t = START;
    while (true) {
        t += -Math.log(rand() || 1e-9) / RATE_PER_MIN * MIN;   // Poisson arrivals
        if (t - START > DURATION) break;
        if (now < t) now = t;                                   // idle until the next arrival
        const begin = now;
        try {
            const r = await runChain('NOTE_SYNTH', a => a.chatCompletion('s', 'u'));
            ok++;
            attemptsTotal += r.attempts.filter(a => a.outcome !== 'skipped').length;
        } catch (err) {
            failed++;
            attemptsTotal += (err.publicDetails?.attempts || []).filter(a => a.outcome !== 'skipped').length;
        }
        latencies.push(now - begin); // the clock only moves forward; latency excludes any queueing
    }
    latencies.sort((a, b) => a - b);
    const q = p => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] / 1000;
    const loads = Object.values(PROVIDERS).flatMap(d => d.keys).map(k => usage[k] || 0);
    const jain = loads.reduce((a, b) => a + b, 0) ** 2 / (loads.length * loads.reduce((a, b) => a + b * b, 0) || 1);
    const n = ok + failed;
    print(JSON.stringify({
        condition, scenario, seed: Number(seedArg), requests: n,
        success_rate: +(ok / n).toFixed(4),
        calls_per_request: +(callsTotal / n).toFixed(3),
        failed_calls_per_request: +((callsTotal - ok) / n).toFixed(3),
        latency_p50_s: +q(0.5).toFixed(2),
        latency_p95_s: +q(0.95).toFixed(2),
        latency_mean_s: +(latencies.reduce((a, b) => a + b, 0) / latencies.length / 1000).toFixed(2),
        jain_fairness: +jain.toFixed(3),
        key_load: Object.fromEntries(Object.values(PROVIDERS).flatMap(d => d.keys).map(k => [k, usage[k] || 0])),
    }));
})();
