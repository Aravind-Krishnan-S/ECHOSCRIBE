const dbService = require('../services/db.service');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// GET /api/patients
const listPatients = asyncHandler(async (req, res) => {
    const data = await dbService.getPatients(req.supabaseToken, req.user.id);
    res.json(data);
});

// POST /api/patients
const createPatient = asyncHandler(async (req, res) => {
    const { name, age, gender, notes } = req.body;

    const data = await dbService.createPatient(req.supabaseToken, {
        userId: req.user.id,
        name,
        age: age || null,
        gender: gender || null,
        notes: notes || '',
    });

    res.status(201).json(data[0]);
});

// PUT /api/patients/:id
const updatePatient = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, age, gender, notes } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (age !== undefined) updates.age = age;
    if (gender !== undefined) updates.gender = gender;
    if (notes !== undefined) updates.notes = notes;

    const data = await dbService.updatePatient(req.supabaseToken, id, req.user.id, updates);

    if (!data || data.length === 0) {
        throw new AppError('Patient not found.', 404);
    }

    res.json(data[0]);
});

// DELETE /api/patients/:id
const deletePatient = asyncHandler(async (req, res) => {
    const { id } = req.params;
    await dbService.deletePatient(req.supabaseToken, id, req.user.id);
    res.json({ success: true, message: 'Patient deleted.' });
});

// GET /api/patients/:id/sessions
const getPatientSessions = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const data = await dbService.getPatientSessions(req.supabaseToken, id, req.user.id);
    res.json(data);
});

module.exports = { listPatients, createPatient, updatePatient, deletePatient, getPatientSessions };
