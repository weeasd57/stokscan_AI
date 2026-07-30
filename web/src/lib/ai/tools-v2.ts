import { IntentPlan, ToolResult } from "./types";
import { AI_CONFIG } from "./config";

function normalizeArabic(str: string): string {
    return str
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي")
        .replace(/ؤ/g, "و")
        .toLowerCase();
}

export interface StructuredToolOutput {
    results: ToolResult[];
    formattedText: string;
}

export async function executeStructuredTools(
    supabase: any,
    plan: IntentPlan,
    apiKeys: string[],
    userId: string = "",
    sessionId: string = ""
): Promise<StructuredToolOutput> {
    const results: ToolResult[] = [];
    const textParts: string[] = [];

    const now = new Date().toISOString();
    const symbols = plan.entities.symbols || [];
    const userMessage = "";

    if (!plan.needs_live_data && !plan.needs_historical_data) {
        return { results, formattedText: "" };
    }

    // ===== HISTORICAL RECALL =====
    if (plan.intent === "historical_recall") {
        try {
            let query = supabase
                .from("ai_chat_facts")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(3);

            if (userId) query = query.eq("user_id", userId);
            if (sessionId) query = query.eq("session_id", sessionId);
            if (symbols.length > 0) {
                query = query.overlaps("symbols", symbols);
            } else {
                query = query.overlaps("symbols", ["COMI", "EAST"]);
            }

            const { data: snapshots } = await query;

            if (snapshots && snapshots.length > 0) {
                const snapshot = snapshots[0];
                textParts.push(`\n [بيانات تاريخية مسترجعة - ${snapshot.as_of}]:`);
                const formatted = formatSnapshotFacts(snapshot.facts);
                textParts.push(formatted);
                results.push({
                    tool: "get_historical_facts",
                    source: "snapshot",
                    data_time: snapshot.as_of || now,
                    symbols: snapshot.symbols || [],
                    data_type: "historical",
                    data: snapshot.facts
                });
            } else {
                textParts.push("\n [بيانات تاريخية]: لا توجد بيانات تاريخية مسجلة لهذا الطلب.");
                results.push({
                    tool: "get_historical_facts",
                    source: "empty",
                    data_time: now,
                    symbols,
                    data_type: "historical",
                    data: {}
                });
            }
        } catch (e) {
            console.warn("Error fetching historical facts:", e);
        }
        return { results, formattedText: textParts.join("\n") };
    }

    // ===== ACCUMULATION / DISTRIBUTION STOCKS =====
    const isAccumulationQuery = plan.tools.includes("get_accumulation_stocks");
    if (isAccumulationQuery) {
        try {
            const { data: summaryScans } = await supabase
                .from("stock_scans_summary")
                .select("symbol, scan_date, signal, wyckoff_phase, acc_score, dist_score, vol_ratio, consecutive_acc_days, consecutive_dist_days, change_pct, volume, rsi_14, macd_signal")
                .order("scan_date", { ascending: false })
                .order("acc_score", { ascending: false })
                .limit(200);

            let hasSummaryData = false;

            if (summaryScans && summaryScans.length > 0) {
                const maxDate = summaryScans[0].scan_date;
                const todayScans = summaryScans.filter((r: any) => r.scan_date === maxDate);

                if (todayScans.length > 0) {
                    hasSummaryData = true;
                    const symbolsList = Array.from(new Set(todayScans.map((r: any) => r.symbol)));
                    const { data: stocksData } = await supabase
                        .from("stocks")
                        .select("symbol, name")
                        .in("symbol", symbolsList);
                    const stocksMap = new Map<string, string>();
                    (stocksData || []).forEach((s: any) => {
                        if (s?.symbol) stocksMap.set(s.symbol, s.name || s.symbol);
                    });

                    const accStocks = todayScans
                        .filter((r: any) => r.signal === "accumulation" || Number(r.acc_score || 0) >= 50)
                        .sort((a: any, b: any) => Number(b.acc_score || 0) - Number(a.acc_score || 0))
                        .slice(0, 15);

                    if (accStocks.length > 0) {
                        textParts.push(`\n [بيانات المسح الفني الشامل لجميع أسهم البورصة المصرية]:\n`);
                        textParts.push(`تغطي قاعدة البيانات حياً كافة أسهم البورصة المصرية. القائمة التالية هي أعلى الأسهم تجميعاً وسيولة مؤسسية تم رصدها بالمسح الشامل من بين جميع أسهم السوق بتاريخ ${maxDate}:\n`);
                        accStocks.forEach((r: any, idx: number) => {
                            const name = stocksMap.get(r.symbol) || r.symbol;
                            const changeStr = Number(r.change_pct || 0) >= 0 ? `+${Number(r.change_pct).toFixed(2)}%` : `${Number(r.change_pct).toFixed(2)}%`;
                            const consecStr = r.consecutive_acc_days > 1 ? ` | تجميع لـ ${r.consecutive_acc_days} أيام متتالية` : "";
                            textParts.push(`• ${idx + 1}. سهم ${r.symbol} (${name}): درجة التجميع = ${r.acc_score}/100 | نسبة السيولة = ${r.vol_ratio}x من المتوسط | التغير = ${changeStr}${consecStr} | نمط Wyckoff: ${r.wyckoff_phase} | RSI = ${r.rsi_14 || "N/A"} | إشارة: تجميع`);
                        });
                        results.push({
                            tool: "get_accumulation_stocks",
                            source: "stock_scans_summary",
                            data_time: maxDate,
                            symbols: accStocks.map((r: any) => r.symbol),
                            data_type: "live",
                            data: { stocks: accStocks, date: maxDate }
                        });
                    }
                }
            }

            if (!hasSummaryData) {
                const { data: latestTechs } = await supabase
                    .from("stock_technical_indicators")
                    .select("symbol, change_pct, volume, vol_sma20, rsi_14, macd_signal, date")
                    .order("date", { ascending: false })
                    .limit(400);

                if (latestTechs && latestTechs.length > 0) {
                    const maxDate = latestTechs[0].date;
                    const todayTechs = latestTechs.filter((r: any) => r.date === maxDate);

                    const accStocks = todayTechs
                        .filter((r: any) => r.vol_sma20 && Number(r.vol_sma20) > 0 && (Number(r.volume) / Number(r.vol_sma20)) >= 1.2 && Number(r.change_pct || 0) > 0)
                        .sort((a: any, b: any) => (Number(b.volume) / Number(b.vol_sma20)) - (Number(a.volume) / Number(a.vol_sma20)))
                        .slice(0, 15);

                    if (accStocks.length > 0) {
                        textParts.push(`\n [أهم الأسهم التي تشهد تجميع (Accumulation) في البورصة المصرية - بتاريخ ${maxDate}]:\n`);
                        accStocks.forEach((r: any, idx: number) => {
                            const volRatio = (Number(r.volume) / Number(r.vol_sma20)).toFixed(2);
                            const changeStr = `+${Number(r.change_pct).toFixed(2)}%`;
                            textParts.push(`• ${idx + 1}. سهم ${r.symbol}: نسبة الحجم = ${volRatio}x من المتوسط | التغير = ${changeStr} | RSI = ${r.rsi_14 || "N/A"} | MACD = ${r.macd_signal || "N/A"} | إشارة: تجميع`);
                        });
                        results.push({
                            tool: "get_accumulation_stocks",
                            source: "stock_technical_indicators",
                            data_time: maxDate,
                            symbols: accStocks.map((r: any) => r.symbol),
                            data_type: "live",
                            data: { stocks: accStocks, date: maxDate }
                        });
                    }
                }
            }
        } catch (e) {
            console.warn("Error fetching accumulation stocks:", e);
        }
    }

    // ===== LIVE STOCK DATA =====
    if (plan.needs_live_data && symbols.length > 0) {
        try {
            const [pricesRes, techsRes, stocksRes] = await Promise.all([
                Promise.all(
                    symbols.map(sym =>
                        supabase
                            .from("stock_prices")
                            .select("symbol, close, volume, date")
                            .ilike("symbol", sym)
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
                            .ilike("symbol", sym)
                            .order("date", { ascending: false })
                            .limit(1)
                            .maybeSingle()
                    )
                ),
                supabase.from("stocks").select("symbol, name").or(
                    symbols.map(s => `symbol.ilike.${s}`).join(",")
                )
            ]);

            const pricesMap = new Map<string, any>();
            pricesRes.forEach(r => {
                if (r.data?.symbol) pricesMap.set(r.data.symbol.toUpperCase(), r.data);
            });
            const techsMap = new Map<string, any>();
            techsRes.forEach(r => {
                if (r.data?.symbol) techsMap.set(r.data.symbol.toUpperCase(), r.data);
            });
            const stocksMap = new Map<string, any>();
            (stocksRes.data || []).forEach((s: any) => {
                if (s?.symbol) stocksMap.set(s.symbol.toUpperCase(), s);
            });

            if (pricesMap.size > 0 || techsMap.size > 0) {
                textParts.push(`\n [بيانات السوق الحالية - ${now.split("T")[0]}]:\n`);
                symbols.forEach(sym => {
                    const upperSym = sym.toUpperCase();
                    const price = pricesMap.get(upperSym);
                    const tech = techsMap.get(upperSym);
                    const stockData: any = stocksMap.get(upperSym);

                    if (price || tech) {
                        const priceData = price as any;
                        const techData = tech as any;
                        const closePrice = priceData?.close ?? techData?.close ?? techData?.vwap_20 ?? "N/A";
                        const changeStr = techData && typeof techData.change_pct === "number"
                            ? `${techData.change_pct >= 0 ? "+" : ""}${techData.change_pct.toFixed(2)}%`
                            : "N/A";
                        const rsi = techData?.rsi_14 != null ? Number(techData.rsi_14).toFixed(2) : "N/A";
                        const macd = techData?.macd_signal != null ? Number(techData.macd_signal).toFixed(4) : "N/A";
                        const vol = techData?.volume ?? priceData?.volume ?? null;
                        const volSma20 = techData?.vol_sma20 ?? null;
                        let volRatioStr = "1.00x";
                        if (vol !== null && volSma20 !== null && Number(volSma20) > 0) {
                            volRatioStr = `${(Number(vol) / Number(volSma20)).toFixed(2)}x`;
                        }

                        textParts.push(`• ${sym} (${stockData?.name || sym}): السعر = ${closePrice} ج.م, التغير = ${changeStr}, RSI = ${rsi}, MACD = ${macd}, نسبة السيولة = ${volRatioStr}`);

                        results.push({
                            tool: "get_stock",
                            source: "database",
                            data_time: priceData?.date || techData?.date || now,
                            symbols: [upperSym],
                            data_type: "live",
                            data: {
                                symbol: upperSym,
                                name: stockData?.name || upperSym,
                                price: closePrice,
                                change_pct: changeStr,
                                rsi_14: rsi,
                                macd_signal: macd,
                                vol_ratio: volRatioStr
                            }
                        });
                    }
                });
            }
        } catch (e) {
            console.warn("Error fetching live stock data:", e);
        }
    }

    // ===== MARKET / INDICES =====
    if ((plan.tools.includes("get_market") || plan.tools.includes("get_indices") || plan.intent === "market_summary") && plan.needs_live_data) {
        try {
            const { data: marketCache } = await supabase
                .from("market_cache")
                .select("payload")
                .eq("cache_key", `market_status_${AI_CONFIG.tools.defaultCountry}`)
                .maybeSingle();

            if (marketCache?.payload) {
                const payload = marketCache.payload;
                const egxDate = payload.egx30?.[payload.egx30.length - 1]?.date || payload.usdegp?.[payload.usdegp.length - 1]?.date || now.split("T")[0];
                textParts.push(`\n [حالة السوق - ${egxDate}]:`);

                if (payload.egx30?.[0]) {
                    textParts.push(`• EGX30: ${payload.egx30[payload.egx30.length - 1]?.close || "N/A"} نقطة`);
                }
                if (payload.egx100?.[0]) {
                    textParts.push(`• EGX100: ${payload.egx100[payload.egx100.length - 1]?.close || "N/A"} نقطة`);
                }
                if (payload.usdegp?.[0]) {
                    textParts.push(`• USD/EGP: ${payload.usdegp[payload.usdegp.length - 1]?.close || "N/A"} جنيه`);
                }
                if (payload.regime) {
                    textParts.push(`• اتجاه السوق: ${payload.regime}`);
                }
                if (payload.top_gainers && Array.isArray(payload.top_gainers) && payload.top_gainers.length > 0) {
                    textParts.push(`\n أعلى الأسهم ارتفاعاً:`);
                    payload.top_gainers.slice(0, AI_CONFIG.tools.topGainersLosersLimit).forEach((stock: any) => {
                        textParts.push(`• ${stock.symbol}: ${stock.change || 'N/A'}%`);
                    });
                }
                if (payload.top_losers && Array.isArray(payload.top_losers) && payload.top_losers.length > 0) {
                    textParts.push(`\n أعلى الأسهم انخفاضاً:`);
                    payload.top_losers.slice(0, AI_CONFIG.tools.topGainersLosersLimit).forEach((stock: any) => {
                        textParts.push(`• ${stock.symbol}: ${stock.change || 'N/A'}%`);
                    });
                }

                results.push({
                    tool: "get_market",
                    source: "database",
                    data_time: egxDate,
                    symbols: ["EGX30", "USDEGP"],
                    data_type: "live",
                    data: {
                        egx30: payload.egx30?.[payload.egx30.length - 1]?.close,
                        usd: payload.usdegp?.[payload.usdegp.length - 1]?.close,
                        regime: payload.regime,
                        top_gainers: payload.top_gainers,
                        top_losers: payload.top_losers
                    }
                });
            }
        } catch (e) {
            console.warn("Error fetching market data:", e);
        }

        // Fallback: compute top gainers/losers from technical indicators
        try {
            const { data: latestTechs } = await supabase
                .from("stock_technical_indicators")
                .select("symbol, change_pct, volume, vol_sma20, date")
                .order("date", { ascending: false })
                .limit(500);

            if (latestTechs && latestTechs.length > 0) {
                const maxTechDate = latestTechs[0].date;
                const todayTechs = latestTechs.filter((r: any) => r.date === maxTechDate);

                if (todayTechs.length > 0) {
                    const gainers = todayTechs
                        .filter((r: any) => Number(r.change_pct || 0) > 0)
                        .sort((a: any, b: any) => Number(b.change_pct || 0) - Number(a.change_pct || 0))
                        .slice(0, AI_CONFIG.tools.topGainersLosersLimit);

                    const losers = todayTechs
                        .filter((r: any) => Number(r.change_pct || 0) < 0)
                        .sort((a: any, b: any) => Number(a.change_pct || 0) - Number(b.change_pct || 0))
                        .slice(0, AI_CONFIG.tools.topGainersLosersLimit);

                    if (gainers.length > 0) {
                        textParts.push(`\n [أعلى الأسهم ارتفاعاً - من البيانات الفنية المباشرة]:`);
                        gainers.forEach((r: any) => {
                            textParts.push(`• ${r.symbol}: +${Number(r.change_pct).toFixed(2)}%`);
                        });
                    }
                    if (losers.length > 0) {
                        textParts.push(`\n [أعلى الأسهم انخفاضاً - من البيانات الفنية المباشرة]:`);
                        losers.forEach((r: any) => {
                            textParts.push(`• ${r.symbol}: ${Number(r.change_pct).toFixed(2)}%`);
                        });
                    }
                }
            }
        } catch (e) {
            console.warn("Error computing top gainers/losers:", e);
        }
    }

    // ===== NEWS =====
    if (plan.tools.includes("get_news")) {
        try {
            const lookbackDate = new Date();
            lookbackDate.setDate(lookbackDate.getDate() - AI_CONFIG.tools.newsDaysLookback);
            const lookbackDateStr = lookbackDate.toISOString().split("T")[0];

            if (symbols.length > 0) {
                try {
                    const { data: stocksData } = await supabase
                        .from("stocks")
                        .select("id, symbol")
                        .or(symbols.map(s => `symbol.ilike.${s}`).join(","));

                    if (stocksData && stocksData.length > 0) {
                        const stockIds = stocksData.map((s: any) => s.id);
                        const symbolById = new Map<number, string>(
                            stocksData.map((s: any) => [s.id, s.symbol])
                        );

                        const { data: articles } = await supabase
                            .from("news")
                            .select("stock_id, title, url, source, published_at, sentiment_score, sentiment_label")
                            .in("stock_id", stockIds)
                            .gte("published_at", lookbackDate.toISOString())
                            .order("published_at", { ascending: false })
                            .limit(AI_CONFIG.tools.newsLimit * 3);

                        if (articles && articles.length > 0) {
                            const articlesBySymbol = new Map<string, any[]>();
                            articles.forEach((a: any) => {
                                const sym = symbolById.get(a.stock_id);
                                if (sym) {
                                    if (!articlesBySymbol.has(sym)) {
                                        articlesBySymbol.set(sym, []);
                                    }
                                    articlesBySymbol.get(sym)!.push(a);
                                }
                            });

                            textParts.push(`\n [أخبار الأسهم - مقالات حية من قاعدة البيانات]:\n`);
                            articlesBySymbol.forEach((items, sym) => {
                                textParts.push(`\n ${sym} (${items.length} خبر):`);
                                items.slice(0, 8).forEach((a: any) => {
                                    const pubDate = a.published_at
                                        ? new Date(a.published_at).toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" })
                                        : "غير معروف";
                                    const sentiment = a.sentiment_label || (a.sentiment_score > 0.15 ? "إيجابي" : a.sentiment_score < -0.15 ? "سلبي" : "محايد");
                                    textParts.push(`  • ${a.title} (${pubDate} - ${sentiment})`);
                                });
                            });
                        }
                    }
                } catch (e) {
                    console.warn("Error fetching news articles:", e);
                }
            }

            let newsQuery = supabase
                .from("stock_news_sentiment")
                .select("symbol, date, sentiment_score, news_count, headlines")
                .eq("exchange", AI_CONFIG.tools.defaultExchange)
                .gte("date", lookbackDateStr)
                .gt("news_count", 0)
                .order("date", { ascending: false })
                .limit(AI_CONFIG.tools.newsLimit);

            if (symbols.length > 0) {
                newsQuery = newsQuery.or(symbols.map(s => `symbol.ilike.${s}`).join(","));
            }

            const { data: newsData } = await newsQuery;

            if (newsData && newsData.length > 0) {
                textParts.push(`\n [أخبار وتحليلات المعنويات للأسهم - آخر ${AI_CONFIG.tools.newsDaysLookback} أيام]:\n`);
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
                    textParts.push(` تاريخ: ${date}`);
                    const items = newsByDate.get(date) || [];
                    items.slice(0, AI_CONFIG.tools.newsHeadlinesMaxPerDay).forEach((item: any) => {
                        const sentiment = item.sentiment_score > 0.15 ? "إيجابي" :
                            item.sentiment_score < -0.15 ? "سلبي" : "محايد";
                        const scorePercent = ((item.sentiment_score || 0) * 100).toFixed(1);
                        textParts.push(`  • ${item.symbol}: معنويات = ${sentiment} (${scorePercent}%) | عدد الأخبار: ${item.news_count || 0}`);
                    });
                });
            }

            results.push({
                tool: "get_news",
                source: "database",
                data_time: now,
                symbols,
                data_type: "live",
                data: newsData || []
            });
        } catch (e) {
            console.warn("Error fetching news:", e);
        }
    }

    // ===== RECOMMENDATIONS / SIGNALS =====
    if (plan.tools.includes("get_recommendations") || plan.tools.includes("get_signals")) {
        try {
            let recsQuery = supabase
                .from("scan_results")
                .select("symbol, name, signal, entry_price, target_price, stop_loss, created_at")
                .eq("country", AI_CONFIG.tools.defaultCountry);

            if (symbols.length > 0) {
                recsQuery = recsQuery.or(symbols.map(s => `symbol.ilike.${s}`).join(","));
            }

            const { data: recsData } = await recsQuery
                .order("created_at", { ascending: false })
                .limit(AI_CONFIG.tools.recommendationsLimit);

            if (recsData && recsData.length > 0) {
                textParts.push(`\n [إشارات وتوصيات تداول البورصة المصرية من قاعدة البيانات]:\n`);
                recsData.forEach((r: any) => {
                    const signal = String(r.signal || "BUY").toUpperCase();
                    const entry = r.entry_price ? `${r.entry_price} ج.م` : "N/A";
                    const target = r.target_price ? `${r.target_price} ج.م` : "N/A";
                    const stop = r.stop_loss ? `${r.stop_loss} ج.م` : "N/A";
                    const dateStr = r.created_at ? String(r.created_at).replace("T", " ").split(".")[0] : "تاريخ غير محدد";
                    textParts.push(`• توصية سهم ${r.symbol} (${r.name || r.symbol}): الإشارة = ${signal} | سعر الدخول = ${entry} | الهدف = ${target} | وقف الخسارة = ${stop} | تاريخ التوصية = ${dateStr}`);
                });

                results.push({
                    tool: "get_recommendations",
                    source: "scan_results",
                    data_time: now,
                    symbols: recsData.map((r: any) => r.symbol),
                    data_type: "live",
                    data: recsData
                });
            }
        } catch (e) {
            console.warn("Error fetching recommendations:", e);
        }
    }

    // ===== SECTOR ANALYSIS =====
    if (plan.tools.includes("get_sector") || plan.intent === "sector_analysis") {
        try {
            let targetSector = plan.entities.sector || "";
            if (!targetSector) {
                targetSector = "بنوك";
            }

            if (targetSector) {
                const { data: fundamentalsRows } = await supabase
                    .from("stock_fundamentals")
                    .select("symbol, data")
                    .eq("exchange", "EGX")
                    .limit(1000);

                const SECTOR_TERMS: Record<string, string[]> = {
                    "أدوية": ["pharmaceutical", "pharma", "drug", "أدوية", "صيدلة"],
                    "عقارات": ["real estate", "realestate", "عقارات", "عقاري"],
                    "أغذية": ["food", "beverage", "أغذية", "غذائية"],
                    "بترول": ["oil", "gas", "petroleum", "energy", "بترول", "طاقة"],
                };
                const normalizedTargetSector = normalizeArabic(targetSector);
                const parseFundamentalData = (value: unknown): Record<string, any> => {
                    if (value && typeof value === "object") return value as Record<string, any>;
                    if (typeof value === "string") {
                        try { return JSON.parse(value); } catch { return {}; }
                    }
                    return {};
                };

                const sectorStocks = (fundamentalsRows || []).flatMap((row: any) => {
                    const data = parseFundamentalData(row.data);
                    const sector = String(data.sector || data.Sector || "");
                    const industry = String(data.industry || data.Industry || "");
                    const name = String(data.name || data.Name || row.symbol);
                    const classification = `${sector} ${industry}`.toLowerCase();
                    const industryClassification = industry.toLowerCase();
                    const isBank = /\bbank(s|ing)?\b/.test(industryClassification)
                        && !/investment banks?\/?brokers?/.test(industryClassification);
                    const matchesRequestedSector = normalizedTargetSector === "بنوك"
                        ? isBank
                        : (SECTOR_TERMS[targetSector] || [targetSector.toLowerCase(), normalizedTargetSector])
                            .some((term) => classification.includes(term.toLowerCase()));

                    return matchesRequestedSector
                        ? [{ symbol: row.symbol, name, sector: sector || industry }]
                        : [];
                }).slice(0, 100);

                if (sectorStocks && sectorStocks.length > 0) {
                    const sectorSymbols = sectorStocks.map((s: any) => s.symbol);
                    const { data: latestTechs } = await supabase
                        .from("stock_technical_indicators")
                        .select("symbol, change_pct, volume, vol_sma20, rsi_14, macd_signal, date")
                        .eq("exchange", "EGX")
                        .in("symbol", sectorSymbols)
                        .order("date", { ascending: false })
                        .limit(500);

                    if (latestTechs && latestTechs.length > 0) {
                        const maxDate = latestTechs[0].date;
                        const todayTechs = latestTechs.filter((r: any) => r.date === maxDate);
                        const techMap = new Map(todayTechs.map((t: any) => [t.symbol.toUpperCase(), t]));

                        const gainers = sectorStocks
                            .map((s: any) => ({ ...s, tech: techMap.get(s.symbol.toUpperCase()) }))
                            .filter((s: any) => s.tech && Number(s.tech.change_pct || 0) > 0)
                            .sort((a: any, b: any) => Number(b.tech.change_pct || 0) - Number(a.tech.change_pct || 0))
                            .slice(0, 10);

                        const losers = sectorStocks
                            .map((s: any) => ({ ...s, tech: techMap.get(s.symbol.toUpperCase()) }))
                            .filter((s: any) => s.tech && Number(s.tech.change_pct || 0) < 0)
                            .sort((a: any, b: any) => Number(a.tech.change_pct || 0) - Number(b.tech.change_pct || 0))
                            .slice(0, 10);

                        textParts.push(`\n [تحليل قطاع ${targetSector} - ${sectorStocks.length} سهم]:\n`);

                        if (gainers.length > 0) {
                            textParts.push(`أعلى ارتفاعاً في القطاع:`);
                            gainers.forEach((s: any) => {
                                const ch = Number(s.tech.change_pct).toFixed(2);
                                textParts.push(`• ${s.symbol} (${s.name}): +${ch}% | RSI: ${s.tech.rsi_14 ?? "N/A"} | حجم: ${(Number(s.tech.volume || 0) / Number(s.tech.vol_sma20 || 1)).toFixed(2)}x`);
                            });
                        }
                        if (losers.length > 0) {
                            textParts.push(`\nأعلى انخفاضاً في القطاع:`);
                            losers.forEach((s: any) => {
                                const ch = Number(s.tech.change_pct).toFixed(2);
                                textParts.push(`• ${s.symbol} (${s.name}): ${ch}% | RSI: ${s.tech.rsi_14 ?? "N/A"} | حجم: ${(Number(s.tech.volume || 0) / Number(s.tech.vol_sma20 || 1)).toFixed(2)}x`);
                            });
                        }

                        results.push({
                            tool: "get_sector",
                            source: "database",
                            data_time: maxDate,
                            symbols: sectorSymbols,
                            data_type: "live",
                            data: { sector: targetSector, stocks: sectorStocks, gainers, losers }
                        });
                    }
                }
            }
        } catch (e) {
            console.warn("Error fetching sector data:", e);
        }
    }

    // ===== COMPARISON =====
    if (plan.tools.includes("get_comparison") || plan.intent === "comparison") {
        try {
            const compareSymbols = symbols.length >= 2 ? symbols.slice(0, 2) : [];
            if (compareSymbols.length === 2) {
                const [sym1, sym2] = compareSymbols;
                const [pricesData, techsData, stocksData, fundamentalsData] = await Promise.all([
                    Promise.all([
                        supabase.from("stock_prices").select("symbol, close, volume, date").ilike("symbol", sym1).order("date", { ascending: false }).limit(1).maybeSingle(),
                        supabase.from("stock_prices").select("symbol, close, volume, date").ilike("symbol", sym2).order("date", { ascending: false }).limit(1).maybeSingle()
                    ]),
                    Promise.all([
                        supabase.from("stock_technical_indicators").select("symbol, rsi_14, macd_signal, change_pct, volume, vol_sma20, adx_14, date").ilike("symbol", sym1).order("date", { ascending: false }).limit(1).maybeSingle(),
                        supabase.from("stock_technical_indicators").select("symbol, rsi_14, macd_signal, change_pct, volume, vol_sma20, adx_14, date").ilike("symbol", sym2).order("date", { ascending: false }).limit(1).maybeSingle()
                    ]),
                    supabase.from("stocks").select("symbol, name").or(`symbol.ilike.${sym1},symbol.ilike.${sym2}`),
                    supabase.from("stock_fundamentals").select("symbol, data").in("symbol", [sym1.toUpperCase(), sym2.toUpperCase()])
                ]);

                const p1 = pricesData[0]?.data;
                const p2 = pricesData[1]?.data;
                const t1 = techsData[0]?.data;
                const t2 = techsData[1]?.data;
                const sMap = new Map<string, any>();
                (stocksData.data || []).forEach((s: any) => { if (s?.symbol) sMap.set(s.symbol.toUpperCase(), s); });

                const sectorMap = new Map<string, string>();
                (fundamentalsData.data || []).forEach((row: any) => {
                    if (row?.symbol) {
                        let sectorStr = "N/A";
                        try {
                            const parsed = typeof row.data === "object" ? row.data : JSON.parse(row.data);
                            sectorStr = parsed.sector || parsed.Sector || parsed.industry || parsed.Industry || "N/A";
                        } catch {}
                        sectorMap.set(row.symbol.toUpperCase(), sectorStr);
                    }
                });

                const sector1 = sectorMap.get(sym1.toUpperCase()) || "N/A";
                const sector2 = sectorMap.get(sym2.toUpperCase()) || "N/A";

                if (p1 || p2 || t1 || t2) {
                    textParts.push(`\n [مقارنة بين ${sym1} و ${sym2}]:\n`);
                    textParts.push(`| المؤشر | ${sym1} (${sMap.get(sym1.toUpperCase())?.name || sym1}) | ${sym2} (${sMap.get(sym2.toUpperCase())?.name || sym2}) |`);
                    textParts.push(`| :--- | :--- | :--- |`);
                    textParts.push(`| السعر اللحظي | ${p1?.close ?? "N/A"} ج.م | ${p2?.close ?? "N/A"} ج.م |`);
                    textParts.push(`| التغير اليومي | ${t1?.change_pct ? (Number(t1.change_pct) >= 0 ? "+" : "") + Number(t1.change_pct).toFixed(2) + "%" : "N/A"} | ${t2?.change_pct ? (Number(t2.change_pct) >= 0 ? "+" : "") + Number(t2.change_pct).toFixed(2) + "%" : "N/A"} |`);
                    textParts.push(`| نسبة السيولة | ${t1?.vol_sma20 && t1?.volume ? (Number(t1.volume) / Number(t1.vol_sma20)).toFixed(2) + "x" : "N/A"} | ${t2?.vol_sma20 && t2?.volume ? (Number(t2.volume) / Number(t2.vol_sma20)).toFixed(2) + "x" : "N/A"} |`);
                    textParts.push(`| RSI (14) | ${t1?.rsi_14 ?? "N/A"} | ${t2?.rsi_14 ?? "N/A"} |`);
                    textParts.push(`| MACD | ${t1?.macd_signal ?? "N/A"} | ${t2?.macd_signal ?? "N/A"} |`);
                    textParts.push(`| القطاع | ${sector1} | ${sector2} |`);

                    results.push({
                        tool: "get_comparison",
                        source: "database",
                        data_time: p1?.date || t1?.date || p2?.date || t2?.date || now,
                        symbols: [sym1, sym2],
                        data_type: "live",
                        data: {
                            sym1: { price: p1, tech: t1, info: { ...(sMap.get(sym1.toUpperCase()) || {}), sector: sector1 } },
                            sym2: { price: p2, tech: t2, info: { ...(sMap.get(sym2.toUpperCase()) || {}), sector: sector2 } }
                        }
                    });
                }
            }
        } catch (e) {
            console.warn("Error fetching comparison data:", e);
        }
    }

    return { results, formattedText: textParts.join("\n") };
}

function formatSnapshotFacts(facts: any): string {
    if (!facts || typeof facts !== "object") return "";
    const lines: string[] = [];
    for (const [key, value] of Object.entries(facts)) {
        lines.push(`• ${key}: ${value}`);
    }
    return lines.join("\n");
}
