import re

with open('web/src/lib/ai/tools-v2.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# We need to replace the entire get_news block.
# Let's find the start of get_news block:
start_idx = content.find('// ===== NEWS =====')
# Let's find the end of get_news block, which is right before // ===== RECOMMENDATIONS / SIGNALS =====
end_idx = content.find('// ===== RECOMMENDATIONS / SIGNALS =====')

if start_idx != -1 and end_idx != -1:
    new_block = '''    // ===== NEWS =====
    if (plan.tools.includes("get_news")) {
        try {
            if (plan.intent === "stock_news" && symbols.length === 0) {
                results.push({ tool: "get_news", source: "empty", data_time: requestedDate || now, symbols: [], data_type: requestedDate ? "historical" : "live", data: [] });
                return { results, formattedText: "[أخبار السهم]: لم يتم تحديد سهم، لذلك لم أجلب أخبار السوق العامة." };
            }
            
            const lookbackDate = requestedStartDate ? new Date(f"{requestedStartDate}T00:00:00Z") : requestedDate ? new Date(f"{requestedDate}T00:00:00Z") : new Date();
            if (!requestedStartDate) lookbackDate.setDate(lookbackDate.getDate() - AI_CONFIG.tools.newsDaysLookback);
            const lookbackDateStr = lookbackDate.toISOString().split("T")[0];
            const articleRows: any[] = [];
            
            let newsQuery = supabase
                .from("stock_news_sentiment")
                .select("symbol, date, sentiment_score, news_count, headlines")
                .eq("exchange", AI_CONFIG.tools.defaultExchange)
                .gte("date", lookbackDateStr)
                .gt("news_count", 0)
                .order("date", { ascending: false })
                .limit(AI_CONFIG.tools.newsLimit);

            if (symbols.length > 0) {
                newsQuery = newsQuery.or(symbols.map(s => f"symbol.ilike.{s}").join(","));
            }

            if (requestedDate) newsQuery = newsQuery.eq("date", requestedDate);
            if (requestedStartDate && requestedEndDate) newsQuery = newsQuery.gte("date", requestedStartDate).lte("date", requestedEndDate);
            const { data: newsData } = await newsQuery;

            if (newsData && newsData.length > 0) {
                const newsPeriodLabel = requestedStartDate && requestedEndDate
                    ? f"الفترة من {requestedStartDate} إلى {requestedEndDate}"
                    : f"آخر {AI_CONFIG.tools.newsDaysLookback} أيام";
                textParts.push(f"\\n [أخبار وتحليلات المعنويات للأسهم - {newsPeriodLabel}]:\\n");
                const newsByDate = new Map<string, any[]>();
                newsData.forEach((item: any) => {
                    const dateKey = item.date || now.split("T")[0];
                    if (!newsByDate.has(dateKey)) {
                        newsByDate.set(dateKey, []);
                    }
                    newsByDate.get(dateKey)!.push(item);
                });

                const sortedDates = Array.from(newsByDate.keys()).sort().reverse();
                sortedDates.forEach((date) => {
                    textParts.push(f" تاريخ: {date}");
                    const items = newsByDate.get(date) || [];
                    items.slice(0, AI_CONFIG.tools.newsHeadlinesMaxPerDay).forEach((item: any) => {
                        const sentiment = item.sentiment_score > 0.15 ? "إيجابي" :
                            item.sentiment_score < -0.15 ? "سلبي" : "محايد";
                        const scorePercent = ((item.sentiment_score || 0) * 100).toFixed(1);
                        textParts.push(f"  • {item.symbol}: معنويات = {sentiment} ({scorePercent}%) | عدد الأخبار: {item.news_count || 0}");
                        
                        if (Array.isArray(item.headlines) && item.headlines.length > 0) {
                            item.headlines.forEach((hl: string) => {
                                textParts.push(f"    - {hl}");
                            });
                        }
                    });
                });
            }

            results.push({
                tool: "get_news",
                source: "database",
                data_time: requestedDate || requestedEndDate || now,
                symbols,
                data_type: requestedDate || requestedStartDate ? "historical" : "live",
                data: [...articleRows, ...(newsData || [])]
            });
        } catch (e) {
            console.warn("Error fetching news:", e);
        }
    }

    '''
    
    # We must escape javascript template literals f"..." back to ...
    new_block = new_block.replace('f"', '').replace('"', '"')
    
    with open('web/src/lib/ai/tools-v2.ts', 'w', encoding='utf-8') as f:
        f.write(content[:start_idx] + new_block + content[end_idx:])
    print("Successfully replaced get_news block.")
else:
    print("Could not find start or end block for get_news.")
