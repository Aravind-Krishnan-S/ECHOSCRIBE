/* src/routes/api.routes.js */
const express = require('express');
const { z } = require('zod');
const multer = require('multer');
const path = require('path');
const os = require('os');
const { validate } = require('../middleware/validate');
const sessionController = require('../controllers/session.controller');
const profileController = require('../controllers/profile.controller');
const exportController = require('../controllers/export.controller');
const patientController = require('../controllers/patient.controller');
const transcribeController = require('../controllers/transcribe.controller');
const commsController = require('../controllers/communications.controller');

const router = express.Router();

// Multer config for audio uploads — preserve file extension for Groq Whisper
const uploadDir = path.join(os.tmpdir(), 'echoscribe-uploads');
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const fs = require('fs');
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Preserve original extension so Groq recognizes the file type
        const ext = path.extname(file.originalname) || '.webm';
        const uniqueName = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        cb(null, uniqueName);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
});

// All routes here require authentication (middleware applied in index.js)

// Validation schemas with strict mode requirements
const summarizeSchema = z.object({
    text: z.string().min(1, 'Transcript text is required').max(50000, 'Transcript too long'),
    patientId: z.string().uuid().optional(),
    language: z.string().optional().default('en'),
    mode: z.enum(['Therapy', 'Mentoring'])
});

const saveSessionSchema = z.object({
    transcript: z.string().min(1, 'Transcript is required'),
    summary: z.string().optional().default(''),
    analysisJson: z.object({}).passthrough(),
    patientId: z.string().uuid().optional(),
    mode: z.enum(['Therapy', 'Mentoring'])
});

const createPatientSchema = z.object({
    name: z.string().min(1, 'Patient name is required').max(200),
    age: z.number().int().min(0).max(150).optional().nullable(),
    gender: z.string().max(50).optional().nullable(),
    notes: z.string().max(5000).optional().default(''),
    email: z.string().email('Invalid email format').optional().nullable().or(z.literal('')),
    phone: z.string().max(30).optional().nullable().or(z.literal('')),
    mode: z.enum(['Therapy', 'Mentoring'])
});

const updatePatientSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    age: z.number().int().min(0).max(150).optional().nullable(),
    gender: z.string().max(50).optional().nullable(),
    notes: z.string().max(5000).optional(),
    email: z.string().email('Invalid email format').optional().nullable().or(z.literal('')),
    phone: z.string().max(30).optional().nullable().or(z.literal('')),
    mode: z.enum(['Therapy', 'Mentoring'])
});

// Middleware for requiring mode in query for GET routes
const validateModeQuery = (req, res, next) => {
    if (req.query && req.query.mode && typeof req.query.mode === 'string') {
        req.query.mode = req.query.mode.charAt(0).toUpperCase() + req.query.mode.slice(1).toLowerCase();
    }

    const schema = z.object({ mode: z.enum(['Therapy', 'Mentoring']) });
    const result = schema.safeParse(req.query);
    if (!result.success) {
        return res.status(400).json({
            status: 'error',
            error: "Strict Data Isolation: 'mode' query parameter is required and must be either 'Therapy' or 'Mentoring'."
        });
    }
    next();
};

// --- Session Routes ---

// We transition these to accept multipart/form-data (audio blob + text fields)
router.post('/summarize', upload.single('audio'), sessionController.summarize);
router.post('/session', upload.single('audio'), sessionController.saveSession);

router.get('/history', validateModeQuery, sessionController.getHistory);

// --- Transcription Routes ---
router.post('/transcribe-audio', upload.single('audio'), transcribeController.transcribe);
router.post('/identify-speakers', transcribeController.identifySpeakers);
router.post('/diarize-transcript', transcribeController.diarize);

// --- Patient Routes ---
router.get('/patients', validateModeQuery, patientController.listPatients);
router.post('/patients', validate(createPatientSchema), patientController.createPatient);
router.put('/patients/:id', validate(updatePatientSchema), patientController.updatePatient);
router.delete('/patients/:id', validateModeQuery, patientController.deletePatient);
router.get('/patients/:id/sessions', validateModeQuery, patientController.getPatientSessions);
router.get('/patients/:id', validateModeQuery, patientController.getPatient);
router.get('/patients/:id/profile', validateModeQuery, patientController.getPatientProfile);

// --- Profile Routes ---
router.get('/profile', validateModeQuery, profileController.getProfile);

// --- Export Routes ---
router.get('/export/pdf/:sessionId', exportController.exportPdf);
router.get('/export/csv', exportController.exportCsv);
router.get('/export/record', exportController.exportFullRecord);

// --- Communications Routes ---
router.post('/communications/send', commsController.sendCommunication);

module.exports = router;
