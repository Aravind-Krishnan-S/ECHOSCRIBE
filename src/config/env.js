const { z } = require('zod');

const envSchema = z.object({
    GEMINI_API_KEY: z.string().optional().default(''),
    GEMINI_API_KEYS: z.string().optional().default(''),
    DEEPGRAM_API_KEY: z.string().min(1, 'DEEPGRAM_API_KEY is required'),
    SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
    SUPABASE_KEY: z.string().min(1, 'SUPABASE_KEY is required'),
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    CORS_ORIGIN: z.string().default('*'),
    RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
}).refine(data => {
    // Accept keys from GEMINI_API_KEY, GEMINI_API_KEYS, or numbered variants (1_GEMINI_API_KEY, etc.)
    if (data.GEMINI_API_KEY && data.GEMINI_API_KEY.length > 0) return true;
    if (data.GEMINI_API_KEYS && data.GEMINI_API_KEYS.length > 0) return true;
    // Check for numbered keys in process.env directly
    const hasNumbered = Object.keys(process.env).some(k =>
        /gemini_api_key/i.test(k) && process.env[k]?.trim().length > 0
    );
    return hasNumbered;
}, {
    message: 'At least one Gemini API key is required (GEMINI_API_KEY, GEMINI_API_KEYS, or numbered like 1_GEMINI_API_KEY)',
});

function validateEnv() {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        const errorMsg = result.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join(', ');
        throw new Error(`Environment validation failed: ${errorMsg}`);
    }

    return result.data;
}

module.exports = { validateEnv };
