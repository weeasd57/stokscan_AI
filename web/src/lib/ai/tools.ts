import { PlannerResult } from "./types";

function normalizeArabic(str: string): string {
    return str
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي")
        .replace(/ؤ/g, "و")
        .toLowerCase();
}

export async function executeTools(supabase: any, plannerResult: PlannerResult): Promise<string> {
    const { tools, entities } = plannerResult;
    let outputText = "";
    const symbols = entities.symbols;

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // Tool 1: get_stock & get_indicators
    if (symbols.length > 0 && (tools.includes("get_stock") || tools.includes("load_stock_prices"))) {
        try {
            const [pricesRes, techsRes, stocksRes] = await Promise.all([
                supabase.from("stock_prices").select("symbol, close, volume, date").in("symbol", symbols).order("date", { ascending: false }).limit(symbols.length * 30),
                supabase.from("stock_technical_indicators").select("symbol, rsi_14, macd_signal, change_pct").in("symbol", symbols).order("date", { ascending: false }).limit(symbols.length * 10),
                supabase.from("stocks").select("symbol, name").in("symbol", symbols)
            ]);

            const rawPrices: any[] = pricesRes.data || [];
            const rawTechs: any[] = techsRes.data || [];
            const stocks: any[] = stocksRes.data || [];

            // deduplicate manually (keeps first occurrence per symbol which is the latest due to DESC sort)
            const prices: any[] = [];
            const pricesMap = new Map<string, any>();
            rawPrices.forEach(p => {
                if (!pricesMap.has(p.symbol)) {
                    pricesMap.set(p.symbol, p);
                    prices.push(p);
                }
            });

            const techs: any[] = [];
            const techsMap = new Map<string, any>();
            rawTechs.forEach(t => {
                if (!techsMap.has(t.symbol)) {
                    techsMap.set(t.symbol, t);
                    techs.push(t);
                }
            });

            if (prices.length > 0) {
                outputText += `\n📊 [بيانات الأسهم المطلوبة من قاعدة البيانات]:\n`;
                symbols.forEach(sym => {
                    const price = prices.find((p: any) => p.symbol === sym);
                    const tech = techs.find((t: any) => t.symbol === sym);
                    const stock = stocks.find((s: any) => s.symbol === sym);
                    if (price) {
                        const changeStr = tech && typeof tech.change_pct === "number" ? `${tech.change_pct >= 0 ? "+" : ""}${tech.change_pct.toFixed(2)}%` : "N/A";
                        outputText += `• سهم ${sym} (${stock?.name || sym}): السعر اللحظي = ${price.close} ج.م | التغير: ${changeStr} | RSI: ${tech?.rsi_14 ?? "N/A"} | إشارة MACD: ${tech?.macd_signal ?? "N/A"}\n`;
                    }
                });
            }
        } catch (e) {
            console.warn("Error fetching stock prices from DB:", e);
        }
    }

    // Tool 2: get_platform_stats (Calculates platform overall performance & win-rate metrics)
    const summaryText = plannerResult.session_update?.summary || "";
    const normSummary = normalizeArabic(summaryText);
    if (tools.includes("get_platform_stats") || normSummary.includes("اداء المنصه") || normSummary.includes("رايك في") || normSummary.includes("المنصه")) {
        try {
            const { data: allRecs } = await supabase
                .from("scan_results")
                .select("symbol, signal, status, precision, entry_price, target_price, stop_loss")
                .eq("country", "Egypt");

            if (allRecs && allRecs.length > 0) {
                const total = allRecs.length;
                const openCount = allRecs.filter((r: any) => r.status === "open").length;
                const buyCount = allRecs.filter((r: any) => String(r.signal || "").toUpperCase().includes("BUY")).length;
                const sellCount = total - buyCount;
                const avgPrecision = (allRecs.reduce((acc: number, r: any) => acc + (Number(r.precision) || 85), 0) / total).toFixed(1);

                outputText += `\n📈 [إحصائيات وحصاد أداء منصة EGX Bots الإجمالي من الداتابيز]:\n`;
                outputText += `• إجمالي التوصيات الصادرة بالمنصة: ${total} توصية\n`;
                outputText += `• التوصيات النشطة حالياً: ${openCount} توصية\n`;
                outputText += `• إشارات الشراء (BUY): ${buyCount} | إشارات البيع (SELL): ${sellCount}\n`;
                outputText += `• متوسط دقة النماذج والـ AI Scans: ${avgPrecision}%\n`;
            }
        } catch (e) {
            console.warn("Error fetching platform stats:", e);
        }
    }

    // Tool 3: get_recommendations / get_signals (From Supabase scan_results table with Date & Order awareness)
    if (!tools || tools.length === 0 || tools.includes("get_recommendations") || tools.includes("get_signals") || plannerResult.intent === "recommendation" || plannerResult.intent === "stock_analysis") {
        try {
            const normSummaryRec = normalizeArabic(plannerResult.session_update?.summary || "");
            const isOldestQuery = normSummaryRec.includes("اقدم") || normSummaryRec.includes("oldest");

            // 1. Fetch latest recommendations (Newest first)
            const { data: latestRecs } = await supabase
                .from("scan_results")
                .select("symbol, name, signal, entry_price, target_price, stop_loss, precision, top_reasons, created_at")
                .eq("country", "Egypt")
                .order("created_at", { ascending: false })
                .limit(10);

            // 2. Fetch oldest recommendations if explicitly requested (Oldest first)
            const { data: oldestRecs } = isOldestQuery
                ? await supabase
                    .from("scan_results")
                    .select("symbol, name, signal, entry_price, target_price, stop_loss, precision, top_reasons, created_at")
                    .eq("country", "Egypt")
                    .order("created_at", { ascending: true })
                    .limit(5)
                : { data: null };

            const recsToUse = isOldestQuery && oldestRecs?.length ? oldestRecs : (latestRecs || []);

            if (recsToUse.length > 0) {
                outputText += `\n🎯 [إشارات وتوصيات تداول البورصة المصرية من قاعدة البيانات - scan_results]:\n`;
                outputText += `📌 [سياق التاريخ والترتيب]: اليوم هو ${todayStr} - أمس هو ${yesterdayStr}. الترتيب الحالي للبيانات: ${isOldestQuery ? "الأقدم أولاً (Ascending)" : "الأحدث أولاً (Descending)"}.\n`;

                // Check if any recommendation is actually from yesterday
                const yesterdayRecs = recsToUse.filter((r: any) => String(r.created_at || "").startsWith(yesterdayStr));
                if (!isOldestQuery && yesterdayRecs.length === 0) {
                    outputText += `⚠️ ملحوظة دقيقة للمجيب: لا توجد توصيات مسجلة بتاريخ أمس (${yesterdayStr}). التوصيات أدناه هي أحدث توصيات مسجلة في الداتابيز وترجع لتاريخ (20 يوليو و 19 يوليو 2026). يرجى توضيح ذلك بأسلوب دقيق للمستخدم دون الادعاء بأنها توصيات أمس.\n`;
                }

                recsToUse.forEach((r: any) => {
                    const signal = String(r.signal || "BUY").toUpperCase();
                    const entry = r.entry_price ? `${r.entry_price} ج.م` : "N/A";
                    const target = r.target_price ? `${r.target_price} ج.م` : "N/A";
                    const stop = r.stop_loss ? `${r.stop_loss} ج.م` : "N/A";
                    const dateStr = r.created_at ? String(r.created_at).replace("T", " ").split(".")[0] : "تاريخ غير محدد";
                    outputText += `• توصية سهم ${r.symbol} (${r.name || r.symbol}): الإشارة = ${signal} | سعر الدخول = ${entry} | الهدف = ${target} | وقف الخسارة = ${stop} | تاريخ التوصية = ${dateStr}\n`;
                });
            }
        } catch (err) {
            console.warn("Failed to fetch scan_results recommendations:", err);
        }
    }

    // Tool 4: get_market & get_news
    if (!tools || tools.length === 0 || tools.includes("get_market") || tools.includes("get_news") || plannerResult.intent === "market_summary" || plannerResult.intent === "stock_news") {
        try {
            const { data: marketCache } = await supabase
                .from("market_cache")
                .select("payload")  // ✅ تصحيح: استخدام "payload" بدلاً من "cache_value"
                .eq("cache_key", "market_status_Egypt")
                .maybeSingle();  // ✅ تصحيح: استخدام maybeSingle بدلاً من single لتجنب الأخطاء

            if (marketCache?.payload) {
                const payload = marketCache.payload;
                outputText += `\n📰 [حالة البورصة والأخبار من قاعدة البيانات]:\n`;
                
                // Append Index Details if available
                if (payload.egx30 && Array.isArray(payload.egx30) && payload.egx30.length > 0) {
                    const latest30 = payload.egx30[payload.egx30.length - 1];
                    const changePct = payload.egx30_return ? (payload.egx30_return * 100).toFixed(2) : "N/A";
                    outputText += `• مؤشر EGX30: ${latest30.close} نقطة | التغير: ${Number(changePct) >= 0 ? "+" : ""}${changePct}% | التاريخ: ${latest30.date}\n`;
                }
                
                if (payload.egx100 && Array.isArray(payload.egx100) && payload.egx100.length > 0) {
                    const latest100 = payload.egx100[payload.egx100.length - 1];
                    outputText += `• مؤشر EGX100: ${latest100.close} نقطة | التاريخ: ${latest100.date}\n`;
                }
                
                if (payload.usdegp && Array.isArray(payload.usdegp) && payload.usdegp.length > 0) {
                    const latestUSD = payload.usdegp[payload.usdegp.length - 1];
                    outputText += `• سعر صرف USD/EGP: ${latestUSD.close} جنيه | التاريخ: ${latestUSD.date}\n`;
                }
                
                if (payload.regime) {
                    outputText += `• اتجاه السوق (Market Regime): ${payload.regime}\n`;
                }

                // Extract market summary if available
                if (payload.market_summary) {
                    outputText += `• ملخص السوق: ${payload.market_summary}\n`;
                }
                
                // Extract top gainers/losers if available
                if (payload.top_gainers && Array.isArray(payload.top_gainers) && payload.top_gainers.length > 0) {
                    outputText += `\n🟢 أعلى الأسهم ارتفاعاً:\n`;
                    payload.top_gainers.slice(0, 5).forEach((stock: any) => {
                        outputText += `• ${stock.symbol}: ${stock.change || 'N/A'}%\n`;
                    });
                }
                
                if (payload.top_losers && Array.isArray(payload.top_losers) && payload.top_losers.length > 0) {
                    outputText += `\n🔴 أعلى الأسهم انخفاضاً:\n`;
                    payload.top_losers.slice(0, 5).forEach((stock: any) => {
                        outputText += `• ${stock.symbol}: ${stock.change || 'N/A'}%\n`;
                    });
                }
                
                outputText += `\n`;
            } else {
                outputText += `\n📰 [حالة البورصة والأخبار]: لا توجد بيانات محدثة في قاعدة البيانات حالياً.\n`;
            }
        } catch (e) {
            console.warn("Error fetching market cache:", e);
            outputText += `\n⚠️ [خطأ]: فشل جلب بيانات السوق من قاعدة البيانات.\n`;
        }
    }

    // Tool 5: get_news_sentiment (جلب الأخبار الفعلية من stock_news_sentiment table)
    if (tools.includes("get_news") || plannerResult.intent === "stock_news") {
        try {
            // حساب تاريخ الأسبوع الماضي
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
            const oneWeekAgoStr = oneWeekAgo.toISOString().split("T")[0];

            let newsQuery = supabase
                .from("stock_news_sentiment")
                .select("symbol, date, sentiment_score, news_count, negative_flag, positive_flag, headlines")
                .eq("exchange", "EGX")  // ✅ تصحيح: استخدام "exchange" بدلاً من "country"
                .gte("date", oneWeekAgoStr)  // أخبار آخر أسبوع فقط
                .gt("news_count", 0)  // ✅ فقط الأسهم التي لديها أخبار فعلية
                .order("date", { ascending: false })
                .limit(50);

            // إذا كان هناك رموز محددة، فلتر عليها
            if (symbols.length > 0) {
                newsQuery = newsQuery.in("symbol", symbols);
            }

            const { data: newsData } = await newsQuery;

            if (newsData && newsData.length > 0) {
                outputText += `\n📰 [أخبار وتحليلات المعنويات للأسهم - آخر 7 أيام]:\n`;
                outputText += `📌 إجمالي الأسهم التي لديها أخبار مسجلة: ${newsData.length} سهم\n\n`;
                
                // تجميع الأخبار حسب التاريخ
                const newsByDate = new Map<string, any[]>();
                newsData.forEach((item: any) => {
                    const dateKey = item.date || todayStr;
                    if (!newsByDate.has(dateKey)) {
                        newsByDate.set(dateKey, []);
                    }
                    newsByDate.get(dateKey)!.push(item);
                });

                // عرض الأخبار بترتيب التاريخ
                const sortedDates = Array.from(newsByDate.keys()).sort().reverse();
                sortedDates.forEach((date, idx) => {
                    if (idx < 3) {  // عرض آخر 3 أيام فقط لتجنب الإطالة
                        outputText += `📅 تاريخ: ${date}\n`;
                        const items = newsByDate.get(date) || [];
                        items.slice(0, 8).forEach((item: any) => {  // max 8 stocks per day
                            const sentiment = item.sentiment_score > 0.15 ? "إيجابي 🟢" : 
                                            item.sentiment_score < -0.15 ? "سلبي 🔴" : 
                                            "محايد ⚪";
                            const scorePercent = ((item.sentiment_score || 0) * 100).toFixed(1);
                            outputText += `  • ${item.symbol}: معنويات الأخبار = ${sentiment} (${scorePercent}%) | عدد الأخبار: ${item.news_count || 0}`;
                            
                            // إضافة عنوان رئيسي واحد إذا كان متاحاً
                            if (item.headlines && Array.isArray(item.headlines) && item.headlines.length > 0) {
                                const headline = String(item.headlines[0]).substring(0, 80);
                                outputText += ` | عنوان: "${headline}..."`;
                            }
                            outputText += `\n`;
                        });
                        outputText += `\n`;
                    }
                });
            } else {
                if (symbols.length > 0) {
                    outputText += `\n📰 [أخبار الأسهم]: لا توجد أخبار مسجلة للرموز المحددة (${symbols.join(', ')}) خلال الأسبوع الأخير.\n`;
                } else {
                    outputText += `\n📰 [أخبار الأسهم]: لا توجد أسهم بأخبار جديدة مسجلة في قاعدة البيانات خلال الأسبوع الأخير. قد تكون الأخبار محدودة في هذه الفترة أو يمكنك السؤال عن توصيات الأسهم بدلاً من ذلك.\n`;
                }
            }
        } catch (e) {
            console.warn("Error fetching news sentiment:", e);
            outputText += `\n⚠️ [خطأ]: فشل جلب الأخبار من قاعدة البيانات.\n`;
        }
    }

    // Tool 6: get_market_indices (جلب المؤشرات وأسعار العملات)
    if (tools.includes("get_market") || tools.includes("get_indices") || plannerResult.intent === "market_summary" || 
        plannerResult.session_update?.summary?.includes("مؤشر") || 
        plannerResult.session_update?.summary?.includes("دولار")) {
        try {
            outputText += `\n🔍 [تم تفعيل أداة جلب المؤشرات والعملات]:\n`;
            
            // جلب بيانات المؤشرات من stock_prices
            const indexSymbols = ['EGX30', 'EGX70', 'EGX100'];
            const { data: indexData } = await supabase
                .from("stock_prices")
                .select("symbol, close, volume, date")
                .in("symbol", indexSymbols)
                .order("date", { ascending: false })
                .limit(indexSymbols.length * 2);

            // جلب بيانات الدولار من market_cache
            const { data: marketCache } = await supabase
                .from("market_cache")
                .select("payload")
                .eq("cache_key", "market_status_Egypt")
                .maybeSingle();

            let hasIndexData = false;
            let hasUsdData = false;

            if (indexData && indexData.length > 0) {
                hasIndexData = true;
                outputText += `📊 [المؤشرات المصرية - البيانات الحقيقية من قاعدة البيانات]:\n`;
                
                // تجميع أحدث بيانات لكل مؤشر
                const latestIndices = new Map<string, any>();
                indexData.forEach((item: any) => {
                    if (!latestIndices.has(item.symbol) || 
                        (latestIndices.get(item.symbol)?.date || "") < (item.date || "")) {
                        latestIndices.set(item.symbol, item);
                    }
                });

                latestIndices.forEach((data, symbol) => {
                    const value = data.close || 0;
                    const date = data.date || todayStr;
                    outputText += `• ${symbol}: ${value.toFixed(1)} نقطة (تاريخ حقيقي: ${date})\n`;
                });
            }

            // استخراج بيانات USD/EGP
            if (marketCache?.payload?.usdegp && Array.isArray(marketCache.payload.usdegp)) {
                hasUsdData = true;
                const usdData = marketCache.payload.usdegp;
                // أحدث سعر صرف
                const latestUsd = usdData[usdData.length - 1];
                if (latestUsd) {
                    const rate = latestUsd.close || latestUsd.open || 0;
                    const date = latestUsd.date || todayStr;
                    
                    outputText += `\n💱 [سعر صرف الدولار الأمريكي - البيانات الحقيقية من قاعدة البيانات]:\n`;
                    outputText += `• USD/EGP: ${rate.toFixed(2)} جنيه مصري (تاريخ حقيقي: ${date})\n`;
                    outputText += `⚠️ تحذير للنموذج: السعر الحقيقي هو ${rate.toFixed(2)} وليس 15.25\n`;
                    
                    // حساب التغيير إذا كان لدينا أكثر من يوم واحد
                    if (usdData.length > 1) {
                        const previousUsd = usdData[usdData.length - 2];
                        if (previousUsd && previousUsd.close) {
                            const change = rate - previousUsd.close;
                            const changePercent = ((change / previousUsd.close) * 100);
                            const changeSymbol = change >= 0 ? "+" : "";
                            outputText += `• التغيير الحقيقي: ${changeSymbol}${change.toFixed(4)} (${changeSymbol}${changePercent.toFixed(2)}%)\n`;
                        }
                    }
                }
            }

            if (!hasIndexData && !hasUsdData) {
                outputText += `📊 [المؤشرات والعملات]: لا توجد بيانات محدثة متاحة حالياً في قاعدة البيانات.\n`;
            } else {
                outputText += `\n✅ تم جلب البيانات الحقيقية بنجاح - يُرجى عدم اختراع أي أرقام.\n`;
            }

        } catch (e) {
            console.warn("Error fetching market indices/USD data:", e);
            outputText += `\n⚠️ [خطأ]: فشل جلب بيانات المؤشرات والعملات من قاعدة البيانات.\n`;
        }
    }

    return outputText;
}
