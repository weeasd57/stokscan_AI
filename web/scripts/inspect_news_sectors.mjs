import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envFile = fs.readFileSync('.env.local', 'utf8');
const urlMatch = envFile.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);
const keyMatch = envFile.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/);

if (urlMatch && keyMatch) {
    const supabase = createClient(urlMatch[1].trim(), keyMatch[1].trim());
    
    // Fetch news sentiment rows
    const { data: newsRows } = await supabase
        .from("stock_news_sentiment")
        .select("*")
        .limit(10);

    console.log("Sample news rows:", newsRows);
}
