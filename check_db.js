require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function checkDb() {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    console.log('--- Checking patients table structure ---');
    const { data: info, error: infoError } = await supabase
        .rpc('get_table_info', { table_name: 'patients' }); // This might not exist, let's try a different way

    const { data, error } = await supabase
        .from('patients')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error selecting from patients:', error.message);
        if (error.message.includes('column "email" does not exist')) {
            console.log('CONFIRMED: Column "email" is missing.');
        }
    } else {
        console.log('Successfully queried patients table.');
        if (data && data.length > 0) {
            const keys = Object.keys(data[0]);
            console.log('Columns found:', keys.join(', '));
            if (!keys.includes('email')) console.log('MISSING: email column');
            if (!keys.includes('phone')) console.log('MISSING: phone column');
        } else {
            console.log('Patient table is empty, creating a dummy to check columns...');
            const { error: insError } = await supabase
                .from('patients')
                .insert([{ name: 'Test', email: 'test@example.com' }]);
            if (insError) {
                console.error('Insert failed:', insError.message);
            } else {
                console.log('Insert succeeded!');
            }
        }
    }
}

checkDb();
