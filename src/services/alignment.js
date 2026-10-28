/* src/services/alignment.js
   Putting recognised text into diarized speaker turns.
     assignWords()   — word-timestamp alignment: each word goes to the turn that contains its midpoint
                       (or the nearest turn when it falls in a gap), as in WhisperX. Used whenever the
                       speech-to-text provider returns word times (Whisper, Deepgram, …).
     splitByDuration() — fallback when there are no word times: words are shared out in proportion
                       to each turn's duration, which misplaces words near speaker changes. */

function assignWords(words, turns) {
    if (!words?.length || !turns?.length) return turns;
    const sorted = [...turns].sort((a, b) => a.start - b.start);
    const bucket = new Map(sorted.map(t => [t, []]));
    let i = 0;
    for (const w of words) {
        const text = String(w.word ?? w.text ?? '').trim();
        if (!text) continue;
        const mid = (Number(w.start) + Number(w.end ?? w.start)) / 2;
        while (i < sorted.length - 1 && sorted[i].end < mid && sorted[i + 1].start <= mid) i++;
        // Inside turn i, or in the gap after it: pick whichever turn edge is nearer
        let best = sorted[i];
        const next = sorted[i + 1];
        if (next && mid > best.end && next.start - mid < mid - best.end) best = next;
        bucket.get(best).push(text);
    }
    for (const t of sorted) t.text = bucket.get(t).join(' ');
    return turns;
}

function splitByDuration(fullText, turns) {
    if (!fullText || !turns?.length) return turns;
    const words = fullText.split(/\s+/).filter(Boolean);
    if (!words.length) return turns;
    const total = turns.reduce((sum, t) => sum + Math.max(t.end - t.start, 0.1), 0);
    let at = 0;
    turns.forEach(turn => {
        const n = Math.max(1, Math.round((Math.max(turn.end - turn.start, 0.1) / total) * words.length));
        turn.text = words.slice(at, at + n).join(' ');
        at += n;
    });
    if (at < words.length) turns[turns.length - 1].text += ' ' + words.slice(at).join(' ');
    return turns;
}

/** Drop turns that received no words and merge neighbours left with the same speaker. */
function tidyTurns(turns) {
    const out = [];
    for (const t of turns) {
        if (!t.text || !t.text.trim()) continue;
        const last = out[out.length - 1];
        if (last && last.speaker === t.speaker) { last.text += ' ' + t.text; last.end = t.end; }
        else out.push({ ...t });
    }
    return out;
}

module.exports = { assignWords, splitByDuration, tidyTurns };
