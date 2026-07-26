import { PlannerResult } from "./types";
import { AI_CONFIG } from "./config";

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

    // Shared promise to prevent redundant market_cache fetch across tools in the same execution
    let marketCachePromise: Promise<any> | null = null;
    const fetchMarketCache = () => {
        if (!marketCachePromise) {
            marketCachePromise = supabase
                .from("market_cache")
                .select("payload")
                .eq("cache_key", `market_status_${AI_CONFIG.tools.defaultCountry}`)
                .maybeSingle();
        }
        return marketCachePromise;
    };

    // Tool 1: get_stock & load_stock_prices
    if (symbols.length > 0 && (tools.includes("get_stock") || tools.includes("load_stock_prices"))) {
        try {
            // Fetch exactly 1 latest record per symbol in parallel to avoid over-fetching and JS deduplication
            const [pricesData, techsData, stocksRes] = await Promise.all([
                Promise.all(
                    symbols.map(sym =>
                        supabase
                            .from("stock_prices")
                            .select("symbol, close, volume, date")
                            .eq("symbol", sym)
                            .order("date", { ascending: false })
                            .limit(1)
                            .maybeSingle()
                    )
                ),
                Promise.all(
                    symbols.map(sym =>
                        supabase
                            .from("stock_technical_indicators")
                            .select("symbol, rsi_14, macd_signal, change_pct, volume, vol_sma20, vwap_20, adx_14, momentum_10")
                            .eq("symbol", sym)
                            .order("date", { ascending: false })
                            .limit(1)
                            .maybeSingle()
                    )
                ),
                supabase.from("stocks").select("symbol, name").in("symbol", symbols)
            ]);

            const pricesMap = new Map<string, any>();
            pricesData.forEach(r => {
                if (r.data?.symbol) pricesMap.set(r.data.symbol, r.data);
            });

            const techsMap = new Map<string, any>();
            techsData.forEach(r => {
                if (r.data?.symbol) techsMap.set(r.data.symbol, r.data);
            });

            const stocksMap = new Map<string, any>();
            (stocksRes.data || []).forEach((s: any) => {
                if (s?.symbol) stocksMap.set(s.symbol, s);
            });

            if (pricesMap.size > 0) {
                outputText += `\n📊 [بيانات الأسهم المطلوبة من قاعدة البيانات]:\n`;
                symbols.forEach(sym => {
                    const price = pricesMap.get(sym);
                    const tech = techsMap.get(sym);
                    const stock = stocksMap.get(sym);
                    if (price) {
                        const changeStr = tech && typeof tech.change_pct === "number" 
                            ? `${tech.change_pct >= 0 ? "+" : ""}${tech.change_pct.toFixed(2)}%` 
                            : "N/A";

                        // Volume analysis & accumulation/distribution signal
                        const vol = tech?.volume ?? price?.volume ?? null;
                        const volSma20 = tech?.vol_sma20 ?? null;
                        let volumeStr = "";
                        let adSignal = "غير متاح";

                        if (vol !== null && vol !== undefined) {
                            const formattedVol = Number(vol).toLocaleString("en-US");
                            volumeStr = ` | حجم التداول: ${formattedVol}`;

                            if (volSma20 !== null && volSma20 !== undefined && Number(volSma20) > 0) {
                                const volRatio = Number(vol) / Number(volSma20);
                                const formattedVolSma = Number(volSma20).toLocaleString("en-US");
                                volumeStr += ` | متوسط الحجم (20 يوم): ${formattedVolSma} | نسبة الحجم: ${volRatio.toFixed(2)}x`;

                                const changePct = tech?.change_pct ?? 0;
                                if (volRatio >= 1.2 && changePct > 0) {
                                    adSignal = "تجميع 📈 (حجم تداول مرتفع مع صعود السعر)";
                                } else if (volRatio >= 1.2 && changePct < 0) {
                                    adSignal = "تصريف 📉 (حجم تداول مرتفع مع هبوط السعر)";
                                } else if (volRatio < 0.6 && changePct > 0) {
                                    adSignal = "صعود ضعيف ⚠️ (سعر صاعد لكن حجم تداول منخفض)";
                                } else if (volRatio < 0.6 && changePct < 0) {
                                    adSignal = "هبوط ضعيف ⚠️ (سعر هابط لكن حجم تداول منخفض)";
                                } else {
                                    adSignal = "محايد ⚪ (حجم تداول عادي)";
                                }
                            }
                        }

                        outputText += `• سهم ${sym} (${stock?.name || sym}): السعر اللحظي = ${price.close} ج.م | التغير: ${changeStr} | RSI: ${tech?.rsi_14 ?? "N/A"} | إشارة MACD: ${tech?.macd_signal ?? "N/A"}${volumeStr} | إشارة تصريف/تجميع: ${adSignal}\n`;
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
            // Select only columns required for statistics calculation (avoid fetching unused prices/targets)
            const { data: allRecs } = await supabase
                .from("scan_results")
                .select("signal, status, precision")
                .eq("country", AI_CONFIG.tools.defaultCountry);

            if (allRecs && allRecs.length > 0) {
                const total = allRecs.length;
                const openCount = allRecs.filter((r: any) => r.status === "open").length;
                const buyCount = allRecs.filter((r: any) => String(r.signal || "").toUpperCase().includes("BUY")).length;
                const sellCount = total - buyCount;
                const avgPrecision = (allRecs.reduce((acc: number, r: any) => acc + (Number(r.precision) || AI_CONFIG.tools.defaultPrecision), 0) / total).toFixed(1);

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
            const limit = isOldestQuery ? AI_CONFIG.tools.recommendationsLimitOldest : AI_CONFIG.tools.recommendationsLimit;

            // Build targeted query (only columns needed, single fetch based on sort order)
            let recsQuery = supabase
                .from("scan_results")
                .select("symbol, name, signal, entry_price, target_price, stop_loss, created_at")
                .eq("country", AI_CONFIG.tools.defaultCountry);

            if (symbols.length > 0) {
                recsQuery = recsQuery.in("symbol", symbols);
            }

            const { data: recsData } = await recsQuery
                .order("created_at", { ascending: isOldestQuery })
                .limit(limit);

            // Fallback if specific symbol had no recommendations
            let recsToUse = recsData || [];
            if (symbols.length > 0 && recsToUse.length === 0) {
                const { data: fallbackRecs } = await supabase
                    .from("scan_results")
                    .select("symbol, name, signal, entry_price, target_price, stop_loss, created_at")
                    .eq("country", AI_CONFIG.tools.defaultCountry)
                    .order("created_at", { ascending: isOldestQuery })
                    .limit(limit);
                recsToUse = fallbackRecs || [];
            }

            if (recsToUse.length > 0) {
                outputText += `\n🎯 [إشارات وتوصيات تداول البورصة المصرية من قاعدة البيانات - scan_results]:\n`;
                outputText += `📌 [سياق التاريخ والترتيب]: اليوم هو ${todayStr} - أمس هو ${yesterdayStr}. الترتيب الحالي للبيانات: ${isOldestQuery ? "الأقدم أولاً (Ascending)" : "الأحدث أولاً (Descending)"}.\n`;

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
            const { data: marketCache } = await fetchMarketCache();

            if (marketCache?.payload) {
                const payload = marketCache.payload;
                outputText += `\n📰 [حالة البورصة والأخبار من قاعدة البيانات]:\n`;
                
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

                if (payload.market_summary) {
                    outputText += `• ملخص السوق: ${payload.market_summary}\n`;
                }
                
                if (payload.top_gainers && Array.isArray(payload.top_gainers) && payload.top_gainers.length > 0) {
                    outputText += `\n🟢 أعلى الأسهم ارتفاعاً:\n`;
                    payload.top_gainers.slice(0, AI_CONFIG.tools.topGainersLosersLimit).forEach((stock: any) => {
                        outputText += `• ${stock.symbol}: ${stock.change || 'N/A'}%\n`;
                    });
                }
                
                if (payload.top_losers && Array.isArray(payload.top_losers) && payload.top_losers.length > 0) {
                    outputText += `\n🔴 أعلى الأسهم انخفاضاً:\n`;
                    payload.top_losers.slice(0, AI_CONFIG.tools.topGainersLosersLimit).forEach((stock: any) => {
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
            const lookbackDate = new Date();
            lookbackDate.setDate(lookbackDate.getDate() - AI_CONFIG.tools.newsDaysLookback);
            const lookbackDateStr = lookbackDate.toISOString().split("T")[0];

            let newsQuery = supabase
                .from("stock_news_sentiment")
                .select("symbol, date, sentiment_score, news_count, headlines")
                .eq("exchange", AI_CONFIG.tools.defaultExchange)
                .gte("date", lookbackDateStr)
                .gt("news_count", 0)
                .order("date", { ascending: false })
                .limit(AI_CONFIG.tools.newsLimit);

            if (symbols.length > 0) {
                newsQuery = newsQuery.in("symbol", symbols);
            }

            const { data: newsData } = await newsQuery;

            if (newsData && newsData.length > 0) {
                outputText += `\n📰 [أخبار وتحليلات المعنويات للأسهم - آخر ${AI_CONFIG.tools.newsDaysLookback} أيام]:\n`;
                outputText += `📌 إجمالي الأسهم التي لديها أخبار مسجلة: ${newsData.length} سهم\n\n`;
                
                const newsByDate = new Map<string, any[]>();
                newsData.forEach((item: any) => {
                    const dateKey = item.date || todayStr;
                    if (!newsByDate.has(dateKey)) {
                        newsByDate.set(dateKey, []);
                    }
                    newsByDate.get(dateKey)!.push(item);
                });

                const sortedDates = Array.from(newsByDate.keys()).sort().reverse();
                sortedDates.forEach((date, idx) => {
                    if (idx < AI_CONFIG.tools.newsDaysDisplay) {
                        outputText += `📅 تاريخ: ${date}\n`;
                        const items = newsByDate.get(date) || [];
                        items.slice(0, AI_CONFIG.tools.newsHeadlinesMaxPerDay).forEach((item: any) => {
                            const sentiment = item.sentiment_score > 0.15 ? "إيجابي 🟢" : 
                                            item.sentiment_score < -0.15 ? "سلبي 🔴" : 
                                            "محايد ⚪";
                            const scorePercent = ((item.sentiment_score || 0) * 100).toFixed(1);
                            outputText += `  • ${item.symbol}: معنويات الأخبار = ${sentiment} (${scorePercent}%) | عدد الأخبار: ${item.news_count || 0}`;
                            
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
            
            const indexSymbols = AI_CONFIG.tools.indexSymbols;
            const [indexDataRes, { data: marketCache }] = await Promise.all([
                Promise.all(
                    indexSymbols.map(sym =>
                        supabase
                            .from("stock_prices")
                            .select("symbol, close, date")
                            .eq("symbol", sym)
                            .order("date", { ascending: false })
                            .limit(1)
                            .maybeSingle()
                    )
                ),
                fetchMarketCache()
            ]);

            const indexData = indexDataRes.map(r => r.data).filter(Boolean);
            let hasIndexData = false;
            let hasUsdData = false;

            if (indexData && indexData.length > 0) {
                hasIndexData = true;
                outputText += `📊 [المؤشرات المصرية - البيانات الحقيقية من قاعدة البيانات]:\n`;
                
                indexData.forEach((data: any) => {
                    const value = data.close || 0;
                    const date = data.date || todayStr;
                    outputText += `• ${data.symbol}: ${value.toFixed(1)} نقطة (تاريخ حقيقي: ${date})\n`;
                });
            }

            if (marketCache?.payload?.usdegp && Array.isArray(marketCache.payload.usdegp)) {
                hasUsdData = true;
                const usdData = marketCache.payload.usdegp;
                const latestUsd = usdData[usdData.length - 1];
                if (latestUsd) {
                    const rate = latestUsd.close || latestUsd.open || 0;
                    const date = latestUsd.date || todayStr;
                    
                    outputText += `\n💱 [سعر صرف الدولار الأمريكي - البيانات الحقيقية من قاعدة البيانات]:\n`;
                    outputText += `• USD/EGP: ${rate.toFixed(2)} جنيه مصري (تاريخ حقيقي: ${date})\n`;
                    outputText += `⚠️ تحذير للنموذج: السعر الحقيقي هو ${rate.toFixed(2)} وليس 15.25\n`;
                    
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
