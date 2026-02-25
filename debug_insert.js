require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function test() {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    // We need to fetch an actual valid user_id to avoid FK errors masquerading as RLS
    const { data: users } = await supabase.from('users').select('id').limit(1);
    const userId = users && users.length > 0 ? users[0].id : '123e4567-e89b-12d3-a456-426614174000';

    const { data, error } = await supabase
        .from('patients')
        .insert([{
            user_id: userId,
            name: 'Test',
            entity_type: 'Mentee'
        }])
        .select();

    console.log("Error details:");
    console.dir(error, { depth: null });
}
test();
