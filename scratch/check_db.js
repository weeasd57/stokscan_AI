const { createClient } = require('@supabase/supabase-js');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const s = createClient(url, key);

(async () => {
  const { data } = await s.from('stock_prices').select('date,close').eq('symbol', 'ABUK').order('date', {ascending: false}).limit(5);
  console.log("ABUK Prices:", data);
  const { data: m } = await s.from('stock_prices').select('date,close').eq('symbol', 'COMI').order('date', {ascending: false}).limit(5);
  console.log("COMI Prices:", m);
})();
