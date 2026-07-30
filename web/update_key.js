const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function update() {
    const { data, error } = await supabase
        .from('ai_chatbot_settings')
        .update({ api_key: process.env.CHATBOT_API_KEY || '' })
        .eq('id', 1);
    
    if (error) console.error(error);
    else console.log("Success");
}

update();
