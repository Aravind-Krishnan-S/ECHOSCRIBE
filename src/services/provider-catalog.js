/* src/services/provider-catalog.js
   Organisations EchoScribe can call, how to reach them, and how to tell which of their
   models can do which task. The registry turns every entry into a provider family.

   kind:
     openai     OpenAI-compatible REST API (chat/completions, audio/transcriptions, models)
     anthropic  Anthropic Messages API
     (gemini, groq, deepgram and pyannote keep their own adapters in provider-registry.js)
   capabilities: what the organisation offers at all; each model is classified by classifyModel().
   models: suggested models shown before a key is added or when the live list cannot be fetched. */

const CATALOG = [
    // ─── Frontier labs ───
    {
        key: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1',
        keyUrl: 'platform.openai.com/api-keys', group: 'Frontier labs', capabilities: ['chat', 'transcribe'],
        models: [
            { id: 'gpt-4.1-mini', caps: ['chat'] }, { id: 'gpt-4.1', caps: ['chat'] }, { id: 'gpt-4o-mini', caps: ['chat'] },
            { id: 'gpt-4o-transcribe', caps: ['transcribe'] }, { id: 'gpt-4o-mini-transcribe', caps: ['transcribe'] }, { id: 'whisper-1', caps: ['transcribe'] },
        ],
    },
    {
        key: 'anthropic', label: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1',
        keyUrl: 'console.anthropic.com/settings/keys', group: 'Frontier labs', capabilities: ['chat'],
        models: [{ id: 'claude-sonnet-5-5', caps: ['chat'] }, { id: 'claude-haiku-5-5', caps: ['chat'] }, { id: 'claude-opus-5-5', caps: ['chat'] }],
    },
    {
        key: 'gemini', label: 'Google Gemini', kind: 'gemini', keyUrl: 'aistudio.google.com/apikey',
        group: 'Frontier labs', capabilities: ['chat', 'transcribe', 'diarize'],
        models: [
            { id: 'gemini-3.5-flash', caps: ['chat', 'transcribe', 'diarize'] },
            { id: 'gemini-3-flash-preview', caps: ['chat', 'transcribe', 'diarize'] },
            { id: 'gemini-3.5-flash-lite', caps: ['chat', 'transcribe', 'diarize'] },
        ],
    },
    {
        key: 'xai', label: 'xAI (Grok)', kind: 'openai', baseUrl: 'https://api.x.ai/v1',
        keyUrl: 'console.x.ai', group: 'Frontier labs', capabilities: ['chat'],
        models: [{ id: 'grok-4', caps: ['chat'] }, { id: 'grok-3-mini', caps: ['chat'] }],
    },
    {
        key: 'mistral', label: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', baseUrlEnv: 'MISTRAL_BASE_URL',
        keyUrl: 'console.mistral.ai/api-keys', group: 'Frontier labs', capabilities: ['chat', 'transcribe'],
        models: [
            { id: 'mistral-small-latest', caps: ['chat'] }, { id: 'mistral-medium-latest', caps: ['chat'] },
            { id: 'mistral-large-latest', caps: ['chat'] }, { id: 'voxtral-mini-latest', caps: ['transcribe'] },
        ],
    },
    {
        key: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1',
        keyUrl: 'platform.deepseek.com/api_keys', group: 'Frontier labs', capabilities: ['chat'],
        models: [{ id: 'deepseek-chat', caps: ['chat'] }, { id: 'deepseek-reasoner', caps: ['chat'] }],
    },
    {
        key: 'cohere', label: 'Cohere', kind: 'openai', baseUrl: 'https://api.cohere.ai/compatibility/v1',
        keyUrl: 'dashboard.cohere.com/api-keys', group: 'Frontier labs', capabilities: ['chat'],
        models: [{ id: 'command-a-03-2025', caps: ['chat'] }, { id: 'command-r-plus', caps: ['chat'] }],
    },
    {
        key: 'qwen', label: 'Alibaba Qwen', kind: 'openai', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        keyUrl: 'modelstudio.console.alibabacloud.com', group: 'Frontier labs', capabilities: ['chat'],
        models: [{ id: 'qwen-plus', caps: ['chat'] }, { id: 'qwen-max', caps: ['chat'] }, { id: 'qwen-turbo', caps: ['chat'] }],
    },
    {
        key: 'moonshot', label: 'Moonshot AI (Kimi)', kind: 'openai', baseUrl: 'https://api.moonshot.ai/v1',
        keyUrl: 'platform.moonshot.ai', group: 'Frontier labs', capabilities: ['chat'],
        models: [{ id: 'kimi-k2-0905-preview', caps: ['chat'] }],
    },
    {
        key: 'zhipu', label: 'Z.ai (GLM)', kind: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4',
        keyUrl: 'z.ai/manage-apikey/apikey-list', group: 'Frontier labs', capabilities: ['chat'],
        models: [{ id: 'glm-4.6', caps: ['chat'] }, { id: 'glm-4.5-air', caps: ['chat'] }],
    },
    {
        key: 'perplexity', label: 'Perplexity', kind: 'openai', baseUrl: 'https://api.perplexity.ai', noModelList: true,
        keyUrl: 'perplexity.ai/settings/api', group: 'Frontier labs', capabilities: ['chat'],
        models: [{ id: 'sonar', caps: ['chat'] }, { id: 'sonar-pro', caps: ['chat'] }],
    },

    // ─── Inference platforms (host open models) ───
    {
        key: 'groq', label: 'Groq', kind: 'groq', keyUrl: 'console.groq.com/keys',
        group: 'Inference platforms', capabilities: ['chat', 'transcribe'],
        models: [
            { id: 'openai/gpt-oss-120b', caps: ['chat'] }, { id: 'llama-3.3-70b-versatile', caps: ['chat'] },
            { id: 'whisper-large-v3', caps: ['transcribe'] }, { id: 'whisper-large-v3-turbo', caps: ['transcribe'] },
        ],
    },
    {
        key: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1',
        keyUrl: 'openrouter.ai/settings/keys', group: 'Inference platforms', capabilities: ['chat'],
        models: [{ id: 'openai/gpt-oss-120b', caps: ['chat'] }, { id: 'meta-llama/llama-3.3-70b-instruct', caps: ['chat'] }],
    },
    {
        key: 'together', label: 'Together AI', kind: 'openai', baseUrl: 'https://api.together.xyz/v1',
        keyUrl: 'api.together.ai/settings/api-keys', group: 'Inference platforms', capabilities: ['chat', 'transcribe'],
        models: [{ id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', caps: ['chat'] }, { id: 'openai/whisper-large-v3', caps: ['transcribe'] }],
    },
    {
        key: 'fireworks', label: 'Fireworks AI', kind: 'openai', baseUrl: 'https://api.fireworks.ai/inference/v1',
        keyUrl: 'fireworks.ai/account/api-keys', group: 'Inference platforms', capabilities: ['chat'],
        models: [{ id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', caps: ['chat'] }],
    },
    {
        key: 'cerebras', label: 'Cerebras', kind: 'openai', baseUrl: 'https://api.cerebras.ai/v1',
        keyUrl: 'cloud.cerebras.ai', group: 'Inference platforms', capabilities: ['chat'],
        models: [{ id: 'gpt-oss-120b', caps: ['chat'] }, { id: 'llama-3.3-70b', caps: ['chat'] }],
    },
    {
        key: 'sambanova', label: 'SambaNova', kind: 'openai', baseUrl: 'https://api.sambanova.ai/v1',
        keyUrl: 'cloud.sambanova.ai/apis', group: 'Inference platforms', capabilities: ['chat'],
        models: [{ id: 'Meta-Llama-3.3-70B-Instruct', caps: ['chat'] }],
    },
    {
        key: 'deepinfra', label: 'DeepInfra', kind: 'openai', baseUrl: 'https://api.deepinfra.com/v1/openai',
        keyUrl: 'deepinfra.com/dash/api_keys', group: 'Inference platforms', capabilities: ['chat', 'transcribe'],
        models: [{ id: 'meta-llama/Llama-3.3-70B-Instruct', caps: ['chat'] }, { id: 'openai/whisper-large-v3', caps: ['transcribe'] }],
    },
    {
        key: 'nvidia', label: 'NVIDIA NIM', kind: 'openai', baseUrl: 'https://integrate.api.nvidia.com/v1',
        keyUrl: 'build.nvidia.com', group: 'Inference platforms', capabilities: ['chat'],
        models: [{ id: 'meta/llama-3.3-70b-instruct', caps: ['chat'] }],
    },
    {
        key: 'huggingface', label: 'Hugging Face', kind: 'openai', baseUrl: 'https://router.huggingface.co/v1',
        keyUrl: 'huggingface.co/settings/tokens', group: 'Inference platforms', capabilities: ['chat'],
        models: [{ id: 'openai/gpt-oss-120b', caps: ['chat'] }],
    },

    // ─── Speech ───
    {
        key: 'deepgram', label: 'Deepgram', kind: 'deepgram', keyUrl: 'console.deepgram.com',
        group: 'Speech', capabilities: ['transcribe', 'diarize'],
        models: [{ id: 'nova-3', caps: ['transcribe', 'diarize'] }, { id: 'nova-2', caps: ['transcribe', 'diarize'] }],
    },
    {
        key: 'assemblyai', label: 'AssemblyAI', kind: 'assemblyai', keyUrl: 'assemblyai.com/app/api-keys',
        group: 'Speech', capabilities: ['transcribe', 'diarize'], noModelList: true,
        models: [{ id: 'universal', caps: ['transcribe', 'diarize'] }, { id: 'slam-1', caps: ['transcribe', 'diarize'] }],
    },
    {
        key: 'elevenlabs', label: 'ElevenLabs', kind: 'elevenlabs', keyUrl: 'elevenlabs.io/app/settings/api-keys',
        group: 'Speech', capabilities: ['transcribe', 'diarize'], noModelList: true,
        models: [{ id: 'scribe_v1', caps: ['transcribe', 'diarize'] }],
    },

    // ─── On this computer (no key, data never leaves the machine) ───
    {
        key: 'ollama', label: 'Ollama (this computer)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', baseUrlEnv: 'OLLAMA_BASE_URL',
        keyUrl: 'ollama.com/download', group: 'On this computer', capabilities: ['chat'], requiresKey: false,
        models: [{ id: 'llama3.1:8b', caps: ['chat'] }, { id: 'qwen2.5:7b', caps: ['chat'] }],
    },
    {
        key: 'lmstudio', label: 'LM Studio (this computer)', kind: 'openai', baseUrl: 'http://localhost:1234/v1', baseUrlEnv: 'LMSTUDIO_BASE_URL',
        keyUrl: 'lmstudio.ai', group: 'On this computer', capabilities: ['chat'], requiresKey: false,
        models: [],
    },
];

// Model ids that are never usable for EchoScribe's tasks (embeddings, images, speech output, moderation …)
const NOT_USABLE = /embed|rerank|tts|-image|orpheus|playai|safeguard|nano-banana|robotics|customtools|text-to-speech|dall-e|gpt-image|imagen|image-generation|veo|sora|moderation|guard|realtime|computer-use|search-preview|babbage|davinci|aqa|-live|native-audio|lyria/i;
const SPEECH_TO_TEXT = /whisper|transcribe|voxtral|scribe|^nova-|universal|slam-1/i;

/**
 * Capabilities of one model id for one organisation:
 *   chat → note writing, role labelling, profiles, verification
 *   transcribe → speech-to-text;  diarize → speaker separation
 * `meta` is the raw entry from the vendor's model list when it says more (OpenRouter modalities, Gemini methods).
 */
function classifyModel(familyKey, id, meta = {}) {
    const name = String(id || '');
    if (!name || NOT_USABLE.test(name)) return [];
    if (familyKey === 'gemini') {
        const methods = meta.supportedGenerationMethods;
        if (Array.isArray(methods) && !methods.includes('generateContent')) return [];
        if (!/gemini/i.test(name)) return [];
        return ['chat', 'transcribe', 'diarize'];
    }
    if (familyKey === 'deepgram' || familyKey === 'assemblyai' || familyKey === 'elevenlabs') return ['transcribe', 'diarize'];
    if (familyKey === 'openrouter' && meta.architecture) {
        const out = meta.architecture.output_modalities || [];
        return out.length && !out.includes('text') ? [] : ['chat'];
    }
    const entry = CATALOG.find(c => c.key === familyKey);
    if (SPEECH_TO_TEXT.test(name)) return entry && entry.capabilities.includes('transcribe') ? ['transcribe'] : [];
    return entry && entry.capabilities.includes('chat') ? ['chat'] : [];
}

function catalogEntry(key) {
    return CATALOG.find(c => c.key === String(key || '').toLowerCase()) || null;
}

function baseUrlFor(entry) {
    return String((entry.baseUrlEnv && process.env[entry.baseUrlEnv]) || entry.baseUrl || '').replace(/\/+$/, '');
}

module.exports = { CATALOG, classifyModel, catalogEntry, baseUrlFor };
