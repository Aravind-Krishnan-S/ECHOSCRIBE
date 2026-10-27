/* src/services/grounding.js
   Evidence-linked notes and cross-vendor verification.

   1. numberTranscript()  — the diarized transcript becomes numbered turns [T1] … [Tn].
   2. The note writer (NOTE_SYNTH) cites the turns behind each sentence: "… [T3, T7]".
   3. extractStatements() — splits each note section into sentences with their cited turns
      and strips the markers from the text the clinician reads.
   4. verifyStatements()  — a model from a different vendor (VERIFY slot) labels every
      sentence supported / partial / unsupported against the turns it cites.
   The result is stored on the note as `grounding`, so the interface can link each sentence
   to its evidence and flag the ones a person must check. */

const { runChain } = require('./provider-chain');

const TURN_HEADER = /^\s*([A-Z][A-Za-z ]{1,30}|speaker_\d+|Speaker \d+|Person \d+):\s*$/;
const INLINE_TURN = /^\s*([A-Z][A-Za-z ]{1,30}|speaker_\d+|Speaker \d+|Person \d+):\s+(.+)$/;

/**
 * Parse "Role:\n    text\n\n" blocks (the pipeline's transcript format) or "Role: text" lines into turns.
 * Plain text with no speaker labels is split into chunks of about three sentences, labelled "Speaker".
 */
function numberTranscript(text) {
    const turns = [];
    const lines = String(text || '').split(/\r?\n/);
    let current = null;
    for (const raw of lines) {
        const line = raw.trimEnd();
        const header = line.match(TURN_HEADER);
        const inline = !header && line.match(INLINE_TURN);
        if (header || inline) {
            if (current && current.text.trim()) turns.push(current);
            current = { role: (header || inline)[1].trim(), text: inline ? inline[2].trim() : '' };
        } else if (current) {
            if (line.trim()) current.text += (current.text ? ' ' : '') + line.trim();
        } else if (line.trim()) {
            current = { role: 'Speaker', text: line.trim() };
        }
    }
    if (current && current.text.trim()) turns.push(current);

    // Unlabelled transcript: chunk it so citations still point somewhere useful
    if (turns.length === 1 && turns[0].role === 'Speaker') {
        const sentences = turns[0].text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [turns[0].text];
        turns.length = 0;
        for (let i = 0; i < sentences.length; i += 3) {
            turns.push({ role: 'Speaker', text: sentences.slice(i, i + 3).join(' ').trim() });
        }
    }

    const numbered = turns.map((t, i) => ({ id: i + 1, role: t.role, text: t.text }));
    return {
        turns: numbered,
        prompt: numbered.map(t => `[T${t.id}] ${t.role}: ${t.text}`).join('\n'),
    };
}

const CITATION = /\[\s*T\s*\d+(?:\s*(?:,|–|-|to)\s*T?\s*\d+)*\s*\]/gi;

function parseCitation(marker) {
    const ids = new Set();
    const body = marker.replace(/[[\]\s]/g, '').replace(/T/gi, '');
    for (const part of body.split(',')) {
        const range = part.split(/–|-|to/);
        if (range.length === 2) {
            const [a, b] = range.map(Number);
            if (a && b && b >= a && b - a < 50) for (let i = a; i <= b; i++) ids.add(i);
        } else if (Number(part)) {
            ids.add(Number(part));
        }
    }
    return [...ids];
}

/** Split a section into sentences with their cited turn ids; return the text with markers removed. */
function extractStatements(sectionText, maxTurn) {
    const text = String(sectionText || '').trim();
    if (!text || /^not discussed\.?$/i.test(text)) return { clean: text || 'Not discussed', statements: [] };

    const sentences = text.match(/[^.!?]+(?:[.!?]+(?:\s*\[[^\]]*\])*|$)/g) || [text];
    const statements = [];
    for (const s of sentences) {
        const markers = s.match(CITATION) || [];
        const turns = [...new Set(markers.flatMap(parseCitation))].filter(id => id >= 1 && id <= maxTurn).sort((a, b) => a - b);
        const clean = s.replace(CITATION, '').replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
        if (clean) statements.push({ text: clean, turns });
    }
    return { clean: statements.map(s => s.text).join(' '), statements };
}

/**
 * Ask a VERIFY model (preferably from a different vendor than the writer) to judge each statement.
 * Returns { verdicts: [{ label, reason }], provider } or null if verification could not run.
 */
async function verifyStatements(statements, turns, { chains, avoidFamily, avoidModel } = {}) {
    if (!statements.length) return { verdicts: [], provider: null, family: null };
    const byId = new Map(turns.map(t => [t.id, t]));

    const items = statements.map((s, i) => {
        const evidence = s.turns.length
            ? s.turns.map(id => byId.get(id)).filter(Boolean).map(t => `  [T${t.id}] ${t.role}: ${t.text}`).join('\n')
            : '  (no turns cited)';
        return `S${i + 1}: ${s.text}\n  Cited evidence:\n${evidence}`;
    }).join('\n\n');

    const system = `You are a meticulous clinical documentation auditor. You check whether each statement in a session note is supported by the transcript turns it cites. You MUST respond with valid JSON only.`;
    const user = `For each statement, compare it with its cited evidence only.
- "supported": every claim in the statement is stated or directly implied by the cited turns.
- "partial": some of the statement is supported, but it adds a detail, number, name or judgement the cited turns do not contain.
- "unsupported": the cited turns do not support it, or no turns are cited and it states a fact about the session.
Clinical interpretation clearly framed as the clinician's impression (for example "presentation is consistent with…") counts as supported when the cited turns contain the observations it rests on.

STATEMENTS:
${items}

Return ONLY valid JSON: {"verdicts":[{"id":"S1","label":"supported|partial|unsupported","reason":"short reason"}, ...]} with one entry per statement, in order.`;

    try {
        const { result, provider, family, model } = await runChain('VERIFY', async (adapter) => {
            const reply = await adapter.chatCompletion(system, user, { json: true, temperature: 0 });
            const parsed = JSON.parse(String(reply).replace(/```json|```/g, '').trim());
            const verdicts = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
            if (verdicts.length < statements.length * 0.8) throw new Error('Verifier skipped statements');
            return verdicts;
        }, { chains, avoidFamily, avoidModel });

        const labels = statements.map((_, i) => {
            const v = result.find(x => String(x.id).toUpperCase() === `S${i + 1}`) || result[i] || {};
            const label = ['supported', 'partial', 'unsupported'].includes(v.label) ? v.label : 'unverified';
            return { label, reason: String(v.reason || '').slice(0, 240) };
        });
        return { verdicts: labels, provider, family, model };
    } catch (err) {
        console.warn('[Grounding] Verification unavailable:', err.message);
        return null;
    }
}

/** Summary figures for a verified note. */
function summarize(sections) {
    const all = Object.values(sections).flat();
    const count = (label) => all.filter(s => s.label === label).length;
    const n = all.length;
    return {
        statements: n,
        cited: all.filter(s => s.turns.length).length,
        supported: count('supported'),
        partial: count('partial'),
        unsupported: count('unsupported'),
        unverified: count('unverified'),
        supported_ratio: n ? +(count('supported') / n).toFixed(3) : null,
        unsupported_ratio: n ? +(count('unsupported') / n).toFixed(3) : null,
    };
}

module.exports = { numberTranscript, extractStatements, parseCitation, verifyStatements, summarize };
