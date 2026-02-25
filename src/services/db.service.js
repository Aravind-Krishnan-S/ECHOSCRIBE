/* src/services/db.service.js */
const { createClient } = require('@supabase/supabase-js');

let supabase = null;

function initSupabase(url, key) {
    supabase = createClient(url, key);
    return supabase;
}

function getSupabase() {
    if (!supabase) {
        throw new Error('Supabase not initialized. Call initSupabase() first.');
    }
    return supabase;
}

// Create an authenticated client for RLS-protected operations
function getAuthClient(token) {
    const { SUPABASE_URL, SUPABASE_KEY } = process.env;
    return createClient(SUPABASE_URL, SUPABASE_KEY, {
        global: {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        },
    });
}

// --- Storage Operations ---

async function uploadAudioToStorage(token, userId, audioBuffer, filename) {
    const client = getAuthClient(token);

    // Upload directly to the user's personal folder for organization
    const filePath = `${userId}/${Date.now()}_${filename}`;

    const { data, error } = await client.storage
        .from('session-audio')
        .upload(filePath, audioBuffer, {
            contentType: 'audio/webm',
            upsert: false
        });

    if (error) {
        console.error('[Supabase Storage] Upload error:', error);
        throw error;
    }

    // Get public URL
    const { data: urlData } = client.storage
        .from('session-audio')
        .getPublicUrl(filePath);

    return urlData.publicUrl;
}

// --- Session Operations ---

async function saveSession(token, { userId, transcript, summary, analysisJson, patientId, audioUrl, sessionMode }) {
    if (!sessionMode || (sessionMode !== 'Therapy' && sessionMode !== 'Mentoring')) {
        throw new Error("Strict Mode Isolation: 'sessionMode' must be explicitly 'Therapy' or 'Mentoring'.");
    }

    const client = getAuthClient(token);
    const row = {
        user_id: userId,
        transcript,
        summary,
        analysis_json: analysisJson,
        session_mode: sessionMode // strictly enforce this column insertion
    };
    if (patientId) row.patient_id = patientId;
    if (audioUrl) row.audio_url = audioUrl;

    const { data, error } = await client
        .from('sessions')
        .insert([row])
        .select();

    if (error) throw error;
    return data;
}

async function getHistory(token, userId, mode) {
    if (!mode) throw new Error("Strict Mode Isolation: 'mode' is required.");
    const client = getAuthClient(token);
    const { data, error } = await client
        .from('sessions')
        .select('*')
        .eq('user_id', userId)
        .eq('session_mode', mode) // strict boundary
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

async function getSessionById(token, sessionId, userId, mode) {
    if (!mode) throw new Error("Strict Mode Isolation: 'mode' is required.");
    const client = getAuthClient(token);
    const { data, error } = await client
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .eq('session_mode', mode) // strict boundary
        .single();

    if (error) throw error;
    return data;
}

async function getRecentSessions(token, userId, mode, limit = 20) {
    if (!mode) throw new Error("Strict Mode Isolation: 'mode' is required.");
    const client = getAuthClient(token);
    const { data, error } = await client
        .from('sessions')
        .select('analysis_json, created_at')
        .eq('user_id', userId)
        .eq('session_mode', mode) // strict boundary
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) throw error;
    return data;
}

// --- Patient Operations ---

async function getPatients(token, userId, mode) {
    if (!mode) throw new Error("Strict Mode Isolation: 'mode' is required.");
    const entityType = mode === 'Therapy' ? 'Patient' : 'Mentee';

    const client = getAuthClient(token);
    const { data, error } = await client
        .from('patients')
        .select('*')
        .eq('user_id', userId)
        .eq('entity_type', entityType) // strict boundary
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

async function createPatient(token, { userId, name, age, gender, notes, email, phone, mode }) {
    if (!mode) throw new Error("Strict Mode Isolation: 'mode' is required.");
    const entityType = mode === 'Therapy' ? 'Patient' : 'Mentee';

    const client = getAuthClient(token);
    const { data, error } = await client
        .from('patients')
        .insert([{
            user_id: userId,
            name,
            age,
            gender,
            notes,
            email,
            phone,
            entity_type: entityType // strictly set based on mode parameter
        }])
        .select();

    if (error) throw error;
    return data;
}

async function updatePatient(token, patientId, userId, updates, mode) {
    if (!mode) throw new Error("Strict Mode Isolation: 'mode' is required.");
    const entityType = mode === 'Therapy' ? 'Patient' : 'Mentee';

    const client = getAuthClient(token);
    const { data, error } = await client
        .from('patients')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', patientId)
        .eq('user_id', userId)
        .eq('entity_type', entityType) // strictly enforce mode checking for safety
        .select();

    if (error) throw error;
    return data;
}

async function deletePatient(token, patientId, userId, mode) {
    if (!mode) throw new Error("Strict Mode Isolation: 'mode' is required.");
    const entityType = mode === 'Therapy' ? 'Patient' : 'Mentee';

    const client = getAuthClient(token);
    const { error } = await client
        .from('patients')
        .delete()
        .eq('id', patientId)
        .eq('user_id', userId)
        .eq('entity_type', entityType); // strictly enforce safety

    if (error) throw error;
    return true;
}

async function getPatientSessions(token, patientId, userId, mode) {
    if (!mode) throw new Error("Strict Mode Isolation: 'mode' is required.");
    const client = getAuthClient(token);
    const { data, error } = await client
        .from('sessions')
        .select('*')
        .eq('patient_id', patientId)
        .eq('user_id', userId)
        .eq('session_mode', mode) // strict boundary
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

async function getPatientById(token, patientId, userId, mode) {
    if (!mode) throw new Error("Strict Mode Isolation: 'mode' is required.");
    const entityType = mode === 'Therapy' ? 'Patient' : 'Mentee';

    const client = getAuthClient(token);
    const { data, error } = await client
        .from('patients')
        .select('*')
        .eq('id', patientId)
        .eq('user_id', userId)
        .eq('entity_type', entityType) // strict boundary
        .single();

    if (error) throw error;
    return data;
}

module.exports = {
    initSupabase,
    getSupabase,
    getAuthClient,
    saveSession,
    uploadAudioToStorage,
    getHistory,
    getSessionById,
    getRecentSessions,
    getPatients,
    createPatient,
    updatePatient,
    deletePatient,
    getPatientSessions,
    getPatientById
};
