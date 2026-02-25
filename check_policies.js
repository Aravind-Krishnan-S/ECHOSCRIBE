require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function checkPolicies() {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    try {
        const { data, error } = await supabase.rpc('query_pg_policies');
        if (error) throw error;
        console.log("Policies:", data);
    } catch (e) {
        console.log("RPC failed:", e.message);

        // Let's try direct SQL via PostgREST if we mapped `pg_policies`
        const { data, error } = await supabase.from('pg_policies').select('*');
        console.log(error || data);
    }
}
checkPolicies();
