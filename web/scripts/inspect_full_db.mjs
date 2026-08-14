import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envFile = fs.readFileSync('.env.local', 'utf8');
const urlMatch = envFile.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);
const keyMatch = envFile.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);

if (urlMatch && keyMatch) {
    const supabase = createClient(urlMatch[1].trim(), keyMatch[1].trim());
    
    // Fetch all stock_news_sentiment
    const { data: newsRows, error } = await supabase
        .from("stock_news_sentiment")
        .select("symbol, sentiment_score, news_count, date");

    if (error) {
        console.log("Error:", error);
    } else {
        console.log("Total rows found in stock_news_sentiment:", newsRows?.length || 0);
        if (newsRows && newsRows.length > 0) {
            const uniqueSymbols = [...new Set(newsRows.map(r => r.symbol.toUpperCase()))];
            console.log("Unique symbols in table:", uniqueSymbols);
            
            // Fetch fundamentals for these symbols
            const { data: fundRows } = await supabase
                .from("stock_fundamentals")
                .select("symbol, data")
                .in("symbol", uniqueSymbols);
                
            const symbolToSector = {};
            (fundRows || []).forEach(r => {
                let sector = "Other";
                try {
                    const parsed = typeof r.data === "string" ? JSON.parse(r.data) : r.data || {};
                    sector = parsed.sector || parsed.Sector || parsed.sector_ar || parsed.SectorAr || parsed.industry || parsed.Industry || "Other";
                } catch {}
                symbolToSector[r.symbol.toUpperCase()] = sector;
            });
            
            const sectorCounts = {};
            newsRows.forEach(row => {
                const sym = row.symbol.toUpperCase();
                const sector = symbolToSector[sym] || "Missing / Not Found in fundamentals";
                sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
            });
            
            console.log("\nSector Distribution for news rows:");
            console.log(sectorCounts);
        }
    }
}
