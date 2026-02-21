const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'EchoScribe API',
            version: '2.0.0',
            description: 'AI-powered clinical documentation platform API',
            contact: {
                name: 'EchoScribe',
            },
        },
        servers: [
            { url: '/api', description: 'API Base' },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
            schemas: {
                SOAPNote: {
                    type: 'object',
                    properties: {
                        soap: {
                            type: 'object',
                            properties: {
                                subjective: { type: 'string' },
                                objective: { type: 'string' },
                                assessment: { type: 'string' },
                                plan: { type: 'string' },
                            },
                        },
                        risk_assessment: {
                            type: 'object',
                            properties: {
                                suicidal_ideation: { type: 'boolean' },
                                self_harm_risk: { type: 'string', enum: ['low', 'moderate', 'high'] },
                                notes: { type: 'string' },
                            },
                        },
                        diagnostic_impressions: { type: 'array', items: { type: 'string' } },
                        interventions_used: { type: 'array', items: { type: 'string' } },
                        medication_changes: { type: 'array', items: { type: 'string' } },
                        progress_indicators: { type: 'array', items: { type: 'string' } },
                        emotional_tone: { type: 'string' },
                        topics: { type: 'array', items: { type: 'string' } },
                        confidence_score: { type: 'number', minimum: 0, maximum: 1 },
                    },
                },
                ClientProfile: {
                    type: 'object',
                    properties: {
                        journey_summary: { type: 'string' },
                        recurring_themes: { type: 'array', items: { type: 'string' } },
                        emotional_trend: { type: 'string', enum: ['improving', 'stable', 'declining'] },
                        risk_trend: { type: 'string' },
                        recommended_focus: { type: 'array', items: { type: 'string' } },
                        treatment_effectiveness_score: { type: 'number', minimum: 0, maximum: 100 },
                    },
                },
            },
        },
        paths: {
            '/auth/signup': {
                post: {
                    tags: ['Authentication'],
                    summary: 'Create a new account',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['email', 'password'],
                                    properties: {
                                        email: { type: 'string', format: 'email' },
                                        password: { type: 'string', minLength: 6 },
                                    },
                                },
                            },
                        },
                    },
                    responses: { 201: { description: 'Account created' }, 400: { description: 'Validation error' } },
                },
            },
            '/auth/login': {
                post: {
                    tags: ['Authentication'],
                    summary: 'Log in with email and password',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['email', 'password'],
                                    properties: {
                                        email: { type: 'string', format: 'email' },
                                        password: { type: 'string' },
                                    },
                                },
                            },
                        },
                    },
                    responses: { 200: { description: 'Login successful' }, 401: { description: 'Invalid credentials' } },
                },
            },
            '/summarize': {
                post: {
                    tags: ['Sessions'],
                    summary: 'Analyze transcript and generate SOAP note',
                    security: [{ bearerAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['text'],
                                    properties: { text: { type: 'string' } },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'SOAP note generated', content: { 'application/json': { schema: { $ref: '#/components/schemas/SOAPNote' } } } },
                        401: { description: 'Unauthorized' },
                    },
                },
            },
            '/profile': {
                get: {
                    tags: ['Profile'],
                    summary: 'Generate longitudinal client profile',
                    security: [{ bearerAuth: [] }],
                    responses: {
                        200: { description: 'Profile analysis', content: { 'application/json': { schema: { $ref: '#/components/schemas/ClientProfile' } } } },
                        401: { description: 'Unauthorized' },
                        404: { description: 'No sessions found' },
                    },
                },
            },
            '/export/pdf/{sessionId}': {
                get: {
                    tags: ['Export'],
                    summary: 'Export session as PDF',
                    security: [{ bearerAuth: [] }],
                    parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
                    responses: { 200: { description: 'PDF file' }, 404: { description: 'Session not found' } },
                },
            },
            '/export/csv': {
                get: {
                    tags: ['Export'],
                    summary: 'Export all sessions as CSV',
                    security: [{ bearerAuth: [] }],
                    responses: { 200: { description: 'CSV file' } },
                },
            },
        },
    },
    apis: [],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = { swaggerSpec };
