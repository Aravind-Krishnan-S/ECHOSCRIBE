/* src/services/groq-fallback.js
   Groq + Deepgram fallback when all Gemini keys are exhausted.
   - Groq Llama 3.3 70B → for summaries, profiles, diarization, role ID
   - Deepgram Nova-2 → for audio transcription */

const Groq = require('groq-sdk');
const { createClient } = require('@deepgram/sdk');

let groqClient = null;
let deepgramClient = null;

function initFallback() {
    const groqKey = process.env.GROQ_API_KEY;
    const dgKey = process.env.DEEPGRAM_API_KEY;

    if (groqKey) {
        groqClient = new Groq({ apiKey: groqKey });
        console.log('[Fallback] Groq initialized (Llama 3.3 70B)');
    }
    if (dgKey) {
        deepgramClient = createClient(dgKey);
        console.log('[Fallback] Deepgram initialized (Nova-2)');
    }
}

function isGroqAvailable() { return !!groqClient; }
function isDeepgramAvailable() { return !!deepgramClient; }
function isAvailable() { return !!groqClient; } // Groq is the main fallback for all text tasks

// --- Groq: Text completion (Llama 3.3 70B) ---
async function chatCompletion(systemPrompt, userPrompt, jsonMode = true) {
    if (!groqClient) throw new Error('Groq not initialized');

    const params = {
        model: 'llama-3.3-70b-versatile',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 8000,
    };

    if (jsonMode) {
        params.response_format = { type: 'json_object' };
    }

    console.log('[Fallback] Using Groq Llama 3.3 70B');
    const completion = await groqClient.chat.completions.create(params);
    return completion.choices[0]?.message?.content || '';
}

// --- Deepgram: Audio transcription (Nova-2) ---
async function transcribeAudioBuffer(audioBuffer, mimeType, lang = 'en') {
    if (!deepgramClient) throw new Error('Deepgram not initialized');

    console.log('[Fallback] Using Deepgram Nova-2 for transcription');
    const { result, error } = await deepgramClient.listen.prerecorded.transcribeFile(
        audioBuffer,
        {
            model: 'nova-2',
            language: lang,
            smart_format: true,
            punctuate: true,
        }
    );

    if (error) {
        throw new Error('Deepgram transcription failed: ' + (error.message || 'Unknown error'));
    }

    return result.results.channels[0].alternatives[0].transcript;
}

module.exports = { initFallback, isAvailable, isGroqAvailable, isDeepgramAvailable, chatCompletion, transcribeAudioBuffer };
