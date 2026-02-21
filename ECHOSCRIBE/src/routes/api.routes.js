const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const sessionController = require('../controllers/session.controller');
const profileController = require('../controllers/profile.controller');
const exportController = require('../controllers/export.controller');
const patientController = require('../controllers/patient.controller');

const router = express.Router();

// All routes here require authentication (middleware applied in index.js)

// Validation schemas
const summarizeSchema = z.object({
    text: z.string().min(1, 'Transcript text is required').max(50000, 'Transcript too long'),
    patientId: z.string().uuid().optional(),
});

const saveSessionSchema = z.object({
    transcript: z.string().min(1, 'Transcript is required'),
    summary: z.string().optional().default(''),
    analysisJson: z.object({}).passthrough(),
    patientId: z.string().uuid().optional(),
});

const createPatientSchema = z.object({
    name: z.string().min(1, 'Patient name is required').max(200),
    age: z.number().int().min(0).max(150).optional().nullable(),
    gender: z.string().max(50).optional().nullable(),
    notes: z.string().max(5000).optional().default(''),
});

const updatePatientSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    age: z.number().int().min(0).max(150).optional().nullable(),
    gender: z.string().max(50).optional().nullable(),
    notes: z.string().max(5000).optional(),
});

// --- Session Routes ---
router.post('/summarize', validate(summarizeSchema), sessionController.summarize);
router.post('/session', validate(saveSessionSchema), sessionController.saveSession);
router.get('/history', sessionController.getHistory);

// --- Patient Routes ---
router.get('/patients', patientController.listPatients);
router.post('/patients', validate(createPatientSchema), patientController.createPatient);
router.put('/patients/:id', validate(updatePatientSchema), patientController.updatePatient);
router.delete('/patients/:id', patientController.deletePatient);
router.get('/patients/:id/sessions', patientController.getPatientSessions);

// --- Profile Routes ---
router.get('/profile', profileController.getProfile);

// --- Export Routes ---
router.get('/export/pdf/:sessionId', exportController.exportPdf);
router.get('/export/csv', exportController.exportCsv);
router.get('/export/record', exportController.exportFullRecord);

module.exports = router;

