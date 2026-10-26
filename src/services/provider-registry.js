/* src/services/provider-registry.js
   Adapter registry for the vendor-agnostic provider chain.

   A provider family is registered under a short key (e.g. "gemini") and
   exposes create({ apiKey, model }) which returns an adapter object with any of:
     chatCompletion(systemPrompt, userPrompt, opts)        → string     (text roles)
     transcribeAudioBuffer(buffer, mimeType, opts)          → string     (STT role)
     diarizeAudioBuffer(buffer, mimeType, opts)             → { turns, enhancedBuffer? } (DIARIZE role)
     testConnection()                                       → void (throws on bad key)

   Downstream pipeline code never imports a vendor SDK directly — it only asks
   the chain for a capability. Adding a vendor means calling registerFamily(). */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const { createClient: createDeepgramClient } = require('@deepgram/sdk');
const speechbrain = require('./speechbrain-client');

const CAPABILITIES = ['chat', 'transcribe', 'diarize'];

const families = new Map();

function registerFamily(key, definition) {
    if (!key || typeof definition?.create !== 'function') {
        throw new Error(`registerFamily: "${key}" must provide a create() function`);
    }
    const caps = definition.capabilities || [];
    caps.forEach(c => {
        if (!CAPABILITIES.includes(c)) throw new Error(`registerFamily: unknown capability "${c}"`);
    });
    families.set(key.toLowerCase(), {
        key: key.toLowerCase(),
        label: definition.label || key,
        capabilities: caps,
        requiresKey: definition.requiresKey !== false,
        create: definition.create,
    });
}

function getFamily(key) {
    return families.get(String(key || '').toLowerCase()) || null;
}

function listFamilies() {
    return [...families.values()].map(f => ({
        key: f.key,
        label: f.label,
        capabilities: f.capabilities,
        requiresKey: f.requiresKey,
    }));
}

// ─── Gemini (Google) ───

registerFamily('gemini', {
    label: 'Google Gemini',
    capabilities: ['chat', 'transcribe', 'diarize'],
    create({ apiKey, model }) {
        const genAI = new GoogleGenerativeAI(apiKey);

        async function generate(parts, { systemPrompt, json = false, temperature = 0.3 } = {}) {
            const config = { model, generationConfig: { temperature } };
            if (systemPrompt) config.systemInstruction = systemPrompt;
            if (json) config.generationConfig.responseMimeType = 'application/json';
            const result = await genAI.getGenerativeModel(config).generateContent(parts);
            return result.response.text();
        }

        const audioPart = (buffer, mimeType) => ({
            inlineData: { data: buffer.toString('base64'), mimeType },
        });

        return {
            chatCompletion(systemPrompt, userPrompt, opts = {}) {
                return generate(userPrompt, { ...opts, systemPrompt });
            },

            transcribeAudioBuffer(buffer, mimeType, { lang = 'en' } = {}) {
                const systemPrompt = `You are a highly accurate multilingual transcription engine.
Primary language target: ${lang}.

Rules:
- Transcribe every word exactly as spoken — do not paraphrase or summarise
- For code-switched speech, preserve the exact language used for each phrase
- Proper nouns, names, and technical terms: transcribe phonetically if unsure, do not guess anglicised spellings
- Filler words should be omitted unless they carry meaning
- If a word is genuinely inaudible, write [inaudible] — do not guess
- Do not add punctuation that wasn't implied by the speaker's prosody
- Output only the transcript text — no labels, no timestamps, no explanation`;
                return generate(
                    ['Please transcribe this audio exactly as instructed.', audioPart(buffer, mimeType)],
                    { systemPrompt, temperature: 0 }
                );
            },

            async diarizeAudioBuffer(buffer, mimeType, { lang = 'en' } = {}) {
                const systemPrompt = `You are an expert audio analyst capable of distinguishing speakers by their voice.
Listen to the audio and transcribe it exactly in language code: ${lang}.
You MUST diarize the audio (distinguish the speakers based on voice).
Return a JSON array of turns. Example:
[
  { "speaker": "A", "text": "Hello, how are you?" },
  { "speaker": "B", "text": "I'm doing well, thank you." }
]
Use simple speaker labels like "A" and "B".`;
                const raw = await generate(
                    ['Please transcribe and diarize this audio. Return ONLY valid JSON.', audioPart(buffer, mimeType)],
                    { systemPrompt, json: true, temperature: 0 }
                );
                const turnsArray = JSON.parse(raw.replace(/```json/g, '').replace(/```/g, '').trim());
                // Normalise speaker labels to 0/1 so they match the role map keys (speaker_0, speaker_1)
                const labelIndex = new Map();
                const turns = (Array.isArray(turnsArray) ? turnsArray : turnsArray.turns || []).map((t, idx) => {
                    const label = String(t.speaker ?? (idx % 2 === 0 ? 'A' : 'B'));
                    if (!labelIndex.has(label)) labelIndex.set(label, labelIndex.size);
                    return { speaker: labelIndex.get(label), start: idx, end: idx + 1, text: t.text || '' };
                });
                return { turns };
            },

            async testConnection() {
                await generate('Reply with the single word OK.', { temperature: 0 });
            },
        };
    },
});

// ─── Groq ───

registerFamily('groq', {
    label: 'Groq',
    capabilities: ['chat', 'transcribe'],
    create({ apiKey, model }) {
        const client = new Groq({ apiKey });
        const mime = require('mime-types');

        async function chatCompletion(systemPrompt, userPrompt, { json = false, temperature = 0.3, maxTokens = 8000 } = {}) {
            const params = {
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature,
                max_tokens: maxTokens,
            };
            if (json) params.response_format = { type: 'json_object' };
            const completion = await client.chat.completions.create(params);
            return completion.choices[0]?.message?.content || '';
        }

        return {
            chatCompletion,

            // Whisper models (e.g. whisper-large-v3) served by Groq
            async transcribeAudioBuffer(buffer, mimeType, { lang = 'en' } = {}) {
                const found = mime.extension(String(mimeType).split(';')[0]) || 'webm';
                const ext = found === 'mpga' ? 'mp3' : found;
                const result = await client.audio.transcriptions.create({
                    file: await Groq.toFile(buffer, `audio.${ext}`),
                    model,
                    language: lang,
                });
                return result.text || '';
            },

            async testConnection() {
                // Listing models validates the key without spending tokens and works for chat and Whisper models
                const list = await client.models.list();
                if (!list.data.some(m => m.id === model)) {
                    throw new Error(`Model "${model}" is not available for this Groq key`);
                }
            },
        };
    },
});

// ─── Deepgram (audio only) ───

registerFamily('deepgram', {
    label: 'Deepgram',
    capabilities: ['transcribe', 'diarize'],
    create({ apiKey, model }) {
        const client = createDeepgramClient(apiKey);

        async function transcribeFile(buffer, options) {
            const { result, error } = await client.listen.prerecorded.transcribeFile(buffer, {
                model,
                smart_format: true,
                punctuate: true,
                ...options,
            });
            if (error) {
                const err = new Error('Deepgram: ' + (error.message || 'Unknown error'));
                err.status = error.status;
                throw err;
            }
            return result;
        }

        return {
            async transcribeAudioBuffer(buffer, mimeType, { lang = 'en' } = {}) {
                const result = await transcribeFile(buffer, { language: lang });
                return result.results.channels[0].alternatives[0].transcript;
            },

            async diarizeAudioBuffer(buffer, mimeType, { lang = 'en' } = {}) {
                const result = await transcribeFile(buffer, { language: lang, diarize: true, utterances: true });
                const turns = (result.results.utterances || []).map(u => ({
                    speaker: u.speaker || 0, // 0-indexed to match roleMap keys (speaker_0, speaker_1)
                    text: u.transcript,
                    start: u.start,
                    end: u.end,
                }));
                return { turns };
            },

            async testConnection() {
                const { error } = await client.manage.getProjects();
                if (error) {
                    const err = new Error('Deepgram: ' + (error.message || 'Invalid API key'));
                    err.status = error.status || 401;
                    throw err;
                }
            },
        };
    },
});

// ─── SpeechBrain (local microservice, DIARIZE only, no key) ───

registerFamily('speechbrain', {
    label: 'SpeechBrain (local service)',
    capabilities: ['diarize'],
    requiresKey: false,
    create() {
        return {
            async diarizeAudioBuffer(buffer, mimeType, { numSpeakers = 2 } = {}) {
                if (!(await speechbrain.isAvailable())) {
                    throw new Error('SpeechBrain service not available');
                }
                const sbResult = await speechbrain.processAudioBuffer(buffer, numSpeakers);
                return {
                    turns: (sbResult.turns || []).map(t => ({
                        speaker: t.speaker, start: t.start, end: t.end, text: t.text || '',
                    })),
                    enhancedBuffer: sbResult.enhanced_audio_b64
                        ? Buffer.from(sbResult.enhanced_audio_b64, 'base64')
                        : null,
                };
            },
            async testConnection() {
                if (!(await speechbrain.isAvailable())) throw new Error('SpeechBrain service not available');
            },
        };
    },
});

module.exports = { registerFamily, getFamily, listFamilies, CAPABILITIES };
