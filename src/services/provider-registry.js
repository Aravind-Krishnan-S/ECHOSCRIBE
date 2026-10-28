/* src/services/provider-registry.js
   Adapter registry for the vendor-agnostic provider chain.

   A provider family is registered under a short key (e.g. "gemini") and
   exposes create({ apiKey, model }) which returns an adapter object with any of:
     chatCompletion(systemPrompt, userPrompt, opts)        → string     (text roles)
     transcribeAudioBuffer(buffer, mimeType, opts)          → string     (STT role)
     diarizeAudioBuffer(buffer, mimeType, opts)             → { turns } (DIARIZE role)
     testConnection()                                       → void (throws on bad key)

   Downstream pipeline code never imports a vendor SDK directly — it only asks
   the chain for a capability. Adding a vendor means calling registerFamily(). */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const { createClient: createDeepgramClient } = require('@deepgram/sdk');

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
        group: definition.group || 'Other',
        keyUrl: definition.keyUrl || null,
        listModels: definition.listModels || null,
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
        group: f.group,
        keyUrl: f.keyUrl,
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
            try {
                const completion = await client.chat.completions.create(params);
                return completion.choices[0]?.message?.content || '';
            } catch (err) {
                // Groq rejects its own output when JSON mode validation fails (json_validate_failed).
                // Retry once without JSON mode; callers already parse JSON from plain or fenced replies.
                if (!json || !/json_validate_failed|Failed to generate JSON/i.test(String(err.message))) throw err;
                delete params.response_format;
                const completion = await client.chat.completions.create(params);
                return completion.choices[0]?.message?.content || '';
            }
        }

        return {
            chatCompletion,

            // Whisper models (e.g. whisper-large-v3) served by Groq; words=true adds word timestamps
            async transcribeAudioBuffer(buffer, mimeType, { lang = 'en', words = false } = {}) {
                const found = mime.extension(String(mimeType).split(';')[0]) || 'webm';
                const ext = found === 'mpga' ? 'mp3' : found;
                const params = { file: await Groq.toFile(buffer, `audio.${ext}`), model, language: lang };
                if (words) Object.assign(params, { response_format: 'verbose_json', timestamp_granularities: ['word'] });
                const result = await client.audio.transcriptions.create(params);
                return words ? { text: result.text || '', words: result.words || [] } : (result.text || '');
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
            async transcribeAudioBuffer(buffer, mimeType, { lang = 'en', words = false } = {}) {
                const result = await transcribeFile(buffer, { language: lang });
                const alt = result.results.channels[0].alternatives[0];
                if (!words) return alt.transcript;
                return { text: alt.transcript, words: (alt.words || []).map(w => ({ word: w.punctuated_word || w.word, start: w.start, end: w.end })) };
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

// ─── pyannote (local speech service, DIARIZE only, no key) ───

registerFamily('pyannote', {
    label: 'pyannote (this computer)',
    capabilities: ['diarize'],
    requiresKey: false,
    group: 'On this computer',
    create() {
        const localSpeech = require('./local-speech');
        return {
            async diarizeAudioBuffer(buffer, mimeType, { numSpeakers = 2 } = {}) {
                return { turns: await localSpeech.diarize(buffer, { numSpeakers }) };
            },
            async testConnection() {
                if (!(await localSpeech.isAvailable())) throw new Error('Local speech service not available');
            },
        };
    },
});

// ─── Catalogue: every other organisation (see provider-catalog.js) ───

const { CATALOG, classifyModel, baseUrlFor } = require('./provider-catalog');

/** fetch that throws an Error carrying the HTTP status, so the router can classify it. */
async function httpJson(url, init = {}, vendor = 'Provider') {
    const res = await fetch(url, init);
    const body = await res.text();
    if (!res.ok) {
        const err = new Error(`${vendor} ${res.status}: ${body.slice(0, 300)}`);
        err.status = res.status;
        throw err;
    }
    try { return body ? JSON.parse(body) : {}; } catch { return { text: body }; }
}

function audioFile(buffer, mimeType) {
    const mime = require('mime-types');
    const found = mime.extension(String(mimeType || '').split(';')[0]) || 'webm';
    const ext = found === 'mpga' ? 'mp3' : found;
    return { blob: new Blob([buffer], { type: String(mimeType || 'audio/webm').split(';')[0] }), name: `audio.${ext}` };
}

// OpenAI-compatible APIs: OpenAI, Mistral, xAI, DeepSeek, OpenRouter, Together, Ollama, …
function openAiCompatible(entry) {
    return ({ apiKey, model }) => {
        const base = baseUrlFor(entry);
        const auth = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

        async function chatCompletion(systemPrompt, userPrompt, { json = false, temperature = 0.3, maxTokens = 8000 } = {}) {
            const payload = {
                model,
                messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                temperature,
                max_tokens: maxTokens,
            };
            if (json) payload.response_format = { type: 'json_object' };
            const send = () => httpJson(`${base}/chat/completions`, {
                method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            }, entry.label);
            let data;
            try {
                data = await send();
            } catch (err) {
                // Not every compatible API supports JSON mode; callers parse JSON from plain replies too
                if (!json || err.status !== 400 || !/response_format|json/i.test(err.message)) throw err;
                delete payload.response_format;
                data = await send();
            }
            const content = data.choices?.[0]?.message?.content;
            return Array.isArray(content) ? content.map(p => p.text || '').join('') : (content || '');
        }

        async function transcribeAudioBuffer(buffer, mimeType, { lang = 'en', words = false } = {}) {
            const send = (withWords) => {
                const { blob, name } = audioFile(buffer, mimeType);
                const form = new FormData();
                form.append('file', blob, name);
                form.append('model', model);
                if (lang) form.append('language', lang);
                if (withWords) { form.append('response_format', 'verbose_json'); form.append('timestamp_granularities[]', 'word'); }
                return httpJson(`${base}/audio/transcriptions`, { method: 'POST', headers: auth, body: form }, entry.label);
            };
            if (!words) return (await send(false)).text || '';
            // Not every compatible model offers word timestamps; fall back to plain text when it refuses
            const data = await send(true).catch(err => (err.status === 400 ? send(false) : Promise.reject(err)));
            return { text: data.text || '', words: Array.isArray(data.words) ? data.words : [] };
        }

        return {
            chatCompletion,
            transcribeAudioBuffer,
            async testConnection() {
                if (entry.noModelList) { await chatCompletion('Reply with OK.', 'OK?', { maxTokens: 5 }); return; }
                const list = await httpJson(`${base}/models`, { headers: auth }, entry.label);
                const ids = (list.data || []).map(m => m.id);
                if (ids.length && model && !ids.includes(model)) throw new Error(`Model "${model}" is not available for this ${entry.label} key`);
            },
        };
    };
}

function anthropicAdapter(entry) {
    return ({ apiKey, model }) => {
        const base = baseUrlFor(entry);
        const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' };
        return {
            async chatCompletion(systemPrompt, userPrompt, { json = false, temperature = 0.3, maxTokens = 8000 } = {}) {
                const data = await httpJson(`${base}/messages`, {
                    method: 'POST', headers,
                    body: JSON.stringify({
                        model, max_tokens: maxTokens, temperature,
                        system: json ? `${systemPrompt}\n\nRespond with valid JSON only.` : systemPrompt,
                        messages: [{ role: 'user', content: userPrompt }],
                    }),
                }, entry.label);
                return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
            },
            async testConnection() {
                await httpJson(`${base}/models?limit=1`, { headers }, entry.label);
            },
        };
    };
}

/** Group consecutive same-speaker items into turns; speaker labels become 0, 1, … */
function toTurns(items) {
    const index = new Map();
    const turns = [];
    for (const it of items) {
        const text = String(it.text || '');
        if (!text.trim()) continue;
        if (!index.has(it.speaker)) index.set(it.speaker, index.size);
        const speaker = index.get(it.speaker);
        const last = turns[turns.length - 1];
        if (last && last.speaker === speaker && it.join) { last.text += text; last.end = it.end; continue; }
        turns.push({ speaker, start: it.start, end: it.end, text });
    }
    return turns.map(t => ({ ...t, text: t.text.trim() }));
}

function assemblyAiAdapter(entry) {
    return ({ apiKey, model }) => {
        const base = 'https://api.assemblyai.com/v2';
        const headers = { authorization: apiKey };
        async function run(buffer, lang, diarize) {
            const up = await httpJson(`${base}/upload`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: buffer }, entry.label);
            const job = await httpJson(`${base}/transcript`, {
                method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ audio_url: up.upload_url, speech_model: model, speaker_labels: diarize, speakers_expected: diarize ? 2 : undefined, language_code: lang }),
            }, entry.label);
            for (;;) {
                const t = await httpJson(`${base}/transcript/${job.id}`, { headers }, entry.label);
                if (t.status === 'completed') return t;
                if (t.status === 'error') throw new Error(`AssemblyAI: ${t.error}`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        return {
            async transcribeAudioBuffer(buffer, mimeType, { lang = 'en' } = {}) {
                return (await run(buffer, lang, false)).text || '';
            },
            async diarizeAudioBuffer(buffer, mimeType, { lang = 'en' } = {}) {
                const t = await run(buffer, lang, true);
                return { turns: toTurns((t.utterances || []).map(u => ({ speaker: u.speaker, start: u.start / 1000, end: u.end / 1000, text: u.text }))) };
            },
            async testConnection() {
                await httpJson(`${base}/transcript?limit=1`, { headers }, entry.label);
            },
        };
    };
}

function elevenLabsAdapter(entry) {
    return ({ apiKey, model }) => {
        const headers = { 'xi-api-key': apiKey };
        async function run(buffer, mimeType, lang, diarize) {
            const { blob, name } = audioFile(buffer, mimeType);
            const form = new FormData();
            form.append('file', blob, name);
            form.append('model_id', model);
            if (lang) form.append('language_code', lang);
            form.append('diarize', diarize ? 'true' : 'false');
            if (diarize) form.append('num_speakers', '2');
            return httpJson('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers, body: form }, entry.label);
        }
        return {
            async transcribeAudioBuffer(buffer, mimeType, { lang = 'en' } = {}) {
                return (await run(buffer, mimeType, lang, false)).text || '';
            },
            async diarizeAudioBuffer(buffer, mimeType, { lang = 'en' } = {}) {
                const r = await run(buffer, mimeType, lang, true);
                const words = (r.words || []).filter(w => w.type !== 'audio_event');
                return { turns: toTurns(words.map(w => ({ speaker: w.speaker_id || 'speaker_0', start: w.start, end: w.end, text: w.text, join: true }))) };
            },
            async testConnection() {
                await httpJson('https://api.elevenlabs.io/v1/user', { headers }, entry.label);
            },
        };
    };
}

// Live model lists per kind; each returns [{ id, meta }]
const MODEL_LISTERS = {
    async openai(entry, apiKey) {
        const data = await httpJson(`${baseUrlFor(entry)}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} }, entry.label);
        return (data.data || data.models || []).map(m => ({ id: m.id || m.name, meta: m }));
    },
    async anthropic(entry, apiKey) {
        const data = await httpJson(`${baseUrlFor(entry)}/models?limit=100`, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } }, entry.label);
        return (data.data || []).map(m => ({ id: m.id, meta: m }));
    },
    async gemini(entry, apiKey) {
        const data = await httpJson(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`, {}, entry.label);
        return (data.models || []).map(m => ({ id: String(m.name).replace(/^models\//, ''), meta: m }));
    },
    async groq(entry, apiKey) {
        const data = await httpJson('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } }, entry.label);
        return (data.data || []).filter(m => m.active !== false).map(m => ({ id: m.id, meta: m }));
    },
    async deepgram(entry, apiKey) {
        const data = await httpJson('https://api.deepgram.com/v1/models', { headers: { Authorization: `Token ${apiKey}` } }, entry.label);
        return [...new Set((data.stt || []).filter(m => m.batch !== false).map(m => m.canonical_name))].map(id => ({ id, meta: {} }));
    },
};

const FACTORIES = { openai: openAiCompatible, anthropic: anthropicAdapter, assemblyai: assemblyAiAdapter, elevenlabs: elevenLabsAdapter };

for (const entry of CATALOG) {
    const existing = families.get(entry.key);
    if (existing) {
        Object.assign(existing, { label: entry.label, group: entry.group, keyUrl: entry.keyUrl });
        continue;
    }
    registerFamily(entry.key, {
        label: entry.label,
        group: entry.group,
        keyUrl: entry.keyUrl,
        capabilities: entry.capabilities,
        requiresKey: entry.requiresKey !== false,
        create: FACTORIES[entry.kind](entry),
    });
}

/**
 * Models one organisation offers, each with what it can do. Uses the live list when the key allows it,
 * otherwise the catalogue's suggestions. Returns { models: [{ id, caps }], live }.
 */
async function listModels(familyKey, apiKey) {
    const entry = CATALOG.find(c => c.key === familyKey);
    if (!entry) return { models: [], live: false };
    const suggested = entry.models.map(m => ({ id: m.id, caps: m.caps }));
    const lister = MODEL_LISTERS[entry.kind];
    if (!lister || entry.noModelList || (entry.requiresKey !== false && !apiKey)) return { models: suggested, live: false };
    const raw = await lister(entry, apiKey);
    const live = raw
        .map(m => ({ id: m.id, caps: classifyModel(entry.key, m.id, m.meta) }))
        .filter(m => m.id && m.caps.length);
    // Suggested models first (known good), then the rest of the live list alphabetically
    const ids = new Set(live.map(m => m.id));
    const first = suggested.filter(m => ids.has(m.id));
    const rest = live.filter(m => !first.some(f => f.id === m.id)).sort((a, b) => a.id.localeCompare(b.id));
    return { models: [...first, ...rest], live: true };
}

module.exports = { registerFamily, getFamily, listFamilies, listModels, CAPABILITIES };
