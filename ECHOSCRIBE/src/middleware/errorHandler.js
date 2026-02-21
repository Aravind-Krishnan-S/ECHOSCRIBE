class AppError extends Error {
    constructor(message, statusCode = 500, details = null) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        this.isOperational = true;
    }
}

function errorHandler(err, req, res, _next) {
    const statusCode = err.statusCode || 500;
    const isProduction = process.env.NODE_ENV === 'production';

    console.error(`[Error] ${req.method} ${req.path}:`, err.message);
    if (!isProduction) {
        console.error(err.stack);
    }

    res.status(statusCode).json({
        error: err.message || 'Internal server error',
        ...(err.details && !isProduction ? { details: err.details } : {}),
    });
}

function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = { AppError, errorHandler, asyncHandler };
