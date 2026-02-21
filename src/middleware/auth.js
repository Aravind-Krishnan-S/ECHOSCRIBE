const { AppError } = require('./errorHandler');

function createAuthMiddleware(supabase) {
    return async (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                throw new AppError('Authentication required. Please log in.', 401);
            }

            const token = authHeader.split(' ')[1];

            const { data: { user }, error } = await supabase.auth.getUser(token);

            if (error || !user) {
                throw new AppError('Invalid or expired session. Please log in again.', 401);
            }

            req.user = {
                id: user.id,
                email: user.email,
            };

            // Set the auth context for Supabase RLS
            req.supabaseToken = token;

            next();
        } catch (err) {
            if (err instanceof AppError) {
                return next(err);
            }
            next(new AppError('Authentication failed', 401));
        }
    };
}

module.exports = { createAuthMiddleware };
