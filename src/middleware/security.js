const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

function setupSecurity(app, env) {
    // HTTP security headers
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'", env.SUPABASE_URL],
            },
        },
    }));

    // CORS
    app.use(cors({
        origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    }));

    // Rate limiting — 10 requests per minute for AI endpoints
    const aiLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 10,
        message: { error: 'Too many requests. Please wait a minute before trying again.' },
        standardHeaders: true,
        legacyHeaders: false,
        validate: false,
    });

    // General rate limiter — 100 requests per minute
    const generalLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false,
        validate: false,
    });

    app.use(generalLimiter);

    return { aiLimiter };
}

module.exports = { setupSecurity };
