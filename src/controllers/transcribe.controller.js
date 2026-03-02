const { transcribeWithGemini, identifyRolesWithGroq, identifyRoles, diarizeTranscript } = require('../services/ai.service');
const { transcribeAndDiarizeWithDeepgram } = require('../services/deepgram.service');
const speechbrain = require('../services/speechbrain-client');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const fs = require('fs');

/**
 * Distribute Gemini's flat transcript text into timestamped speaker turns.
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

    try {
        const audioBuffer = fs.readFileSync(req.file.path);
        const mimeType = req.file.mimetype || 'audio/webm';

        let formattedTranscript = '';
        let finalizedTurns = [];
        let roleMap = {};
        let sttProvider = '';
        let diarizationProvider = '';

        if (req.body.live === 'true') {
            // Fast text for live chunks (no diarization)
            const result = await transcribeWithGemini(audioBuffer, mimeType, lang);
            res.json({ text: result.text, _sttProvider: result._provider });
        } else {
            // ═══════════════════════════════════════════════════
            //  SPEECHBRAIN-FIRST PIPELINE
            //  1. Try SpeechBrain: enhance (noise cancel) → diarize
            //  2. Transcribe clean audio with Gemini
            //  3. Align transcript text into speaker turns
            //  4. Assign roles with Groq
            //  5. Fallback to Deepgram if SpeechBrain unavailable
            // ═══════════════════════════════════════════════════

            const sbAvailable = await speechbrain.isAvailable();
            let diarizedTurns = [];
            let enhancedFilePath = null;
            let usedSpeechBrain = false;

            if (sbAvailable) {
                // ─── SpeechBrain Path ───
                console.log('[Transcribe] Using SpeechBrain pipeline (enhance + diarize)');

                try {
                    const sbResult = await speechbrain.processAudio(req.file.path, 2);
                    diarizationProvider = 'SpeechBrain ECAPA-TDNN';
                    usedSpeechBrain = true;

                    // SpeechBrain returns diarization turns (speaker + timestamps, text may be empty)
                    diarizedTurns = (sbResult.turns || []).map(t => ({
                        speaker: t.speaker,
                        start: t.start,
                        end: t.end,
                        text: t.text || ''
                    }));

                    // Save enhanced audio for cleaner transcription
                    if (sbResult.enhanced_audio_b64) {
                        enhancedFilePath = speechbrain.saveEnhancedToTemp(sbResult.enhanced_audio_b64);
                    }

                    console.log(`[Transcribe] SpeechBrain: ${diarizedTurns.length} turns, enhanced=${!!enhancedFilePath}`);
                } catch (sbErr) {
                    console.warn('[Transcribe] SpeechBrain failed, falling back to Deepgram:', sbErr.message);
                    usedSpeechBrain = false;
                }
            }

            // ─── Deepgram Fallback for Diarization ───
            if (diarizedTurns.length === 0) {
                console.log('[Transcribe] Using Deepgram diarization fallback');
                const deepgramRes = await transcribeAndDiarizeWithDeepgram(req.file.path, lang);
                diarizedTurns = deepgramRes.turns || [];
                diarizationProvider = 'Deepgram Nova-2';
            }

            // ─── Transcribe with Gemini (use enhanced audio if available) ───
            let geminiResult;
            if (enhancedFilePath && fs.existsSync(enhancedFilePath)) {
                const enhancedBuffer = fs.readFileSync(enhancedFilePath);
                geminiResult = await transcribeWithGemini(enhancedBuffer, 'audio/wav', lang);
                fs.unlink(enhancedFilePath, () => { });
            } else {
                geminiResult = await transcribeWithGemini(audioBuffer, mimeType, lang);
            }
            const geminiText = geminiResult.text;
            sttProvider = geminiResult._provider;

            // ─── Fill empty SpeechBrain turns with Gemini transcript ───
            const hasEmptyText = diarizedTurns.some(t => !t.text || !t.text.trim());
            if (hasEmptyText && geminiText) {
                console.log('[Transcribe] Aligning Gemini transcript into speaker turns...');
                alignTranscriptToTurns(geminiText, diarizedTurns);
            }

            // ─── Build merged transcript for role identification ───
            let mergedRawTranscript = '';
            diarizedTurns.forEach(t => {
                mergedRawTranscript += `speaker_${t.speaker}:\n${t.text}\n\n`;
            });

            // ─── Identify roles with Groq (primary) ───
            console.log('[Transcribe] Identifying roles with Groq...');
            roleMap = await identifyRolesWithGroq(mergedRawTranscript, mode, diarizedTurns);
            console.log('[Transcribe] Role map:', JSON.stringify(roleMap));

            // ─── Build final diarized transcript ───
            finalizedTurns = diarizedTurns.map(turn => {
                const roleName = roleMap[`speaker_${turn.speaker}`] || `Speaker ${turn.speaker}`;
                formattedTranscript += `${roleName}:\n    ${(turn.text || '').trim()}\n\n`;
                return { role: roleName, text: (turn.text || '').trim(), speaker: turn.speaker, start: turn.start, end: turn.end };
            });

            res.json({
                text: formattedTranscript.trim(),
                turns: finalizedTurns,
                roleMap: roleMap,
                _sttProvider: sttProvider,
                _diarizationProvider: diarizationProvider,
                _roleProvider: 'Groq Llama 3.3',
                _enhancedBySpeechBrain: usedSpeechBrain && enhancedFilePath !== null
            });
        }

        // Clean up temp file
        fs.unlink(req.file.path, () => { });
    } catch (err) {
        if (req.file && req.file.path) fs.unlink(req.file.path, () => { });
        console.error('[Transcribe] Error:', err.message || err);
        throw new AppError(err.message || 'Transcription failed.', 500);
    }
});

// POST /api/identify-speakers
const identifySpeakersHandler = asyncHandler(async (req, res) => {
    const { transcript, pitchMetadata, mode } = req.body;
    if (!transcript || !transcript.trim()) {
        throw new AppError('Transcript is required.', 400);
    }

    const sessionMode = mode || 'Therapy';
    const result = await identifySpeakers(transcript, pitchMetadata, sessionMode);
    res.json(result);
});

// POST /api/diarize-transcript
const diarizeHandler = asyncHandler(async (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) {
        throw new AppError('Transcript text is required.', 400);
    }

    const turns = await diarizeTranscript(text);
    res.json({ turns });
});

module.exports = { transcribe, identifySpeakers: identifySpeakersHandler, diarize: diarizeHandler };
