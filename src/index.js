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

    // Provider chain per role — counts only, no key material (this endpoint is public)
    let chains = null;
    try {
        const { describeServerChains } = require('./services/provider-chain');
        chains = Object.fromEntries(Object.entries(describeServerChains()).map(([slot, c]) => [
            slot,
            { source: c.source, entries: c.entries.map(e => `${e.family}:${e.model} (${e.activeKeys}/${e.keyCount} keys active)`) },
        ]));
    } catch (e) { /* not yet initialized */ }

    res.json({ ok: true, env: status, chains, node: process.version });
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
            const { attachProviderChains } = require('./services/provider-chain');
            const { swaggerSpec } = require('./docs/swagger');
            const authRoutes = require('./routes/auth.routes');
            const apiRoutes = require('./routes/api.routes');

            const { aiLimiter, heavyAiLimiter } = setupSecurity(app, env);
            const supabase = initSupabase(env.SUPABASE_URL, env.SUPABASE_KEY);

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
            app.use('/api', requireAuth, complianceLogger, attachProviderChains, (req2, res2, next2) => {
                const path = req2.path;
                const method = req2.method;

                // Heavy AI limiter (5/min) — expensive LLM operations
                if ((path === '/summarize' && method === 'POST') ||
                    (path === '/profile' && method === 'GET') ||
                    (path === '/diarize-transcript' && method === 'POST')) {
                    return heavyAiLimiter(req2, res2, next2);
                }

                // Light AI limiter (15/min) — frequent but cheap operations
                if ((path === '/transcribe-audio' && method === 'POST') ||
                    (path === '/identify-speakers' && method === 'POST') ||
                    (path === '/providers/test' && method === 'POST')) {
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
            app.get('/settings', (req2, res2) => res2.sendFile(path.join(__dirname, '..', 'public', 'settings.html')));

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

// ─── Start Server when run directly (node src/index.js, PM2, start.bat) ───
// On Vercel the app is imported by api/index.js instead, so it must not listen.
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, async () => {
        console.log(`✅ EchoScribe running at http://localhost:${PORT}`);

        // Log the resolved provider chain for each role
        try {
            const { describeServerChains } = require('./services/provider-chain');
            for (const [slot, c] of Object.entries(describeServerChains())) {
                const list = c.entries.map(e => `${e.family}:${e.model}${e.keyCount > 1 ? ` ×${e.keyCount} keys` : ''}`).join(' → ') || '(none configured)';
                console.log(`[ProviderChain] ${slot.padEnd(11)} ${list}  [${c.source}]`);
            }
        } catch (e) {
            console.log('[ProviderChain] ⚠️ Could not resolve chains:', e.message);
        }

        // Probe SpeechBrain service availability
        try {
            const speechbrain = require('./services/speechbrain-client');
            await speechbrain.probe();
        } catch (e) {
            console.log('[SpeechBrain] ⚠️ Probe skipped:', e.message);
        }
    });
}

module.exports = app;
