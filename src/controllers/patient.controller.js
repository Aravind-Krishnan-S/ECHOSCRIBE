/* src/controllers/patient.controller.js */
const dbService = require('../services/db.service');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// Helper to enforce mode
const extractMode = (req) => {
    let mode = req.query.mode || req.body.mode;
    if (!mode) {
        throw new AppError("A valid 'mode' (Therapy or Mentoring) is required in the query or body for strict data isolation.", 400);
    }

    // Normalize case
    mode = mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase();

    if (mode !== 'Therapy' && mode !== 'Mentoring') {
        throw new AppError("Mode must be strictly 'Therapy' or 'Mentoring'.", 400);
    }
    return mode;
};

// GET /api/patients
const listPatients = asyncHandler(async (req, res) => {
    const mode = extractMode(req);
    const data = await dbService.getPatients(req.supabaseToken, req.user.id, mode);
    res.json(data);
});

// POST /api/patients
const createPatient = asyncHandler(async (req, res) => {
    const mode = extractMode(req);
    const { name, age, gender, notes, email, phone } = req.body;

    let data;
    try {
        data = await dbService.createPatient(req.supabaseToken, {
            userId: req.user.id,
            name,
            age: age !== undefined ? age : null,
            gender: gender || null,
            notes: notes || '',
            email: email || null,
            phone: phone || null,
            mode
        });
    } catch (err) {
        console.error('[Patient] Create failed:', err.message || err);
        throw new AppError(err.message || 'Database error while creating patient.', 500);
    }

    if (!data || data.length === 0) {
        throw new AppError('Patient was not created — the database returned no data. Check RLS policies.', 500);
    }

    res.status(201).json(data[0]);
});

// PUT /api/patients/:id
const updatePatient = asyncHandler(async (req, res) => {
    const mode = extractMode(req);
    const { id } = req.params;
    const { name, age, gender, notes, email, phone } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (age !== undefined) updates.age = age;
    if (gender !== undefined) updates.gender = gender;
    if (notes !== undefined) updates.notes = notes;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;

    const data = await dbService.updatePatient(req.supabaseToken, id, req.user.id, updates, mode);

    if (!data || data.length === 0) {
        throw new AppError('Patient not found in this mode.', 404);
    }

    res.json(data[0]);
});

// DELETE /api/patients/:id
const deletePatient = asyncHandler(async (req, res) => {
    const mode = extractMode(req);
    const { id } = req.params;
    await dbService.deletePatient(req.supabaseToken, id, req.user.id, mode);
    res.json({ success: true, message: 'Patient deleted.' });
});

// GET /api/patients/:id
const getPatient = asyncHandler(async (req, res) => {
    const mode = extractMode(req);
    const { id } = req.params;
    const data = await dbService.getPatientById(req.supabaseToken, id, req.user.id, mode);

    if (!data) {
        throw new AppError('Patient not found in this mode.', 404);
    }
    res.json(data);
});

// GET /api/patients/:id/sessions
const getPatientSessions = asyncHandler(async (req, res) => {
    const mode = extractMode(req);
    const { id } = req.params;
    const data = await dbService.getPatientSessions(req.supabaseToken, id, req.user.id, mode);
    res.json(data);
});

// GET /api/patients/:id/profile
const getPatientProfile = asyncHandler(async (req, res) => {
    const mode = extractMode(req);
    const { id } = req.params;
    const userId = req.user.id;

    // Fetch patient's sessions in this mode
    const sessions = await dbService.getPatientSessions(req.supabaseToken, id, userId, mode);

    if (!sessions || sessions.length === 0) {
        throw new AppError('No sessions found for this patient in ' + mode + ' mode. Record some sessions to generate a profile.', 404);
    }

    // Call aiService with the patient's specific sessions
    const aiService = require('../services/ai.service');
    const profile = await aiService.generateProfile(sessions);

    res.json(profile);
});

module.exports = {
    listPatients,
    createPatient,
    updatePatient,
    deletePatient,
    getPatientSessions,
    getPatient,
    getPatientProfile
};
