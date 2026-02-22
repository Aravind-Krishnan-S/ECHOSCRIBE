require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function checkDb() {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    console.log('--- Checking all tables ---');
    const { data: tables, error: tableError } = await supabase
        .from('patients') // Just to trigger a schema fetch
        .select('id')
        .limit(1);

    if (tableError) {
        console.error('API Error:', tableError.message);
    } else {
        console.log('API successfully reached patients table.');
    }
}

checkDb();
