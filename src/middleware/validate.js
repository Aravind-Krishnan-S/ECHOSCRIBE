const { AppError } = require('./errorHandler');

function validate(schema, source = 'body') {
    return (req, res, next) => {
        const result = schema.safeParse(req[source]);

        if (!result.success) {
            const messages = result.error.issues.map(
                (i) => `${i.path.join('.')}: ${i.message}`
            );
            throw new AppError('Validation failed', 400, messages);
        }

        req[source] = result.data;
        next();
    };
}

module.exports = { validate };
