const { transcribeAudio, diarizeAudio, identifyRoles, diarizeTranscript } = require('../services/ai.service');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const fs = require('fs');

/**
 * Distribute the STT provider's flat transcript text into timestamped speaker turns.
 * Splits words proportionally by each turn's duration.
 */
function alignTranscriptToTurns(fullText, turns) {
    if (!fullText || !turns || turns.length === 0) return turns;

    const words = fullText.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return turns;

    // Calculate total duration and each turn's share
    const totalDuration = turns.reduce((sum, t) => sum + Math.max(t.end - t.start, 0.1), 0);

    let wordIndex = 0;
    turns.forEach(turn => {
        const duration = Math.max(turn.end - turn.start, 0.1);
        const share = duration / totalDuration;
        const wordCount = Math.max(1, Math.round(share * words.length));
        const turnWords = words.slice(wordIndex, wordIndex + wordCount);
        turn.text = turnWords.join(' ');
        wordIndex += wordCount;
    });

    // Assign any remaining words to the last turn
    if (wordIndex < words.length) {
        const lastTurn = turns[turns.length - 1];
        lastTurn.text += ' ' + words.slice(wordIndex).join(' ');
    }

    return turns;
}

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
        //  PROCESSING PIPELINE (paper Fig. 2)
        //  1–3. DIARIZE chain: SpeechBrain (16 kHz resample → SepFormer
        //       → ECAPA-TDNN + spectral clustering) when reachable,
        //       otherwise the next configured diarization provider
        //  4.   STT chain on the enhanced audio when available
        //  5.   ROLE_LABEL chain with the eight-feature speaker statistics
        //  (6. Note synthesis runs later via /api/summarize)
        // ═══════════════════════════════════════════════════

        let diarizedTurns = [];
        let diarizationProvider = 'None (STT only)';
        let enhancedBuffer = null;

        try {
            const diar = await diarizeAudio(audioBuffer, mimeType, lang, { chains });
            diarizedTurns = diar.turns;
            diarizationProvider = diar._provider;
            enhancedBuffer = diar.enhancedBuffer;
            console.log(`[Transcribe] ${diarizationProvider}: ${diarizedTurns.length} turns, enhanced=${!!enhancedBuffer}`);
        } catch (err) {
            console.warn('[Transcribe] Every diarization provider failed; continuing with STT only:', err.message);
        }

        const sttResult = enhancedBuffer
            ? await transcribeAudio(enhancedBuffer, 'audio/wav', lang, { chains })
            : await transcribeAudio(audioBuffer, mimeType, lang, { chains });
        const transcribedText = sttResult.text;

        // ─── Handle empty diarization if ALL diarization failed ───
        if (diarizedTurns.length === 0 && transcribedText) {
            diarizedTurns = [{ speaker: '0', start: 0, end: 1, text: transcribedText }];
        }

        // ─── Fill empty SpeechBrain turns with STT transcript ───
        const hasEmptyText = diarizedTurns.some(t => !t.text || !t.text.trim());
        if (hasEmptyText && transcribedText) {
            console.log('[Transcribe] Aligning transcript into speaker turns...');
            alignTranscriptToTurns(transcribedText, diarizedTurns);
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
            _enhancedBySpeechBrain: !!enhancedBuffer,
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
