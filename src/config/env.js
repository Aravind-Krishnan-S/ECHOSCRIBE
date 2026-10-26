const { z } = require('zod');

// Only Supabase is mandatory. AI vendor keys are optional: each processing role
// resolves its providers from ROLE_CHAIN_<SLOT>, the legacy *_API_KEY variables,
// or the user's own Provider Settings (see src/services/provider-chain.js).
const envSchema = z.object({
    SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
    SUPABASE_KEY: z.string().min(1, 'SUPABASE_KEY is required'),
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    CORS_ORIGIN: z.string().default('*'),
    RESEND_API_KEY: z.string().optional().default(''),
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
