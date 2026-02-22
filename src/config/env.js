const { z } = require('zod');

const envSchema = z.object({
    GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY is required'),
    DEEPGRAM_API_KEY: z.string().min(1, 'DEEPGRAM_API_KEY is required'),
    SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
    SUPABASE_KEY: z.string().min(1, 'SUPABASE_KEY is required'),
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    CORS_ORIGIN: z.string().default('*'),
    RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
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
