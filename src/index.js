require('dotenv').config();

const express = require('express');
const path = require('path');
const swaggerUi = require('swagger-ui-express');

const { validateEnv } = require('./config/env');
const { setupSecurity } = require('./middleware/security');
const { createAuthMiddleware } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');
const { initSupabase, getSupabase } = require('./services/db.service');
const { initGroq } = require('./services/ai.service');
const { swaggerSpec } = require('./docs/swagger');

const authRoutes = require('./routes/auth.routes');
const apiRoutes = require('./routes/api.routes');

// ─── Validate Environment ───
const env = validateEnv();

// ─── Initialize App ───
const app = express();

// ─── Trust Proxy (required for Vercel / reverse proxies) ───
app.set('trust proxy', 1);

// ─── Body Parsing ───
app.use(express.json({ limit: '10mb' }));

// ─── Security Middleware ───
const { aiLimiter } = setupSecurity(app, env);

// ─── Initialize Services ───
const supabase = initSupabase(env.SUPABASE_URL, env.SUPABASE_KEY);
initGroq(env.GROQ_API_KEY);

// ─── Auth Middleware Instance ───
const requireAuth = createAuthMiddleware(supabase);

// ─── Static Files ───
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Swagger Docs ───
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'EchoScribe API Docs',
}));

// ─── Auth Routes (public: signup, login, refresh) ───
app.use('/api/auth', (req, res, next) => {
    // Only protect logout and me endpoints
    const publicPaths = ['/signup', '/login', '/refresh'];
    if (publicPaths.includes(req.path)) {
        return next();
    }
    return requireAuth(req, res, next);
}, authRoutes);

// ─── Protected API Routes ───
app.use('/api', requireAuth, (req, res, next) => {
    // Apply AI rate limiter to summarize endpoint
    if (req.path === '/summarize' && req.method === 'POST') {
        return aiLimiter(req, res, next);
    }
    next();
}, apiRoutes);

// ─── Serve Frontend Pages ───
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'signup.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

app.get('/summary', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'summary.html'));
});

// ─── Error Handler (must be last) ───
app.use(errorHandler);

// ─── Start Server ───
const PORT = env.PORT;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`✅ EchoScribe server running at http://localhost:${PORT}`);
        console.log(`📚 API Docs: http://localhost:${PORT}/api/docs`);
        console.log(`🔒 Environment: ${env.NODE_ENV}`);
    });
}

module.exports = app;
