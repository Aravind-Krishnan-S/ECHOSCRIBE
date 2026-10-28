const { transcribeAudio, diarizeAudio, identifyRoles, diarizeTranscript } = require('../services/ai.service');
const alignment = require('../services/alignment');
const audioPrep = require('../services/audio-prep');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const fs = require('fs');

/**
 * Distribute the STT provider's flat transcript text into timestamped speaker turns.
 * Splits words proportionally by each turn's duration.
 */
// POST /api/transcribe-audio
const transcribe = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new AppError('No audio file provided.', 400);
    }

    const lang = req.body.language || 'en';
    const mode = req.body.mode || 'Therapy';
    const chains = req.providerChains;

    try {
        const audioBuffer = fs.readFileSync(req.file.path);
        const mimeType = req.file.mimetype || 'audio/webm';

        if (req.body.live === 'true') {
            // Fast text for live chunks (no diarization)
            const result = await transcribeAudio(audioBuffer, mimeType, lang, { chains });
            return res.json({ text: result.text, _sttProvider: result._provider });
        }

        // ═══════════════════════════════════════════════════
        //  PROCESSING PIPELINE (paper Fig. 1)
        //  1–3. DIARIZE chain: local pyannote community-1 when reachable,
        //       otherwise the next configured diarization provider
        //  4.   STT chain on the original recording (no denoising: it raised
        //       word error rates; a cleaned copy exists only for listening)
        //  5.   ROLE_LABEL chain with the eight-feature speaker statistics
        //  (6. Note synthesis runs later via /api/summarize)
        // ═══════════════════════════════════════════════════

        let diarizedTurns = [];
        let diarizationProvider = 'None (STT only)';
        let alignmentMethod = null;

        // Long local sessions: measure the length and give cloud models a compact mono Opus copy
        const durationSec = await audioPrep.probeDuration(audioBuffer).catch(() => null);
        const cloudAudio = await audioPrep.toCompactOpus(audioBuffer, mimeType).catch(() => ({ buffer: audioBuffer, mimeType }));

        try {
            const diar = await diarizeAudio(audioBuffer, mimeType, lang, { chains, durationSec, cloudAudio });
            diarizedTurns = diar.turns;
            diarizationProvider = diar._provider;
            console.log(`[Transcribe] ${diarizationProvider}: ${diarizedTurns.length} turns`);
        } catch (err) {
            console.warn('[Transcribe] Every diarization provider failed; continuing with STT only:', err.message);
        }

        // Word timestamps let each word go to the speaker turn it was spoken in
        const sttResult = await transcribeAudio(cloudAudio.buffer, cloudAudio.mimeType, lang, { chains, durationSec, words: diarizedTurns.length > 0 });
        const transcribedText = sttResult.text;

        // ─── No audio diarization: split the transcript into speakers with the text model ───
        if (diarizedTurns.length === 0 && transcribedText) {
            const textTurns = await diarizeTranscript(transcribedText, { chains });
            diarizedTurns = textTurns.map((t, idx) => ({
                speaker: String(Math.max(0, (Number(t.speaker) || 1) - 1)), // Person 1/2 → speaker_0/1
                start: idx,
                end: idx + 1,
                text: t.text || '',
            }));
            diarizationProvider = textTurns.length > 1 ? 'Transcript-based (ROLE_LABEL model)' : 'None (STT only)';
        }

        // ─── Fill timed diarization turns (no text yet) with the STT transcript ───
        const hasEmptyText = diarizedTurns.some(t => !t.text || !t.text.trim());
        if (hasEmptyText && transcribedText) {
            if (sttResult.words) {
                alignment.assignWords(sttResult.words, diarizedTurns);
                diarizedTurns = alignment.tidyTurns(diarizedTurns);
                alignmentMethod = 'word timestamps';
            } else {
                alignment.splitByDuration(transcribedText, diarizedTurns);
                alignmentMethod = 'turn duration';
            }
            console.log(`[Transcribe] Text placed into speaker turns by ${alignmentMethod}`);
        }

        // ─── Build merged transcript for role identification ───
        let mergedRawTranscript = '';
        diarizedTurns.forEach(t => {
            mergedRawTranscript += `speaker_${t.speaker}:\n${t.text}\n\n`;
        });

        const { roleMap, _provider: roleProvider } = await identifyRoles(mergedRawTranscript, mode, diarizedTurns, { chains });

        // ─── Build final diarized transcript ───
        let formattedTranscript = '';
        const finalizedTurns = diarizedTurns.map(turn => {
            const roleName = roleMap[`speaker_${turn.speaker}`] || `Speaker ${turn.speaker}`;
            formattedTranscript += `${roleName}:\n    ${(turn.text || '').trim()}\n\n`;
            return { role: roleName, text: (turn.text || '').trim(), speaker: turn.speaker, start: turn.start, end: turn.end };
        });

        res.json({
            text: formattedTranscript.trim(),
            turns: finalizedTurns,
            roleMap,
            _sttProvider: sttResult._provider,
            _diarizationProvider: diarizationProvider,
            _roleProvider: roleProvider,
            _alignment: alignmentMethod,
            durationSec,
        });
    } catch (err) {
        console.error('[Transcribe] Error:', err.message || err);
        throw err instanceof AppError ? err : new AppError(err.message || 'Transcription failed.', 500);
    } finally {
        fs.unlink(req.file.path, () => { });
    }
});

// POST /api/identify-speakers
const identifySpeakersHandler = asyncHandler(async (req, res) => {
    const { transcript, turns, mode } = req.body;
    if (!transcript || !transcript.trim()) {
        throw new AppError('Transcript is required.', 400);
    }

    const result = await identifyRoles(transcript, mode || 'Therapy', Array.isArray(turns) ? turns : [], { chains: req.providerChains });
    res.json(result);
});

// POST /api/diarize-transcript
const diarizeHandler = asyncHandler(async (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) {
        throw new AppError('Transcript text is required.', 400);
    }

    const turns = await diarizeTranscript(text, { chains: req.providerChains });
    res.json({ turns });
});

module.exports = { transcribe, identifySpeakers: identifySpeakersHandler, diarize: diarizeHandler };
