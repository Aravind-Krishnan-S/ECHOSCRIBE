/* src/services/routing/strategies.js
   Combo routing strategies: decide the order in which a combo's targets are tried.

   Adapted from OmniRoute (MIT License, https://github.com/diegosouzapw/OmniRoute):
     src/shared/constants/routingStrategies.ts   (strategy names and semantics)
     open-sse/services/combo/applyStrategyOrdering.ts (lkgp, strict-random deck)
     open-sse/services/combo/roundRobinCombo.ts  (round-robin rotation)
   OmniRoute ships ~20 strategies tied to its quota and billing data; EchoScribe
   ports the ones that need only in-process usage statistics. */

const STRATEGIES = {
    priority: 'Declared order: keys of a model take turns; the next model is used only when every key of the current one is exhausted or failing.',
    'round-robin': 'Rotate which target goes first on each request, spreading load evenly.',
    random: 'Shuffle the targets on every request.',
    'strict-random': 'Deck draw: every target goes first once per cycle; the rest are shuffled.',
    'least-used': 'Put the target with the fewest requests so far first.',
    lkgp: 'Last known good provider: the target that most recently succeeded goes first.',
};

const DEFAULT_STRATEGY = 'priority';

// Per-combo in-process state
const rrCounters = new Map();
const decks = new Map();
const usage = new Map();     // targetId → request count
const lastGood = new Map();  // comboName → targetId

function normalizeStrategy(value) {
    const v = String(value || '').trim().toLowerCase();
    return STRATEGIES[v] ? v : DEFAULT_STRATEGY;
}

function shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Next id from a shuffled deck that refills once every id has been drawn. */
function nextFromDeck(deckKey, ids) {
    let deck = decks.get(deckKey);
    const signature = [...ids].sort().join('|');
    if (!deck || deck.signature !== signature || deck.remaining.length === 0) {
        deck = { signature, remaining: shuffle(ids) };
        decks.set(deckKey, deck);
    }
    return deck.remaining.shift();
}

/**
 * Order a combo's targets for one request.
 * @param {string} strategy
 * @param {Array<{ id: string, entry?: { family: string } }>} targets — declared order
 * @param {string} comboName
 */
function orderTargets(strategy, targets, comboName) {
    if (targets.length < 2) return [...targets];
    switch (normalizeStrategy(strategy)) {
        case 'round-robin': {
            const n = rrCounters.get(comboName) || 0;
            rrCounters.set(comboName, n + 1);
            const start = n % targets.length;
            return [...targets.slice(start), ...targets.slice(0, start)];
        }
        case 'random':
            return shuffle(targets);
        case 'strict-random': {
            const pick = nextFromDeck(comboName, targets.map(t => t.id));
            const first = targets.find(t => t.id === pick);
            return [first, ...shuffle(targets.filter(t => t.id !== pick))];
        }
        case 'least-used':
            // Stable sort keeps the declared order between equally used targets
            return [...targets].sort((a, b) => (usage.get(a.id) || 0) - (usage.get(b.id) || 0));
        case 'lkgp': {
            const good = lastGood.get(comboName);
            const idx = targets.findIndex(t => t.id === good);
            if (idx <= 0) return [...targets];
            return [targets[idx], ...targets.slice(0, idx), ...targets.slice(idx + 1)];
        }
        default:
            return [...targets];
    }
}

function recordAttempt(targetId) {
    usage.set(targetId, (usage.get(targetId) || 0) + 1);
}

function recordSuccess(comboName, targetId) {
    lastGood.set(comboName, targetId);
}

module.exports = { STRATEGIES, DEFAULT_STRATEGY, normalizeStrategy, orderTargets, recordAttempt, recordSuccess };
