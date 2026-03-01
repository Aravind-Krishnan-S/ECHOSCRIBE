require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();

// ─── Trust Proxy (required for Vercel / reverse proxies) ───
app.set('trust proxy', 1);

// ─── Health / Debug endpoint (BEFORE env validation) ───
app.get('/api/health', (req, res) => {
    const keys = ['GEMINI_API_KEY', 'GEMINI_API_KEYS', 'GROQ_API_KEY', 'DEEPGRAM_API_KEY', 'SUPABASE_URL', 'SUPABASE_KEY', 'NODE_ENV', 'PORT'];
    const status = {};
    keys.forEach(k => { status[k] = !!process.env[k]; });

    // Pool status
    let poolStatus = null;
    try {
        const { geminiPool } = require('./services/gemini-pool');
        poolStatus = geminiPool.getStatus();
    } catch (e) { /* not yet initialized */ }

    res.json({ ok: true, env: status, pool: poolStatus, node: process.version });
});

// ─── Validate env lazily — don't crash at module load ───
let _env = null;
function getEnv() {
    if (_env) return _env;
    const { validateEnv } = require('./config/env');
    _env = validateEnv();
    return _env;
}

// ─── Body Parsing ───
app.use(express.json({ limit: '10mb' }));

// ─── Static Files ───
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Bootstrap middleware and routes lazily ───
app.use((req, res, next) => {
    // Skip health and static
    if (req.path === '/api/health') return next();
    try {
        const env = getEnv();

        // Lazy-load everything on first real request
        if (!app._booted) {
            const swaggerUi = require('swagger-ui-express');
            const { setupSecurity } = require('./middleware/security');
            const { createAuthMiddleware } = require('./middleware/auth');
            const { errorHandler } = require('./middleware/errorHandler');
            const { initSupabase } = require('./services/db.service');
            const { initGemini } = require('./services/ai.service');
            const { swaggerSpec } = require('./docs/swagger');
            const authRoutes = require('./routes/auth.routes');
            const apiRoutes = require('./routes/api.routes');

            const { aiLimiter, heavyAiLimiter } = setupSecurity(app, env);
            const supabase = initSupabase(env.SUPABASE_URL, env.SUPABASE_KEY);

            // Initialize Gemini pool — collect keys from all env var patterns:
            //   GEMINI_API_KEYS=key1,key2  (comma-separated)
            //   GEMINI_API_KEY=key1        (single key)
            //   1_GEMINI_API_KEY=key1      (numbered keys)
            //   2_Gemini_API_KEY=key2      (any prefix/case)
            const geminiKeys = [];
            const seen = new Set();

            // 1) Comma-separated GEMINI_API_KEYS
            if (process.env.GEMINI_API_KEYS) {
                process.env.GEMINI_API_KEYS.split(',').forEach(k => {
                    const trimmed = k.trim();
                    if (trimmed && !seen.has(trimmed)) { seen.add(trimmed); geminiKeys.push(trimmed); }
                });
            }

            // 2) Single GEMINI_API_KEY
            if (process.env.GEMINI_API_KEY) {
                const k = process.env.GEMINI_API_KEY.trim();
                if (k && !seen.has(k)) { seen.add(k); geminiKeys.push(k); }
            }

            // 3) Auto-discover numbered keys: 1_GEMINI_API_KEY, 2_Gemini_API_KEY, etc.
            Object.keys(process.env).forEach(envKey => {
                if (/gemini_api_key/i.test(envKey) && envKey !== 'GEMINI_API_KEY' && envKey !== 'GEMINI_API_KEYS') {
                    const k = process.env[envKey]?.trim();
                    if (k && !seen.has(k)) { seen.add(k); geminiKeys.push(k); }
                }
            });

            initGemini(geminiKeys);
            console.log(`[EchoScribe] Gemini pool initialized with ${geminiKeys.length} key(s)`);

            // Initialize Groq + Deepgram fallback (used when all Gemini keys are exhausted)
            const { initFallback } = require('./services/groq-fallback');
            initFallback();
            const requireAuth = createAuthMiddleware(supabase);

            // Swagger docs
            app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
                customCss: '.swagger-ui .topbar { display: none }',
                customSiteTitle: 'EchoScribe API Docs',
            }));

            // Auth routes
            app.use('/api/auth', (req2, res2, next2) => {
                const publicPaths = ['/signup', '/login', '/refresh'];
                if (publicPaths.includes(req2.path)) return next2();
                return requireAuth(req2, res2, next2);
            }, authRoutes);

            const { complianceLogger } = require('./middleware/compliance');

            // Protected API routes — with tiered rate limiting for AI endpoints
            app.use('/api', requireAuth, complianceLogger, (req2, res2, next2) => {
                const path = req2.path;
                const method = req2.method;

                // Heavy AI limiter (5/min) — expensive Gemini operations
                if ((path === '/summarize' && method === 'POST') ||
                    (path === '/profile' && method === 'GET') ||
                    (path === '/diarize-transcript' && method === 'POST')) {
                    return heavyAiLimiter(req2, res2, next2);
                }

                // Light AI limiter (15/min) — frequent but cheap operations
                if ((path === '/transcribe-audio' && method === 'POST') ||
                    (path === '/identify-speakers' && method === 'POST')) {
                    return aiLimiter(req2, res2, next2);
                }

                next2();
            }, apiRoutes);

            // Page routes
            app.get('/', (req2, res2) => res2.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html')));
            app.get('/record', (req2, res2) => res2.sendFile(path.join(__dirname, '..', 'public', 'record.html')));
            app.get('/login', (req2, res2) => res2.sendFile(path.join(__dirname, '..', 'public', 'login.html')));
            app.get('/signup', (req2, res2) => res2.sendFile(path.join(__dirname, '..', 'public', 'signup.html')));
            app.get('/dashboard', (req2, res2) => res2.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html')));
            app.get('/summary', (req2, res2) => res2.sendFile(path.join(__dirname, '..', 'public', 'summary.html')));

            app.use(errorHandler);
            app._booted = true;
        }
        next();
    } catch (err) {
        // Env validation failed — return a clear 503 instead of crashing
        res.status(503).json({
            error: 'Server misconfiguration',
            detail: err.message,
        });
    }
});

// ─── Start Server (local dev only) ───
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`✅ EchoScribe running at http://localhost:${PORT}`);
    });
}

module.exports = app;
