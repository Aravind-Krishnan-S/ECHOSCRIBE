require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();

// ─── Trust Proxy (required for Vercel / reverse proxies) ───
app.set('trust proxy', 1);

// ─── Health / Debug endpoint (BEFORE env validation) ───
app.get('/api/health', (req, res) => {
    const keys = ['GROQ_API_KEY', 'SUPABASE_URL', 'SUPABASE_KEY', 'NODE_ENV', 'PORT'];
    const status = {};
    keys.forEach(k => { status[k] = !!process.env[k]; });
    res.json({ ok: true, env: status, node: process.version });
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
            const { initGroq } = require('./services/ai.service');
            const { swaggerSpec } = require('./docs/swagger');
            const authRoutes = require('./routes/auth.routes');
            const apiRoutes = require('./routes/api.routes');

            const { aiLimiter } = setupSecurity(app, env);
            const supabase = initSupabase(env.SUPABASE_URL, env.SUPABASE_KEY);
            initGroq(env.GROQ_API_KEY);
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

            // Protected API routes
            app.use('/api', requireAuth, complianceLogger, (req2, res2, next2) => {
                if (req2.path === '/summarize' && req2.method === 'POST') {
                    return aiLimiter(req2, res2, next2);
                }
                next2();
            }, apiRoutes);

            // Page routes
            app.get('/', (req2, res2) => res2.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
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
