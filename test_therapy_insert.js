require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function testTherapyPatient() {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    // fetch an actual valid user_id
    const { data: users } = await supabase.from('users').select('id').limit(1);
    const userId = users && users.length > 0 ? users[0].id : '123e4567-e89b-12d3-a456-426614174000';

    const { data: data2, error: err2 } = await supabase
        .from('patients')
        .insert([{
            user_id: userId,
            name: 'Test Therapy',
            entity_type: 'Patient'
        }])
        .select();

    console.log("Therapy patient insert error:", err2);
    console.log("Therapy patient inserted:", data2);
}
testTherapyPatient();
