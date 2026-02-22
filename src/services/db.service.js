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

// --- Session Operations ---

async function saveSession(token, { userId, transcript, summary, analysisJson, patientId }) {
    const client = getAuthClient(token);
    const row = {
        user_id: userId,
        transcript,
        summary,
        analysis_json: analysisJson,
    };
    if (patientId) row.patient_id = patientId;
    const { data, error } = await client
        .from('sessions')
        .insert([row])
        .select();

    if (error) throw error;
    return data;
}

async function getHistory(token, userId) {
    const client = getAuthClient(token);
    const { data, error } = await client
        .from('sessions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

async function getSessionById(token, sessionId, userId) {
    const client = getAuthClient(token);
    const { data, error } = await client
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .single();

    if (error) throw error;
    return data;
}

async function getRecentSessions(token, userId, limit = 20) {
    const client = getAuthClient(token);
    const { data, error } = await client
        .from('sessions')
        .select('analysis_json, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) throw error;
    return data;
}

// --- Patient Operations ---

async function getPatients(token, userId) {
    const client = getAuthClient(token);
    const { data, error } = await client
        .from('patients')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

async function createPatient(token, { userId, name, age, gender, notes }) {
    const client = getAuthClient(token);
    const { data, error } = await client
        .from('patients')
        .insert([{ user_id: userId, name, age, gender, notes }])
        .select();

    if (error) throw error;
    return data;
}

async function updatePatient(token, patientId, userId, updates) {
    const client = getAuthClient(token);
    const { data, error } = await client
        .from('patients')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', patientId)
        .eq('user_id', userId)
        .select();

    if (error) throw error;
    return data;
}

async function deletePatient(token, patientId, userId) {
    const client = getAuthClient(token);
    const { error } = await client
        .from('patients')
        .delete()
        .eq('id', patientId)
        .eq('user_id', userId);

    if (error) throw error;
    return true;
}

async function getPatientSessions(token, patientId, userId) {
    const client = getAuthClient(token);
    const { data, error } = await client
        .from('sessions')
        .select('*')
        .eq('patient_id', patientId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

async function getPatientById(token, patientId, userId) {
    const client = getAuthClient(token);
    const { data, error } = await client
        .from('patients')
        .select('*')
        .eq('id', patientId)
        .eq('user_id', userId)
        .single();

    if (error) throw error;
    return data;
}

module.exports = {
    initSupabase,
    getSupabase,
    getAuthClient,
    saveSession,
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

