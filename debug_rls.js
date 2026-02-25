require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function debugRLS() {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    const email = `testuser_${Date.now()}@gmail.com`;
    const password = "Password123!";

    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email, password
    });

    if (signUpErr) {
        console.error("Signup failed:", signUpErr.message);
        return;
    }

    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email, password
    });

    if (signInErr) {
        console.error("SignIn failed:", signInErr.message);
        return;
    }

    const token = signInData.session.access_token;
    const userId = signInData.user.id;
    console.log("Logged in UID:", userId);

    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { data: res1, error: err1 } = await client.from('patients').insert([{
        user_id: userId,
        name: "Test Mentee",
        entity_type: "Mentee"
    }]);

    console.log("Insert Response Error:", err1);

    if (err1) {
        // Let's test a plain Patient insert to see if ONLY Mentee fails
        const { data: res2, error: err2 } = await client.from('patients').insert([{
            user_id: userId,
            name: "Test Patient",
            entity_type: "Patient"
        }]);
        console.log("Patient Insert Error:", err2);
    }
}
debugRLS();
