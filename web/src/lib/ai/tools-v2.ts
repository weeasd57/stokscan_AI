import { IntentPlan, ToolResult } from "./types";
import { AI_CONFIG } from "./config";
import { classificationMatchesSector } from "./sector-taxonomy";
import { searchWeb } from "./web-search";

function normalizeArabic(str: string): string {
    return str
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي")
        .replace(/ؤ/g, "و")
        .toLowerCase();
}

export const EGYPTIAN_MUTUAL_FUNDS: Record<string, { name: string; nameAr: string; type: string; category: "money_market" | "gold" | "equity" | "savings" | "index" }> = {
    "BMM": {
        name: "Beltone Money Market Fund",
        nameAr: "صندوق بلتون للسيولة النقدية (BMM)",
        type: "صندوق استثمار نقدي ذو عائد يومي تراكمي للسيولة والتحوط (منخفض المخاطر)",
        category: "money_market"
    },
    "AZST": {
        name: "Azimut Opportunity Equity Fund",
        nameAr: "صندوق أزيموت لفرص الأسهم (AZST)",
        type: "صندوق استثمار في الأسهم المصرية",
        category: "equity"
    },
    "AZGD": {
        name: "Azimut Gold Fund",
        nameAr: "صندوق أزيموت للذهب (AZGD)",
        type: "صندوق استثمار في الذهب والمعادن النفيسة",
        category: "gold"
    },
    "AZSD": {
        name: "Azimut Savings Fund",
        nameAr: "صندوق أزيموت للادخار (AZSD)",
        type: "صندوق ادخار ذو عائد ثابت",
        category: "savings"
    },
    "AZEM": {
        name: "Azimut Egypt Fund",
        nameAr: "صندوق أزيموت مصر (AZEM)",
        type: "صندوق استثمار في الأسهم",
        category: "equity"
    },
    "CI30": {
        name: "CI30 Index Fund",
        nameAr: "صندوق مؤشر سي آي كابيتال EGX30 (CI30)",
        type: "صندوق مؤشرات متداول يتبع مؤشر EGX30",
        category: "index"
    },
    "EGFD": {
        name: "EFG Hermes Money Market",
        nameAr: "صندوق إي إف جي هيرميس للسيولة النقدية",
        type: "صندوق نقد للسيولة ذو عائد يومي",
        category: "money_market"
    },
};

// Symbols that are indices, currencies, funds, or non-stock entities — must never appear in stock rankings
const NON_EQUITY_SYMBOLS = new Set([
    "USD", "USDEGP", "USDMXN", "USDEUR", "USDGBP",
    "EGX30", "EGX70", "EGX100", "EGX", "INDEX",
    "TASI", "DFM", "ADX", "QE", "MSM",
    ...Object.keys(EGYPTIAN_MUTUAL_FUNDS)
]);

export interface StructuredToolOutput {
    results: ToolResult[];
    formattedText: string;
}

export async function executeStructuredTools(
    supabase: any,
    plan: IntentPlan,
    apiKeys: string[],
    userId: string = "",
    sessionId: string = "",
    userMessage: string = "",
    history: Array<{ role: string; content: string }> = []
): Promise<StructuredToolOutput> {
    const results: ToolResult[] = [];
    const textParts: string[] = [];

    const now = new Date().toISOString();
    const symbols = plan.entities.symbols || [];
    const requestedDate = plan.entities.requested_date || null;
    const requestedStartDate = plan.entities.requested_start_date || null;
    const requestedEndDate = plan.entities.requested_end_date || null;
    const excludedSectors = (plan.entities.excluded_sectors || []).map(normalizeArabic);

    // Explicit count requests ("أقوى 5 أسهم", "أرخص 10 أسهم", "أول 3 أسهم") cap every list,
    // otherwise rankings fall back to their default depths. Arabic-Indic digits (٥٠)
    // are normalized to ASCII before matching.
    const countInput = userMessage.replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const countMatch = countInput.match(/(?:^|[\s،,])(\d{1,2})\s*(?:سهم|سمهم|أسهم|اسهم|شرك[هة]|سهما|أسهما)(?:[\s،,.]|$)/);
    const requestedCount = countMatch ? Math.min(Math.max(parseInt(countMatch[1], 10), 1), 50) : null;

    const isExcludedSector = (value: unknown): boolean => {
        if (!excludedSectors.length) return false;
        return (plan.entities.excluded_sectors || []).some(excluded => classificationMatchesSector(value, excluded));
    };

    const dataDateQuality = (date: unknown, maxAgeDays: number, requested: string | null = null) => {
        const value = String(date || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, reason: "missing_date" };
        if (requested && value !== requested) return { ok: false, reason: "date_mismatch" };
        const ageDays = Math.floor((Date.now() - Date.parse(`${value}T23:59:59Z`)) / 86400000);
        return { ok: ageDays <= maxAgeDays, reason: ageDays <= maxAgeDays ? null : "stale", ageDays };
    };

    if (plan.tools.includes("get_price_history")) {
        if (symbols.length === 0) {
            try {
                const { data: latestDateRow } = await supabase.from("stock_prices").select("date").order("date", { ascending: false }).limit(1);
                const latestDate = latestDateRow?.[0]?.date || "2026-08-13";
                const isWtd = /(?:اسبوع|wtd)/i.test(userMessage) || /(?:اسبوع|wtd)/i.test(plan.entities?.requested_date || "") || plan.entities?.requested_date === "wtd";
                const isMtd = !isWtd && (/(?:شهر|mtd)/i.test(userMessage) || /(?:شهر|mtd)/i.test(plan.entities?.requested_date || "") || plan.entities?.requested_date === "mtd");
                
                let startGte = "2026-01-01";
                let startLte = "2026-01-10";
                let periodType = "YTD";
                let periodLabel = "من بداية العام 2026 (YTD)";
                let startPeriod = "2026-01-04";

                const currentMonthPrefix = latestDate.slice(0, 7);
                if (isWtd) {
                    const dateObj = new Date(latestDate);
                    const day = dateObj.getDay();
                    const sunday = new Date(dateObj);
                    sunday.setDate(dateObj.getDate() - day);
                    const sunStr = sunday.toISOString().split("T")[0];

                    const { data: wRow } = await supabase.from("stock_prices")
                        .select("date")
                        .gte("date", sunStr)
                        .order("date", { ascending: true })
                        .limit(1);
                    const wStart = wRow?.[0]?.date || sunStr;
                    
                    startGte = wStart;
                    const lteDate = new Date(wStart);
                    lteDate.setDate(lteDate.getDate() + 2);
                    startLte = lteDate.toISOString().split("T")[0];
                    periodType = "WTD";
                    periodLabel = `من بداية الأسبوع الحالي (${wStart}) حتى ${latestDate}`;
                    startPeriod = wStart;
                } else if (isMtd) {
                    const { data: mRow } = await supabase.from("stock_prices")
                        .select("date")
                        .gte("date", currentMonthPrefix + "-01")
                        .order("date", { ascending: true })
                        .limit(1);
                    const mStart = mRow?.[0]?.date || (currentMonthPrefix + "-01");
                    startGte = mStart;
                    startLte = currentMonthPrefix + "-07";
                    periodType = "MTD";
                    periodLabel = `من بداية الشهر الحالي (${currentMonthPrefix}) حتى ${latestDate}`;
                    startPeriod = mStart;
                }

                const { data: startPrices } = await supabase.from("stock_prices")
                    .select("symbol, close, date")
                    .gte("date", startGte)
                    .lte("date", startLte);
                const { data: endPrices } = await supabase.from("stock_prices")
                    .select("symbol, close, date, volume")
                    .eq("date", latestDate);
                const { data: stocksData } = await supabase.from("stocks").select("symbol, name");
                const sMap = new Map((stocksData || []).map((s: any) => [s.symbol, s.name]));

                const startMap = new Map();
                (startPrices || []).forEach((p: any) => {
                    if (!startMap.has(p.symbol)) startMap.set(p.symbol, Number(p.close));
                });

                const wantsLiquidity = /(?:سيول|تداول|حجم)/i.test(userMessage);
                const wantsLowest = /(?:اقل|أقل|ارخص|أرخص|ادنى|أدنى)/i.test(userMessage);
                const wantsCheapest = /(?:ارخص|أرخص)/i.test(userMessage)
                    || /(?:اقل|أقل|ادنى|أدنى|اخفض|أخفض).{0,15}(?:سعر|سعرا)/i.test(userMessage)
                    || /(?:سعر).{0,10}(?:اقل|أقل|ادنى|أدنى|اخفض|أخفض)/i.test(userMessage);

                const rankingList = (endPrices || []).map((p: any) => {
                    const sClose = startMap.get(p.symbol);
                    if (!sClose || sClose <= 0) return null;
                    const retPct = ((Number(p.close) - sClose) / sClose) * 100;
                    const liquidity = Number(p.close) * Number(p.volume || 0);
                    return {
                        symbol: p.symbol,
                        name: sMap.get(p.symbol) || p.symbol,
                        start_price: Number(sClose).toFixed(2),
                        current_price: Number(p.close).toFixed(2),
                        return_pct: Number(retPct.toFixed(2)),
                        ytd_return_pct: Number(retPct.toFixed(2)),
                        mtd_return_pct: Number(retPct.toFixed(2)),
                        volume: Number(p.volume || 0),
                        liquidity: liquidity
                    };
                }).filter(Boolean).filter((r: any) => !NON_EQUITY_SYMBOLS.has(r.symbol));

                if (wantsCheapest) {
                    rankingList.sort((a: any, b: any) => Number(a.current_price) - Number(b.current_price));
                } else if (wantsLiquidity) {
                    if (wantsLowest) {
                        rankingList.sort((a: any, b: any) => a.liquidity - b.liquidity);
                    } else {
                        rankingList.sort((a: any, b: any) => b.liquidity - a.liquidity);
                    }
                } else {
                    if (wantsLowest) {
                        rankingList.sort((a: any, b: any) => a.return_pct - b.return_pct);
                    } else {
                        rankingList.sort((a: any, b: any) => b.return_pct - a.return_pct);
                    }
                }

                const rankingToSave = rankingList.slice(0, requestedCount || 100);
                if (rankingToSave.length > 0) {
                    const orderLabel = wantsCheapest ? "الأرخص" : wantsLowest ? "الأقل" : "الأعلى";
                    const metricLabel = wantsCheapest ? "سعر السهم" : wantsLiquidity ? "سيولة وتداول" : "ربحية وأداءً";
                    textParts.push(`\n [جدول ترتيب ${orderLabel} الأسهم من حيث ${metricLabel} بالبورصة المصرية ${periodLabel}]:\n`);
                    const colHeaderName = wantsCheapest ? "سعر الإغلاق (ج.م)" : wantsLiquidity ? "السيولة (قيمة التداول)" : "نسبة التغيير";
                    textParts.push(`| # | الرمز | اسم الشركة | السعر الحالي | سعر بداية الفترة | ${colHeaderName} |`);
                    textParts.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);
                    rankingToSave.forEach((s: any, idx: number) => {
                        let metricVal = "";
                        if (wantsCheapest) {
                            metricVal = `${Number(s.current_price).toFixed(2)} ج.م`;
                        } else if (wantsLiquidity) {
                            const liqM = Number(s.liquidity || 0);
                            if (liqM >= 1_000_000) {
                                metricVal = `${(liqM / 1_000_000).toFixed(2)} مليون ج.م`;
                            } else if (liqM >= 1_000) {
                                metricVal = `${(liqM / 1_000).toFixed(2)} ألف ج.م`;
                            } else {
                                metricVal = `${liqM.toFixed(2)} ج.م`;
                            }
                        } else {
                            const sign = Number(s.return_pct) >= 0 ? "+" : "";
                            metricVal = `${sign}${s.return_pct}%`;
                        }
                        textParts.push(`| ${idx + 1} | ${s.symbol} | ${s.name} | ${s.current_price} ج.م | ${s.start_price} ج.م | ${metricVal} |`);
                    });
                    results.push({
                        tool: "get_price_history",
                        source: "stock_prices",
                        data_time: latestDate,
                        symbols: rankingToSave.map((s: any) => s.symbol),
                        data_type: "historical",
                        data: {
                            market_period_ranking: rankingToSave,
                            market_ytd_ranking: rankingToSave,
                            period_type: periodType,
                            period_label: periodLabel,
                            total_scanned: rankingList.length,
                            start_period: startPeriod,
                            end_date: latestDate,
                            wants_liquidity: wantsLiquidity,
                            wants_lowest: wantsLowest
                        }
                    });
                }
            } catch (err) {
                console.warn("Error calculating market period performance:", err);
            }
        }
        for (const symbol of symbols) {
            const { data: rows } = await supabase.from("stock_prices")
                .select("date,open,high,low,close")
                .eq("exchange", AI_CONFIG.tools.defaultExchange)
                .ilike("symbol", symbol)
                .order("date", { ascending: false })
                .limit(250);
            const prices = rows || [];
            if (!prices.length) {
                results.push({ tool: "get_price_history", source: "empty", data_time: now, symbols: [symbol], data_type: "historical", data: {} });
                continue;
            }
            const latest = prices[0];
            const highest = prices.reduce((best: any, row: any) => Number(row.high) > Number(best.high) ? row : best, prices[0]);
            const previous = prices[1] || null;
            const recentFive = prices.slice(0, 5).map((row: any, idx: number) => {
                const prev = prices[idx + 1];
                const changePct = prev && prev.close ? (((Number(row.close) - Number(prev.close)) / Number(prev.close)) * 100).toFixed(2) + "%" : "N/A";
                return {
                    date: row.date,
                    close: Number(row.close),
                    change_pct: changePct,
                    high: Number(row.high),
                    low: Number(row.low)
                };
            });
            const recentFifteen = prices.slice(0, 15).map((row: any, idx: number) => {
                const prev = prices[idx + 1];
                const changePct = prev && prev.close ? (((Number(row.close) - Number(prev.close)) / Number(prev.close)) * 100).toFixed(2) + "%" : "N/A";
                return {
                    date: row.date,
                    close: Number(row.close),
                    change_pct: changePct,
                    high: Number(row.high),
                    low: Number(row.low)
                };
            });

            textParts.push(`\n [التاريخ السعري والتغير اليومي لسهم ${symbol} (آخر 5 جلسات)]:\n`);
            textParts.push(`| التاريخ | سعر الإغلاق | نسبة التغير اليومي | أعلى سعر | أدنى سعر |`);
            textParts.push(`| :--- | :--- | :--- | :--- | :--- |`);
            recentFive.forEach((s: any) => {
                textParts.push(`| ${s.date} | ${s.close} ج.م | ${s.change_pct} | ${s.high} | ${s.low} |`);
            });

            results.push({ tool: "get_price_history", source: "stock_prices", data_time: latest.date, symbols: [symbol], data_type: "historical", data: { symbol, latest, previous_close: previous?.close ?? null, recent_5_sessions: recentFive, recent_15_sessions: recentFifteen, highest_250_sessions: { price: highest.high, date: highest.date } } });
        }
    }

    const resolveSectorSymbols = async (): Promise<string[]> => {
        const targetSector = plan.entities.sector;
        if (!targetSector) return [];
        const { data: fundamentalsRows } = await supabase.from("stock_fundamentals").select("symbol, data").eq("exchange", "EGX").limit(1000);
        const normalizedTarget = targetSector.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/^ال/, "");
        const terms: Record<string, string[]> = {
            "بنوك": ["bank", "banking", "finance", "financial"],
            "ادويه": ["pharma", "pharmaceutical", "health technology", "health services", "health"],
            "عقارات": ["real estate", "homebuilding", "consumer durables", "durables", "housing", "development", "construction"],
            "استصلاح اراضي": ["reclamation", "land", "agriculture", "agricultural", "farming", "crop", "استصلاح", "اراضي", "زراعة", "زراعي"],
            "استصلاح": ["reclamation", "land", "agriculture", "agricultural", "farming", "crop", "استصلاح", "اراضي", "زراعة", "زراعي"],
            "اراضي": ["reclamation", "land", "agriculture", "agricultural", "farming", "crop", "استصلاح", "اراضي", "زراعة", "زراعي"],
            "زراعة": ["reclamation", "land", "agriculture", "agricultural", "farming", "crop", "استصلاح", "اراضي", "زراعة", "زراعي"],
            "اغذيه": ["food", "beverage", "consumer non-durables", "agriculture"],
            "بترول": ["oil", "gas", "petroleum", "energy minerals", "energy"],
            "بناء": ["building", "non-energy minerals", "construction", "materials"],
            "مواد بناء وتعدين": ["non-energy minerals", "building", "construction", "materials", "cement", "steel", "mining"],
            "سياحه": ["tourism", "travel", "consumer services", "hotel"],
            "اتصالات": ["telecom", "telecommunications", "communications", "technology services"]
        };
        const searchTerms = terms[normalizedTarget] || [normalizedTarget, targetSector.toLowerCase()];
        return (fundamentalsRows || []).filter((row: any) => {
            const raw = typeof row.data === "string" ? (() => { try { return JSON.parse(row.data); } catch { return {}; } })() : row.data || {};
            const classification = `${raw.sector || raw.Sector || ""} ${raw.industry || raw.Industry || ""} ${raw.sector_ar || raw.SectorAr || ""}`.toLowerCase();
            return searchTerms.some(term => classification.includes(term));
        }).map((row: any) => String(row.symbol).toUpperCase());
    };

    if (!plan.needs_live_data && !plan.needs_historical_data) {
        return { results, formattedText: "" };
    }

    // ===== MARKET-WIDE TECHNICAL VALUATION SCAN =====
    if (plan.tools.includes("get_fair_value_scan")) {
        try {
            const fairValueDirection = plan.entities.fair_value_direction || "above";
            const requireDistribution = Boolean(plan.entities.require_distribution);
            const requireAccumulation = Boolean(plan.entities.require_accumulation);
            let techQuery = supabase.from("stock_technical_indicators")
                .select("symbol, close, rsi_14, change_pct, volume, vol_sma20, date")
                .order("date", { ascending: false })
                .limit(1000);
            if (requestedDate) techQuery = techQuery.eq("date", requestedDate);
            const { data: techRows } = await techQuery;
            const dataDate = requestedDate || techRows?.[0]?.date || now.slice(0, 10);
            const requestedSymbols = new Set(symbols.map(symbol => symbol.toUpperCase()));
            const latestRows = (techRows || []).filter((row: any) =>
                row.date === dataDate
                && Number.isFinite(Number(row.close))
                && (!requestedSymbols.size || requestedSymbols.has(String(row.symbol || "").toUpperCase()))
            );
            const quality = dataDateQuality(dataDate, requestedDate ? 3650 : 3, requestedDate);
            if (!quality.ok) {
                results.push({ tool: "get_fair_value_scan", source: "validation", data_time: dataDate, symbols: [], data_type: requestedDate ? "historical" : "live", data: { stocks: [], validation: quality } });
                textParts.push(`[مسح التقييم]: البيانات غير صالحة للعرض (${quality.reason}).`);
                return { results, formattedText: textParts.join("\n") };
            }
            const latestSymbols = Array.from(new Set(latestRows.map((row: any) => String(row.symbol).toUpperCase())));
            const { data: priceRows } = await supabase.from("stock_prices")
                .select("symbol, close, high, low, date")
                .eq("exchange", AI_CONFIG.tools.defaultExchange)
                .in("symbol", latestSymbols)
                .lte("date", dataDate)
                .order("date", { ascending: false })
                .limit(20000);
            const distributionBySymbol = new Map<string, any>();
            if (requireDistribution || requireAccumulation) {
                const distributionQuery = supabase.from("stock_scans_summary")
                    .select("symbol, scan_date, signal, acc_score, dist_score, consecutive_acc_days, consecutive_dist_days")
                    .lte("scan_date", dataDate)
                    .order("scan_date", { ascending: false })
                    .limit(5000);
                const { data: distributionRows } = await distributionQuery;
                (distributionRows || []).forEach((row: any) => {
                    const symbol = String(row.symbol || "").toUpperCase();
                    if (symbol && !distributionBySymbol.has(symbol)) distributionBySymbol.set(symbol, row);
                });
            }
            const excludedSectorsList = plan.entities.excluded_sectors || [];
            const fundamentalsMap = new Map<string, string>();
            if (excludedSectorsList.length > 0) {
                const { data: fundRows } = await supabase.from("stock_fundamentals")
                    .select("symbol, data")
                    .eq("exchange", AI_CONFIG.tools.defaultExchange)
                    .limit(1000);
                (fundRows || []).forEach((row: any) => {
                    const raw = typeof row.data === "string" ? (() => { try { return JSON.parse(row.data); } catch { return {}; } })() : row.data || {};
                    const classification = `${raw.sector || raw.Sector || ""} ${raw.industry || raw.Industry || ""} ${raw.sector_ar || raw.SectorAr || ""} ${raw.name || ""}`.toLowerCase();
                    fundamentalsMap.set(String(row.symbol).toUpperCase(), classification);
                });
            }

            const pricesBySymbol = new Map<string, any[]>();
            (priceRows || []).forEach((price: any) => {
                const key = String(price.symbol || "").toUpperCase();
                const rows = pricesBySymbol.get(key) || [];
                if (rows.length < 60) rows.push(price);
                pricesBySymbol.set(key, rows);
            });
            const candidates = latestRows.map((row: any) => {
                const symbol = String(row.symbol).toUpperCase();
                if (excludedSectorsList.length > 0) {
                    const classification = fundamentalsMap.get(symbol);
                    if (!classification) return null;
                    if (isExcludedSector(classification)) return null;
                }
                const prices = pricesBySymbol.get(symbol) || [];
                if (!prices.length) return null;
                const support = Math.min(...prices.map((price: any) => Number(price.low ?? price.close)));
                const resistance = Math.max(...prices.map((price: any) => Number(price.high ?? price.close)));
                const midpoint = (support + resistance) / 2;
                const close = Number(row.close);
                if (![support, resistance, midpoint, close].every(Number.isFinite)) return null;
                if (fairValueDirection === "above" && close <= midpoint) return null;
                if (fairValueDirection === "below" && close >= midpoint) return null;
                const distribution = distributionBySymbol.get(symbol);
                const scanDate = String(distribution?.scan_date || "").slice(0, 10);
                const scanAgeDays = scanDate ? Math.floor((Date.parse(`${dataDate}T23:59:59Z`) - Date.parse(`${scanDate}T23:59:59Z`)) / 86400000) : Number.POSITIVE_INFINITY;
                const isDistribution = distribution?.signal === "distribution" || Number(distribution?.dist_score || 0) >= 50;
                const isAccumulation = distribution?.signal === "accumulation" || distribution?.signal === "strong_accumulation" || Number(distribution?.acc_score || 0) >= 50;
                // A fair-value scan explicitly requesting accumulation/distribution needs a
                // current technical signal; a stale signal must not qualify the stock.
                if (requireDistribution && (!isDistribution || scanAgeDays > 30)) return null;
                if (requireAccumulation && (!isAccumulation || scanAgeDays > 30)) return null;
                return {
                    symbol, close, support, resistance, midpoint,
                    premium_pct: midpoint > 0 ? ((close / midpoint) - 1) * 100 : null,
                    rsi_14: row.rsi_14,
                    change_pct: row.change_pct,
                    vol_ratio: Number(row.vol_sma20) > 0 ? Number(row.volume) / Number(row.vol_sma20) : null,
                    dist_score: distribution?.dist_score ?? null,
                    acc_score: distribution?.acc_score ?? null,
                    consecutive_acc_days: distribution?.consecutive_acc_days ?? null,
                    consecutive_dist_days: distribution?.consecutive_dist_days ?? null,
                    scan_date: scanDate || null
                };
            });
            const stocks = candidates.filter(Boolean)
                .sort((a: any, b: any) => fairValueDirection === "above"
                    ? Number(b.premium_pct) - Number(a.premium_pct)
                    : Number(a.premium_pct) - Number(b.premium_pct))
                .slice(0, 30);
            const relation = fairValueDirection === "above" ? "above" : "below";
            const source = requireDistribution || requireAccumulation ? "stock_prices+stock_scans_summary" : "stock_prices";
            results.push({ tool: "get_fair_value_scan", source, data_time: dataDate, symbols: stocks.map((stock: any) => stock.symbol), data_type: requestedDate ? "historical" : "live", data: { metric: `price_${relation}_60_session_midpoint`, direction: fairValueDirection, require_distribution: requireDistribution, require_accumulation: requireAccumulation, excluded_sectors: excludedSectorsList, stocks } });
            textParts.push(`[مسح التقييم الفني السوقي بتاريخ ${dataDate}]: ${stocks.length} سهم ${fairValueDirection === "above" ? "فوق" : "تحت"} القيمة الوسطية لنطاق 60 جلسة${requireDistribution ? " مع إشارة تصريف" : requireAccumulation ? " مع إشارة تجميع" : ""}.`);
        } catch (e) {
            console.warn("Error computing fair-value scan:", e);
            results.push({ tool: "get_fair_value_scan", source: "error", data_time: now, symbols: [], data_type: requestedDate ? "historical" : "live", data: { direction: plan.entities.fair_value_direction || "above", require_distribution: Boolean(plan.entities.require_distribution), require_accumulation: Boolean(plan.entities.require_accumulation), stocks: [] }, error: "تعذر إكمال تقاطع بيانات الأسعار والمسح الفني ضمن المهلة." });
        }
    }

    // ===== HISTORICAL RECALL =====
    if (plan.intent === "historical_recall" && !plan.tools.includes("get_recommendations") && !plan.tools.includes("get_signals")) {
        const requestedDate = plan.entities.requested_date;
        if (symbols.length === 0 && requestedDate) {
            try {
                const { data: scans } = await supabase
                    .from("stock_scans_summary")
                    .select("symbol, scan_date, signal, acc_score, dist_score, vol_ratio, change_pct, rsi_14, macd_signal, consecutive_acc_days")
                    .eq("scan_date", requestedDate)
                    .order("acc_score", { ascending: false })
                    .limit(15);
                const rows = (scans || []).filter((row: any) => Number(row.acc_score || 0) >= 50 || row.signal === "accumulation");
                results.push({
                    tool: "get_accumulation_stocks",
                    source: rows.length ? "stock_scans_summary" : "empty",
                    data_time: requestedDate,
                    symbols: rows.map((row: any) => row.symbol),
                    data_type: "historical",
                    data: rows.length ? { stocks: rows, date: requestedDate } : {}
                });
                return { results, formattedText: rows.length ? `[مسح السيولة التاريخي بتاريخ ${requestedDate}]` : `[مسح السيولة التاريخي]: لا توجد بيانات مسح مسجلة بتاريخ ${requestedDate}.` };
            } catch (e) {
                console.warn("Error fetching dated accumulation scan:", e);
                return { results, formattedText: `[مسح السيولة التاريخي]: تعذر جلب بيانات ${requestedDate}.` };
            }
        }
        if (symbols.length === 0) {
            return { results, formattedText: "[بيانات تاريخية]: يلزم تحديد السهم أو الإشارة إليه بوضوح." };
        }
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
            }
            if (requestedDate) query = query.eq("as_of", requestedDate);

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
                // Facts may be unavailable when the insert was blocked by RLS. Use the
                // prior assistant message as a bounded, explicitly historical fallback.
                let priorQuery = supabase
                    .from("ai_chat_messages")
                    .select("content, created_at")
                    .eq("role", "assistant")
                    .order("created_at", { ascending: false })
                    .limit(1);
                if (userId) priorQuery = priorQuery.eq("user_id", userId);
                if (sessionId) priorQuery = priorQuery.eq("session_id", sessionId);
                const { data: priorMessages } = await priorQuery;
                const prior = priorMessages?.[0];
                if (prior?.content) {
                    textParts.push(`\n [آخر رد سابق موثق - ${prior.created_at || "تاريخ غير محدد"}]:`);
                    textParts.push(String(prior.content).slice(0, 6000));
                    results.push({
                        tool: "get_historical_facts",
                        source: "prior_assistant_message",
                        data_time: prior.created_at || now,
                        symbols,
                        data_type: "historical",
                        data: { prior_response: String(prior.content).slice(0, 6000) }
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
            }
        } catch (e) {
            console.warn("Error fetching historical facts:", e);
        }
        return { results, formattedText: textParts.join("\n") };
    }

    // ===== ACCUMULATION / DISTRIBUTION STOCKS =====
    const hasBothScanTools = plan.tools.includes("get_accumulation_stocks") && plan.tools.includes("get_distribution_stocks");
    const scanTool = hasBothScanTools
        ? "get_accumulation_stocks" // run once for both; direction handled below
        : plan.tools.includes("get_distribution_stocks")
            ? "get_distribution_stocks"
            : plan.tools.includes("get_accumulation_stocks")
                ? "get_accumulation_stocks"
                : null;
    if (scanTool) {
        // For "both" mode we run accumulation query and use scan_rows for distribution too
        const scanDirections: Array<"accumulation" | "distribution"> = hasBothScanTools
            ? ["accumulation", "distribution"]
            : [scanTool === "get_distribution_stocks" ? "distribution" : "accumulation"];

        try {
                let summaryQuery = supabase
                    .from("stock_scans_summary")
                .select("symbol, scan_date, signal, wyckoff_phase, acc_score, dist_score, vol_ratio, consecutive_acc_days, consecutive_dist_days, change_pct, volume, rsi_14, macd_signal")
                .order("scan_date", { ascending: false })
                .order("acc_score", { ascending: false })
                    .limit(200);
                if (requestedDate) summaryQuery = summaryQuery.eq("scan_date", requestedDate);
                const compoundMarketScan = plan.tools.includes("get_stock") && (plan.tools.includes("get_accumulation_stocks") || plan.tools.includes("get_distribution_stocks"));
                const asksForMarketWideList = /(?:الأسهم|الاسهم|أسهم|اسهم|قائمة|قائمه|شاشه|شاشة)\s+(?:التجميع|التصريف|تجميع|تصريف)/i.test(userMessage)
                    || /(?:أقوى|اقوى|أفضل|افضل|أعلى|اعلى|أرخص|ارخص)\s+(?:الأسهم|الاسهم|أسهم|اسهم)/i.test(userMessage)
                    || /(?:بالاسهم|بالأسهم).{0,20}(?:تجميع|تصريف|منطقه|منطقة)/i.test(userMessage)
                    || /(?:ايه|اي|فين|هل في|هل فيه).{0,12}(?:اسهم|أسهم).{0,15}(?:تجميع|تصريف)/i.test(userMessage)
                    || /(?:منطقه|منطقة|فرص)\s+(?:تجميع|تصريف)/i.test(userMessage)
                    || /(?:اسهم|أسهم).{0,10}(?:تجميع|تصريف)/i.test(userMessage);
                const scopedSymbols = (compoundMarketScan && asksForMarketWideList) ? [] : symbols.length > 0 ? symbols : await resolveSectorSymbols();
                if (scopedSymbols.length > 0) summaryQuery = summaryQuery.in("symbol", scopedSymbols);
                const { data: summaryScans } = await summaryQuery;

            let hasSummaryData = false;

            if (summaryScans && summaryScans.length > 0) {
                const maxDate = requestedDate || summaryScans[0].scan_date;
                const todayScans = summaryScans.filter((r: any) => r.scan_date === maxDate);
                const scanQuality = requestedDate
                    ? { ok: true, reason: null }
                    : dataDateQuality(maxDate, 7);

                // Fetch stock names for results
                const allSymbolsList = Array.from(new Set(todayScans.map((r: any) => r.symbol)));
                const { data: stocksData } = await supabase
                    .from("stocks")
                    .select("symbol, name")
                    .in("symbol", allSymbolsList);
                const stocksMap = new Map<string, string>();
                (stocksData || []).forEach((s: any) => {
                    if (s?.symbol) stocksMap.set(s.symbol, s.name || s.symbol);
                });

                if (todayScans.length > 0) {
                    hasSummaryData = true;
                    const isStale = !scanQuality.ok;

                    // Process each direction (accumulation and/or distribution)
                    for (const direction of scanDirections) {
                        const scoreField = direction === "distribution" ? "dist_score" : "acc_score";
                        const consecutiveField = direction === "distribution" ? "consecutive_dist_days" : "consecutive_acc_days";
                        const directionAr = direction === "distribution" ? "التصريف" : "التجميع";
                        const currentScanTool = direction === "distribution" ? "get_distribution_stocks" : "get_accumulation_stocks";

                        const strictAccumulation = direction === "accumulation" && plan.entities.min_acc_score != null;
                        const matchingStocks = todayScans
                            .filter((r: any) => {
                                if (!strictAccumulation) return r.signal === direction || Number(r[scoreField] || 0) >= 50;
                                return Number(r.acc_score || 0) > Number(plan.entities.min_acc_score)
                                    && Number(r.vol_ratio || 0) > Number(plan.entities.min_vol_ratio)
                                    && Number(r.dist_score || 0) <= Number(plan.entities.max_dist_score)
                                    && Number(r.consecutive_acc_days || 0) >= Number(plan.entities.min_consecutive_acc_days);
                            })
                            .sort((a: any, b: any) => Number(b[scoreField] || 0) - Number(a[scoreField] || 0));

                        const displayedStocks = (symbols.length > 0 || plan.entities.sector)
                            ? matchingStocks
                            : matchingStocks.slice(0, requestedCount || 15);
                        const stocksWithNames = displayedStocks.map((r: any) => ({
                            ...r,
                            name: stocksMap.get(r.symbol) || r.symbol
                        }));

                        const staleNote = isStale ? ` (أحدث مسح مسجل — يُرجى الإشارة للتاريخ)` : "";
                        if (displayedStocks.length > 0) {
                            textParts.push(`\n [بيانات مسح ${directionAr} بتاريخ ${maxDate}${staleNote}]:\n`);
                            displayedStocks.forEach((r: any, idx: number) => {
                                const name = stocksMap.get(r.symbol) || r.symbol;
                                const changeStr = Number(r.change_pct || 0) >= 0 ? `+${Number(r.change_pct).toFixed(2)}%` : `${Number(r.change_pct).toFixed(2)}%`;
                                const consecutiveDays = Number(r[consecutiveField] || 0);
                                const consecStr = consecutiveDays > 1 ? ` | ${directionAr} لـ ${consecutiveDays} أيام متتالية` : "";
                                const accScoreStr = r.acc_score != null ? `${r.acc_score}` : "0";
                                const distScoreStr = r.dist_score != null ? `${r.dist_score}` : "0";
                                textParts.push(`• ${idx + 1}. سهم ${r.symbol} (${name}): درجة التجميع (acc_score) = ${accScoreStr}/100 | درجة التصريف (dist_score) = ${distScoreStr}/100 | نسبة الحجم = ${r.vol_ratio}x | التغير = ${changeStr}${consecStr} | Wyckoff: ${r.wyckoff_phase || "N/A"}`);
                            });
                            results.push({
                                tool: currentScanTool,
                                source: "stock_scans_summary",
                                data_time: maxDate,
                                symbols: displayedStocks.map((r: any) => r.symbol),
                                data_type: isStale ? "historical" : (requestedDate ? "historical" : "live"),
                                // IMPORTANT: only pass direction-matched stocks as scan_rows.
                                // Passing all todayScans (neutral rows) causes the LLM to hallucinate
                                // wrong-direction claims for neutral stocks, triggering the validator.
                                data: { stocks: stocksWithNames, scan_rows: stocksWithNames, date: maxDate, direction, stale_served: isStale }
                            });
                        } else {
                            // No stocks found for this direction — push empty result with NO scan_rows.
                            // Do NOT pass todayScans here — it causes LLM to pick neutral stocks and
                            // claim they are accumulation/distribution, triggering validator errors.
                            textParts.push(`\n [مسح ${directionAr} بتاريخ ${maxDate}]: ⛔ لا توجد أسهم ${directionAr} في هذا المسح — لا يجوز ادعاء ${directionAr} لأي سهم.`);
                            results.push({
                                tool: currentScanTool,
                                source: "stock_scans_summary",
                                data_time: maxDate,
                                symbols: [],
                                data_type: isStale ? "historical" : (requestedDate ? "historical" : "live"),
                                data: { stocks: [], scan_rows: [], date: maxDate, direction, message: `No ${direction} stocks detected in scan (${maxDate}). Do NOT claim any stock is in ${direction}.` }
                            });
                        }
                    }
                }
            }

            if (!hasSummaryData) {
                // Fallback: compute from stock_technical_indicators using the primary direction
                const fallbackDirection = scanDirections[0];
                const fallbackScoreField = fallbackDirection === "distribution" ? "dist_score" : "acc_score";
                const fallbackDirectionAr = fallbackDirection === "distribution" ? "التصريف" : "التجميع";
                let technicalQuery = supabase
                    .from("stock_technical_indicators")
                    .select("symbol, change_pct, volume, vol_sma20, r_vol, rsi_14, macd, macd_signal, macd_histogram, close, sma_20, date, rsi_divergence, macd_divergence, stoch_divergence")
                    .order("date", { ascending: false })
                    .limit(400);
                if (requestedDate) technicalQuery = technicalQuery.eq("date", requestedDate);
                if (symbols.length > 0) technicalQuery = technicalQuery.in("symbol", symbols);
                const { data: latestTechs } = await technicalQuery;

                if (latestTechs && latestTechs.length > 0) {
                    const maxDate = latestTechs[0].date;
                    const todayTechs = latestTechs.filter((r: any) => r.date === maxDate);

                    const symbolsList = Array.from(new Set(todayTechs.map((r: any) => r.symbol)));
                    const { data: stocksData } = await supabase
                        .from("stocks")
                        .select("symbol, name")
                        .in("symbol", symbolsList);
                    const stocksMap = new Map<string, string>();
                    (stocksData || []).forEach((s: any) => {
                        if (s?.symbol) stocksMap.set(s.symbol, s.name || s.symbol);
                    });

                    const computedStocks = todayTechs.map((t: any) => {
                        const rvol = t.r_vol || (t.vol_sma20 && Number(t.vol_sma20) > 0 ? Number(t.volume || 0) / Number(t.vol_sma20) : 1);
                        let score = 50;
                        if (fallbackDirection === "accumulation") {
                            if (rvol >= 1.2) score += 15;
                            else if (rvol >= 0.9) score += 10;
                            if (t.rsi_14 >= 45 && t.rsi_14 <= 68) score += 15;
                            if (t.macd && t.macd_signal && t.macd >= t.macd_signal) score += 10;
                            if (t.close >= (t.sma_20 || 0)) score += 10;
                        } else {
                            if (t.rsi_14 >= 70) score += 20;
                            if (t.rsi_divergence === "BEARISH" || t.macd_divergence === "BEARISH" || t.stoch_divergence === "BEARISH") score += 15;
                            if (t.macd && t.macd_signal && t.macd < t.macd_signal) score += 10;
                            if (rvol >= 1.2 && Number(t.change_pct) < 0) score += 15;
                        }
                        const finalScore = Math.min(score, 98);
                        return {
                            symbol: t.symbol,
                            name: stocksMap.get(t.symbol) || t.symbol,
                            scan_date: maxDate,
                            signal: fallbackDirection,
                            wyckoff_phase: fallbackDirection === "accumulation" ? "Accumulation" : "Distribution",
                            [fallbackScoreField]: finalScore,
                            acc_score: fallbackDirection === "accumulation" ? finalScore : 0,
                            dist_score: fallbackDirection === "distribution" ? finalScore : 0,
                            vol_ratio: Number(rvol).toFixed(2),
                            change_pct: t.change_pct != null ? Number(t.change_pct).toFixed(2) : "0.00",
                            rsi_14: t.rsi_14 != null ? Number(t.rsi_14).toFixed(2) : null,
                            close: t.close,
                            consecutive_acc_days: fallbackDirection === "accumulation" ? 1 : 0,
                            consecutive_dist_days: fallbackDirection === "distribution" ? 1 : 0
                        };
                    });

                    const filteredStocks = computedStocks
                        .filter((s: any) => symbols.length > 0 ? true : Number(s[fallbackScoreField]) >= 70)
                        .sort((a: any, b: any) => Number(b[fallbackScoreField]) - Number(a[fallbackScoreField]) || Number(b.vol_ratio) - Number(a.vol_ratio));

                    const displayedStocks = symbols.length > 0 ? filteredStocks : filteredStocks.slice(0, requestedCount || 15);

                    if (displayedStocks.length > 0) {
                        textParts.push(`\n [بيانات مسح ${fallbackDirectionAr} بالاستناد إلى المؤشرات الفنية والسيولة بتاريخ ${maxDate}]:\n`);
                        displayedStocks.forEach((r: any, idx: number) => {
                            const changeStr = Number(r.change_pct || 0) >= 0 ? `+${r.change_pct}%` : `${r.change_pct}%`;
                            textParts.push(`• ${idx + 1}. سهم ${r.symbol} (${r.name}): درجة ${fallbackDirectionAr} = ${r[fallbackScoreField]}/100 | نسبة الحجم = ${r.vol_ratio}x | RSI = ${r.rsi_14 || "N/A"} | التغير = ${changeStr}`);
                        });
                        results.push({
                            tool: scanTool,
                            source: "stock_technical_indicators",
                            data_time: maxDate,
                            symbols: displayedStocks.map((r: any) => r.symbol),
                            data_type: requestedDate ? "historical" : "live",
                            data: { stocks: displayedStocks, scan_rows: displayedStocks, date: maxDate, direction: fallbackDirection }
                        });
                    }
                }
            }

            if (!results.some(result => result.tool === scanTool || result.tool === "get_accumulation_stocks" || result.tool === "get_distribution_stocks")) {
                results.push({
                    tool: scanTool,
                    source: "empty",
                    data_time: requestedDate || now,
                    symbols,
                    data_type: requestedDate ? "historical" : "live",
                    data: {
                        stocks: [],
                        scan_rows: [],
                        technical_rows: [],
                        date: requestedDate,
                        direction: scanDirections[0],
                        message: "Insufficient scan data."
                    }
                });
            }
        } catch (e) {
            console.warn("Error fetching accumulation stocks:", e);
        }
    }

    // ===== LIVE STOCK DATA =====
    if (plan.needs_live_data && plan.tools.includes("get_stock") && symbols.length > 0) {
        try {
            const [pricesRes, techsRes, stocksRes, fundamentalsRes] = await Promise.all([
                Promise.all(
                    symbols.map(sym => {
                        let query = supabase.from("stock_prices")
                            .select("symbol, close, volume, date")
                            .ilike("symbol", sym)
                            .eq("exchange", "EGX");
                        if (requestedDate) query = query.eq("date", requestedDate);
                        return query.order("date", { ascending: false }).limit(1).maybeSingle();
                    })
                ),
                Promise.all(
                    symbols.map(sym => {
                        let query = supabase.from("stock_technical_indicators")
                            .select("symbol, close, rsi_14, macd_signal, change_pct, volume, vol_sma20, vwap_20, adx_14, momentum_10, date, sma_50, ema_50, sma_200, ema_200, bb_upper, bb_lower, stoch_k, stoch_d")
                            .ilike("symbol", sym)
                            .eq("exchange", "EGX");
                        if (requestedDate) query = query.eq("date", requestedDate);
                        return query.order("date", { ascending: false }).limit(1).maybeSingle();
                    })
                ),
                supabase.from("stocks").select("symbol, name").eq("exchange", "EGX").or(
                    symbols.map(s => `symbol.ilike.${s}`).join(",")
                ),
                supabase.from("stock_fundamentals").select("symbol, data").eq("exchange", "EGX").in("symbol", symbols)
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
            const fundamentalsMap = new Map<string, any>();
            (fundamentalsRes.data || []).forEach((row: any) => {
                if (row?.symbol) fundamentalsMap.set(String(row.symbol).toUpperCase(), row.data || {});
            });

            if (pricesMap.size > 0 || techsMap.size > 0) {
                textParts.push(`\n [بيانات السوق الحالية - ${now.split("T")[0]}]:\n`);
                symbols.forEach(sym => {
                    const upperSym = sym.toUpperCase();
                    const price = pricesMap.get(upperSym);
                    const tech = techsMap.get(upperSym);
                        const stockData: any = stocksMap.get(upperSym);
                        const fundamentals = fundamentalsMap.get(upperSym) || {};

                    if (price || tech) {
                        const priceData = price as any;
                        const techData = tech as any;
                        const closePrice = priceData?.close ?? techData?.close ?? "N/A";
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

                        const sma50 = techData?.sma_50 != null ? Number(techData.sma_50).toFixed(2) : "N/A";
                        const ema50 = techData?.ema_50 != null ? Number(techData.ema_50).toFixed(2) : "N/A";
                        const sma200 = techData?.sma_200 != null ? Number(techData.sma_200).toFixed(2) : "N/A";
                        const ema200 = techData?.ema_200 != null ? Number(techData.ema_200).toFixed(2) : "N/A";
                        const bbUpper = techData?.bb_upper != null ? Number(techData.bb_upper).toFixed(2) : "N/A";
                        const bbLower = techData?.bb_lower != null ? Number(techData.bb_lower).toFixed(2) : "N/A";
                        const stochK = techData?.stoch_k != null ? Number(techData.stoch_k).toFixed(2) : "N/A";
                        const stochD = techData?.stoch_d != null ? Number(techData.stoch_d).toFixed(2) : "N/A";

                        textParts.push(`• ${sym} (${stockData?.name || sym}): السعر = ${closePrice} ج.م, التغير = ${changeStr}, RSI = ${rsi}, MACD = ${macd}, SMA 50 = ${sma50}, EMA 50 = ${ema50}, SMA 200 = ${sma200}, EMA 200 = ${ema200}, Bollinger Upper = ${bbUpper}, Bollinger Lower = ${bbLower}, Stochastic %K = ${stochK}, Stochastic %D = ${stochD}, نسبة السيولة = ${volRatioStr}`);

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
                                vol_ratio: volRatioStr,
                                sma_50: sma50,
                                ema_50: ema50,
                                sma_200: sma200,
                                ema_200: ema200,
                                bb_upper: bbUpper,
                                bb_lower: bbLower,
                                stoch_k: stochK,
                                stoch_d: stochD,
                                market_cap: fundamentals.marketCap ?? fundamentals.market_cap ?? null,
                                eps: fundamentals.eps ?? null,
                                book_value_per_share: fundamentals.bookValuePerShare ?? fundamentals.book_value_per_share ?? null,
                                pe_ratio: fundamentals.peRatio ?? fundamentals.pe_ratio ?? null
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
    const needsGeneralMarketData = plan.tools.includes("get_market")
        || plan.tools.includes("get_indices")
        || (plan.intent === "market_summary" && plan.tools.length === 0);
    if (needsGeneralMarketData && plan.needs_live_data) {
        let usedCache = false;
        try {
            const { data: marketCache } = await supabase
                .from("market_cache")
                .select("payload")
                .eq("cache_key", `market_status_${AI_CONFIG.tools.defaultCountry}`)
                .maybeSingle();

            if (marketCache?.payload && !requestedDate) {
                usedCache = true;
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

        if (!usedCache || results.find(r => r.tool === "get_market")?.data?.top_gainers?.length === 0 || plan.tools.includes("get_market")) {
            // Complete the market cache with session-level movers from technical indicators.
            try {
                let techQuery = supabase
                    .from("stock_technical_indicators")
                    .select("symbol, change_pct, volume, vol_sma20, date")
                    .order("date", { ascending: false })
                    .limit(500);
                if (requestedDate) techQuery = techQuery.eq("date", requestedDate);
                const { data: latestTechs } = await techQuery;

            if (latestTechs && latestTechs.length > 0) {
                const maxTechDate = latestTechs[0].date;
                const todayTechs = latestTechs.filter((r: any) => r.date === maxTechDate && !NON_EQUITY_SYMBOLS.has(r.symbol));

                if (todayTechs.length > 0) {
                    let gainers = todayTechs
                        .filter((r: any) => Number(r.change_pct || 0) > 0)
                        .sort((a: any, b: any) => Number(b.change_pct || 0) - Number(a.change_pct || 0))
                        .slice(0, requestedCount || 10); // get top N

                    let losers = todayTechs
                        .filter((r: any) => Number(r.change_pct || 0) < 0)
                        .sort((a: any, b: any) => Number(a.change_pct || 0) - Number(b.change_pct || 0))
                        .slice(0, requestedCount || 10); // get top N

                    const moverSymbols = Array.from(new Set([...gainers, ...losers].map((r: any) => r.symbol)));
                    if (moverSymbols.length > 0) {
                        const { data: moverStocks } = await supabase.from('stocks').select('symbol, name').in('symbol', moverSymbols);
                        const moverNames = new Map<string, string>();
                        (moverStocks || []).forEach((s: any) => { if (s?.symbol) moverNames.set(s.symbol, s.name || s.symbol); });

                        gainers = gainers.map((r: any) => ({ ...r, name: moverNames.get(r.symbol) || r.symbol }));
                        losers = losers.map((r: any) => ({ ...r, name: moverNames.get(r.symbol) || r.symbol }));
                    }

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

                    // Update results array for other components like buildMarketLiquidityResponse
                    let marketResult = results.find(r => r.tool === "get_market");
                    if (!marketResult) {
                        marketResult = {
                            tool: "get_market",
                            source: "database",
                            data_time: maxTechDate,
                            symbols: ["EGX30", "USDEGP"],
                            data_type: "live",
                            data: {
                                egx30: null,
                                usd: null,
                                regime: null,
                                top_gainers: [],
                                top_losers: []
                            }
                        };
                        results.push(marketResult);
                    }
                    marketResult.data.top_gainers = gainers.map((g: any) => ({ symbol: g.symbol, name: g.name, change: g.change_pct }));
                    marketResult.data.top_losers = losers.map((l: any) => ({ symbol: l.symbol, name: l.name, change: l.change_pct }));
                }
            }
        } catch (e) {
            console.warn("Error computing top gainers/losers:", e);
        }
        }
    }

    // ===== NEWS =====
    if (plan.tools.includes("get_news")) {
        try {
            const articleRows: any[] = [];
            const lookbackDate = requestedStartDate ? new Date(`${requestedStartDate}T00:00:00Z`) : requestedDate ? new Date(`${requestedDate}T00:00:00Z`) : new Date();
            if (!requestedStartDate) lookbackDate.setDate(lookbackDate.getDate() - AI_CONFIG.tools.newsDaysLookback);
            const lookbackDateStr = lookbackDate.toISOString().split("T")[0];
            const scopedNewsSymbols = symbols.length > 0 ? symbols : await resolveSectorSymbols();
            let newsQuery = supabase
                .from("stock_news_sentiment")
                .select("symbol, date, sentiment_score, news_count, headlines")
                .eq("exchange", AI_CONFIG.tools.defaultExchange)
                .gte("date", lookbackDateStr)
                .gt("news_count", 0)
                .order("date", { ascending: false })
                .limit(AI_CONFIG.tools.newsLimit);

            if (scopedNewsSymbols.length > 0) {
                newsQuery = newsQuery.or(scopedNewsSymbols.map(s => `symbol.ilike.${s}`).join(","));
            }

            if (requestedDate) newsQuery = newsQuery.eq("date", requestedDate);
            if (requestedStartDate && requestedEndDate) newsQuery = newsQuery.gte("date", requestedStartDate).lte("date", requestedEndDate);
            const { data: newsData } = await newsQuery;

            if (newsData && newsData.length > 0) {
                const newsPeriodLabel = requestedStartDate && requestedEndDate
                    ? `الفترة من ${requestedStartDate} إلى ${requestedEndDate}`
                    : `آخر ${AI_CONFIG.tools.newsDaysLookback} أيام`;
                textParts.push(`\n [أخبار وتحليلات المعنويات للأسهم - ${newsPeriodLabel}]:\n`);
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

                        if (Array.isArray(item.headlines) && item.headlines.length > 0) {
                            item.headlines.forEach((hl: string) => {
                                textParts.push(`    - ${hl}`);
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

            // The requested news is not in the database: fall back to a keyless
            // web search so the user still gets sourced results instead of a
            // plain "no news" answer (only for undated, current-news requests).
            const combinedNews = [...articleRows, ...(newsData || [])];
            const hasNewsContent = combinedNews.some((item: any) => (Array.isArray(item?.headlines) && item.headlines.length > 0) || Number(item?.news_count) > 0);
            if (!hasNewsContent && !requestedDate && !requestedStartDate && symbols.length > 0) {
                const { data: nameRows } = await supabase.from("stocks").select("symbol, name");
                const nameMap = new Map((nameRows || []).map((r: any) => [String(r.symbol).toUpperCase(), r.name]));
                const names = symbols.map(s => nameMap.get(String(s).toUpperCase()) || s);
                const webQuery = `أخبار ${names.join(" ")} البورصة المصرية`;
                const webResults = await searchWeb(webQuery, 5);
                if (webResults.length > 0) {
                    textParts.push(`\n [بحث على الإنترنت بعد غياب الأخبار في قاعدة البيانات]: ${webResults.length} نتيجة للطلب "${webQuery}".`);
                    results.push({ tool: "search_web", source: "web", data_time: now, symbols, data_type: "live", data: { query: webQuery, fallback_for: "get_news", results: webResults } });
                }
            }
        } catch (e) {
            console.warn("Error fetching news:", e);
        }
    }

    // ===== WEB SEARCH (explicit request / information missing from database) =====
    if (plan.tools.includes("search_web")) {
        try {
            let webQuery = userMessage
                .replace(/(?:ابحث|دور|فتش|بحث|شوف|بص|سيرش|شيك|تشيك)/gi, "")
                .replace(/(?:في|فى|على|عن|من|عبر)\s*(?:النت|الانترنت|الإنترنت|جوجل|المواقع|الويب)/gi, "")
                .replace(/\s+/g, " ")
                .trim();
            
            // Clean up referential pronouns
            if (webQuery === "عنها" || webQuery === "عنه" || webQuery === "عنهم" || webQuery === "عليها" || webQuery === "عليه") {
                webQuery = "";
            }

            // Normalize colloquial time words and localize market-scoped
            // queries to the Egyptian market so the search engine does not
            // default to Gulf markets (Saudi etc.).
            webQuery = webQuery
                .replace(/(?:الجاى|الجاي|الجايه|الجاية|اللي جاي|اللي جاية)/g, "القادم")
                .trim();
            const hasOtherCountry = /(?:سعودي|سعودية|إمارات|امارات|كويت|بحرين|قطر|أمريكا|امريكا|عالمي|عالمية)/i.test(webQuery);
            if (webQuery && !hasOtherCountry && !/البورص[ةه]|مصر|egx/i.test(webQuery)) {
                webQuery = `${webQuery} البورصة المصرية`;
            }

            // Fallback: extract search query from previous user turn (excluding search trigger commands)
            if (!webQuery && Array.isArray(history) && history.length > 0) {
                const searchKeywordsRegex = /(?:ابحث|دور|فتش|بحث|شوف|بص|سيرش|شيك|تشيك)\s*(?:في|فى|على|عن)\s*(?:النت|الانترنت|الإنترنت|جوجل|المواقع|الويب)/i;
                const lastActualUserMsg = [...history]
                    .reverse()
                    .find(m => m.role === "user" && !searchKeywordsRegex.test(m.content))
                    ?.content || "";

                if (lastActualUserMsg) {
                    const cleanedPrev = lastActualUserMsg
                        .replace(/(?:عندك|هل|ايه|إيه|أخبار|اخبار|عن|سهم|شركة|شركه|تحليل|في|فيها|ليه|لماذا|ازاي|إزاي|مقارنة|قارن|قريب|سعر|سعرها|\?|؟)/gi, "")
                        .replace(/(?:الاسبوع\s*ده|الأسبوع\s*ده|الاسبوع\s*الحالي|الاسبوع\s*الجاري|النهارده|اليوم|كلها|كل|جميع|الفتره\s*دي|الفترة\s*دي|ده|دى|هذا|هذه|السهم|الاسهم|للاسهم|للأسهم)/gi, "")
                        .trim();
                    
                    if (cleanedPrev) {
                        let targetSubject = cleanedPrev;
                        if (symbols.length > 0) {
                            const { data: nameRows } = await supabase.from("stocks").select("symbol, name").in("symbol", symbols);
                            if (nameRows && nameRows.length > 0) {
                                const names = nameRows.map((r: any) => r.name || r.symbol);
                                targetSubject = `${cleanedPrev} ${names.join(" ")}`;
                            } else {
                                targetSubject = `${cleanedPrev} ${symbols.join(" ")}`;
                            }
                        }
                        webQuery = `${targetSubject} البورصة المصرية`;
                    }
                }
            }

            if (!webQuery) {
                if (symbols.length > 0) {
                    const { data: nameRows } = await supabase.from("stocks").select("symbol, name").in("symbol", symbols);
                    if (nameRows && nameRows.length > 0) {
                        const names = nameRows.map((r: any) => r.name || r.symbol);
                        webQuery = `أخبار سهم ${names.join(" ")} البورصة المصرية`;
                    } else {
                        webQuery = `أخبار سهم ${symbols.join(" ")} البورصة المصرية`;
                    }
                } else {
                    webQuery = "البورصة المصرية";
                }
            }

            const webResults = await searchWeb(webQuery, 6);
            results.push({ tool: "search_web", source: "web", data_time: now, symbols, data_type: "live", data: { query: webQuery, results: webResults } });
            if (webResults.length > 0) {
                textParts.push(`\n [نتائج بحث الإنترنت للطلب "${webQuery}"]: ${webResults.length} نتيجة موثقة بمصادرها.`);
            }
        } catch (e) {
            console.warn("Error running web search:", e);
        }
    }

    // ===== RECOMMENDATIONS / SIGNALS =====
    if (plan.tools.includes("get_recommendations") || plan.tools.includes("get_signals")) {
        try {
            const oldestRequest = plan.entities.recommendation_order === "oldest";
            const fetchRecommendationPage = (from: number, to: number) => {
                let query = supabase.from("scan_results")
                    .select("symbol, name, signal, entry_price, target_price, stop_loss, created_at")
                    .eq("country", AI_CONFIG.tools.defaultCountry);
                if (symbols.length > 0) query = query.or(symbols.map(s => `symbol.ilike.${s}`).join(","));
                return query.order("created_at", { ascending: oldestRequest }).range(from, to);
            };
            const { data, error } = await fetchRecommendationPage(0, AI_CONFIG.tools.recommendationsLimit - 1);
            if (error) throw error;
            const recsData: any[] = data || [];

            const scopedRecs = symbols.length > 0
                ? (recsData || []).filter((row: any) => symbols.includes(String(row.symbol || "").toUpperCase()))
                : (recsData || []);
            if (scopedRecs.length > 0) {
                const recommendationSymbols = Array.from(new Set(scopedRecs.map((row: any) => String(row.symbol || "").toUpperCase()).filter(Boolean)));
                const { data: latestPrices } = await supabase.from("stock_prices")
                    .select("symbol, close, date").in("symbol", recommendationSymbols)
                    .order("date", { ascending: false }).limit(recommendationSymbols.length * 2);
                const latestBySymbol = new Map<string, any>();
                (latestPrices || []).forEach((row: any) => {
                    const key = String(row.symbol || "").toUpperCase();
                    if (key && !latestBySymbol.has(key)) latestBySymbol.set(key, row);
                });
                const enrichedRecommendations = scopedRecs.map((row: any) => {
                    const entry = Number(row.entry_price);
                    const target = Number(row.target_price);
                    const stop = Number(row.stop_loss);
                    const signal = String(row.signal || "").toUpperCase();
                    const quality = oldestRequest ? { ok: Boolean(row.created_at), reason: row.created_at ? null : "missing_date" } : dataDateQuality(row.created_at, 365);
                    const levelsValid = signal === "BUY"
                        ? Number.isFinite(entry) && Number.isFinite(target) && Number.isFinite(stop) && target > entry
                        : signal === "SELL"
                            ? Number.isFinite(entry) && Number.isFinite(target) && Number.isFinite(stop) && target < entry
                            : false;
                    const current = latestBySymbol.get(String(row.symbol || "").toUpperCase());
                    const currentPrice = Number(current?.close);
                    const returnPct = Number.isFinite(entry) && entry > 0 && Number.isFinite(currentPrice) ? ((currentPrice - entry) / entry) * 100 : null;
                    return { ...row, current_price: Number.isFinite(currentPrice) ? currentPrice : null, current_date: current?.date || null, return_pct: returnPct, status: returnPct == null ? "غير مقيم" : returnPct >= 0 ? "ربح غير محقق" : "خسارة غير محققة", validation: { ok: quality.ok && levelsValid, date: quality, levels: levelsValid ? null : "invalid_trade_levels" } };
                }).filter((row: any) => row.validation.ok).slice(0, AI_CONFIG.tools.recommendationsLimit);

                if (enrichedRecommendations.length === 0) {
                    results.push({ tool: "get_recommendations", source: "validation", data_time: now, symbols: [], data_type: "historical", data: [], error: "كل الإشارات المتاحة قديمة أو متناقضة وتم حجبها." });
                    textParts.push("[الإشارات التاريخية]: تم حجب البيانات القديمة أو غير المنطقية.");
                    return { results, formattedText: textParts.join("\n") };
                }

                textParts.push(`\n [إشارات وتوصيات تداول البورصة المصرية من قاعدة البيانات]:\n`);

                const validRecs = enrichedRecommendations.filter((r: any) => r.return_pct != null);
                if (validRecs.length > 0) {
                    const rankedRecs = [...validRecs].sort((a: any, b: any) => Number(b.return_pct) - Number(a.return_pct));
                    const best = rankedRecs[0];
                    const bestReturn = Number(best.return_pct);
                    if (bestReturn > 0) {
                        textParts.push(`📊 [التقييم الفعلي لأداء الصفقات]: التوصية الأفضل أداءً هي ${best.symbol} بعائد غير محقق يبلغ +${bestReturn.toFixed(2)}%، بينما تختلف باقي الصفقات.`);
                    } else if (bestReturn === 0) {
                        textParts.push(`📊 [التقييم الفعلي لأداء الصفقات]: لا توجد توصيات رابحة حالياً (كل التوصيات خاسرة أو متعادلة). الصفقة الأقرب للتعادل هي ${best.symbol} بعائد 0.00% (تعادل تام دون أي أرباح فعلية وتعتبر صفقة راكدة لم تتحرك)، وباقي الصفقات تسجل خسائر غير محققة.`);
                    } else {
                        textParts.push(`📊 [التقييم الفعلي لأداء الصفقات]: لا توجد أي توصية رابحة أو متعادلة حالياً (جميع التوصيات في حالة خسارة غير محققة). الأقل خسارة هي ${best.symbol} بخسارة غير محققة تبلغ ${bestReturn.toFixed(2)}%.`);
                    }
                }

                enrichedRecommendations.forEach((r: any) => {
                    const signal = String(r.signal || "BUY").toUpperCase();
                    const entry = r.entry_price ? `${r.entry_price} ج.م` : "N/A";
                    const target = r.target_price ? `${r.target_price} ج.م` : "N/A";
                    const stop = r.stop_loss ? `${r.stop_loss} ج.م` : "N/A";
                    const dateStr = r.created_at ? String(r.created_at).replace("T", " ").split(".")[0] : "تاريخ غير محدد";
                    const performance = r.return_pct == null ? "العائد الحالي = غير متاح" : `السعر الحالي = ${r.current_price} | العائد حتى آخر سعر (${r.current_date}) = ${r.return_pct >= 0 ? "+" : ""}${r.return_pct.toFixed(2)}%`;
                    textParts.push(`• إشارة تاريخية ${r.symbol} (${r.name || r.symbol}): الإشارة = ${signal} | سعر الدخول = ${entry} | الهدف = ${target} | وقف الخسارة = ${stop} | ${performance} | تاريخ الإشارة = ${dateStr}`);
                });

                results.push({
                    tool: "get_recommendations",
                    source: "scan_results",
                    data_time: enrichedRecommendations.map((r: any) => String(r.created_at || "").slice(0, 10)).filter(Boolean).sort().pop() || now,
                    symbols: enrichedRecommendations.map((r: any) => r.symbol),
                    data_type: "historical",
                    data: enrichedRecommendations
                });
            }
        } catch (e) {
            console.warn("Error fetching recommendations:", e);
        }
    }

    
    // ===== SECTOR LIST =====
    if (plan.tools.includes("get_sector_list")) {
        try {
            const { data: fundamentalsRows } = await supabase
                .from("stock_fundamentals")
                .select("data")
                .limit(1000);

            const sectorCounts = new Map<string, number>();
            const SECTOR_ARABIC_MAP: Record<string, string> = {
                "Health Technology": "أدوية وتكنولوجيا صحية",
                "Health Services": "رعاية صحية وخدمات طبية",
                "Producer Manufacturing": "تصنيع وإنتاج تصنيعي",
                "Finance": "بنوك وخدمات مالية",
                "Distribution Services": "خدمات التوزيع واللوجستيات",
                "Consumer Non-Durables": "أغذية ومستهلكات غير معمرة",
                "Process Industries": "صناعات تحويلية ومعالجة",
                "Energy Minerals": "بترول وطاقة",
                "Retail Trade": "تجارة التجزئة",
                "Non-Energy Minerals": "مواد بناء وتعدين",
                "Transportation": "نقل وشحن",
                "Utilities": "مرافق عامة",
                "Technology Services": "اتصالات وتكنولوجيا المعلومات",
                "Consumer Services": "سياحة وخدمات استهلاكية",
                "Commercial Services": "خدمات تجارية ومقاولات",
                "Industrial Services": "خدمات صناعية",
                "Communications": "اتصالات والإعلام",
                "Consumer Durables": "عقارات وسلع معمرة",
                "Electronic Technology": "إلكترونيات وتكنولوجيا"
            };

            (fundamentalsRows || []).forEach((row: any) => {
                let sector = "";
                if (row.data && typeof row.data === "object") {
                    sector = row.data.sector || row.data.Sector || row.data.industry || row.data.Industry || "";
                } else if (typeof row.data === "string") {
                    try {
                        const parsed = JSON.parse(row.data);
                        sector = parsed.sector || parsed.Sector || parsed.industry || parsed.Industry || "";
                    } catch {}
                }
                if (sector) {
                    const arabicName = SECTOR_ARABIC_MAP[sector] || sector;
                    sectorCounts.set(arabicName, (sectorCounts.get(arabicName) || 0) + 1);
                }
            });

            const sectors = Array.from(sectorCounts.entries())
                .map(([sector, stock_count]) => ({ sector, stock_count }))
                .sort((a, b) => b.stock_count - a.stock_count);

            results.push({
                tool: "get_sector_list",
                source: "stock_fundamentals",
                data_time: now,
                symbols: [],
                data_type: "live",
                data: { sectors }
            });
        } catch (e) {
            console.warn("Error fetching sector list:", e);
        }
    }

    // ===== SECTOR LIQUIDITY SCAN =====
    if (plan.tools.includes("get_sector_liquidity")) {
        try {
            const [{ data: fundamentalsRows }, { data: technicalRows }] = await Promise.all([
                supabase.from("stock_fundamentals").select("symbol, data").eq("exchange", "EGX").limit(1000),
                (() => {
                    let query = supabase
                        .from("stock_technical_indicators")
                        .select("symbol, close, volume, vol_sma20, date")
                        .eq("exchange", "EGX")
                        .order("date", { ascending: false })
                        .limit(2000);
                    if (requestedDate) query = query.eq("date", requestedDate);
                    return query;
                })()
            ]);

            const parseFundamentalData = (value: unknown): Record<string, any> => {
                if (value && typeof value === "object") return value as Record<string, any>;
                if (typeof value === "string") {
                    try { return JSON.parse(value); } catch { return {}; }
                }
                return {};
            };
            const sectorTerms: Record<string, string[]> = {
                "بنوك": ["bank", "banking"],
                "ادويه": ["pharma", "pharmaceutical", "drug", "health technology", "health services"],
                "عقارات": ["real estate", "realestate", "homebuilding", "housing"],
                "اغذيه": ["food", "beverage", "consumer non-durables"],
                "بترول": ["oil", "gas", "petroleum", "energy"],
                "اتصالات": ["telecom", "telecommunications", "communications", "technology services"]
            };
            const requestedSector = plan.entities.sector ? normalizeArabic(plan.entities.sector).replace(/^ال/, "") : "";
            const requestedTerms = requestedSector ? (sectorTerms[requestedSector] || [requestedSector]) : [];
            const fundamentalsBySymbol = new Map<string, Record<string, any>>();
            (fundamentalsRows || []).forEach((row: any) => fundamentalsBySymbol.set(String(row.symbol).toUpperCase(), parseFundamentalData(row.data)));
            const dataDate = requestedDate || (technicalRows || [])[0]?.date || now.slice(0, 10);
            const aggregates = new Map<string, { traded_value: number; stock_count: number; volume_ratio_sum: number; volume_ratio_count: number }>();

            (technicalRows || []).filter((row: any) => row.date === dataDate).forEach((row: any) => {
                const fundamental = fundamentalsBySymbol.get(String(row.symbol).toUpperCase()) || {};
                const sector = String(fundamental.sector || fundamental.Sector || fundamental.industry || fundamental.Industry || "غير مصنف");
                const classification = normalizeArabic(`${sector} ${fundamental.industry || fundamental.Industry || ""}`);
                if (isExcludedSector(classification)) return;
                if (requestedTerms.length && !requestedTerms.some(term => classification.includes(normalizeArabic(term)))) return;
                const close = Number(row.close);
                const volume = Number(row.volume);
                if (!Number.isFinite(close) || !Number.isFinite(volume)) return;
                const aggregate = aggregates.get(sector) || { traded_value: 0, stock_count: 0, volume_ratio_sum: 0, volume_ratio_count: 0 };
                aggregate.traded_value += close * volume;
                aggregate.stock_count += 1;
                const volumeAverage = Number(row.vol_sma20);
                if (volumeAverage > 0) {
                    aggregate.volume_ratio_sum += volume / volumeAverage;
                    aggregate.volume_ratio_count += 1;
                }
                aggregates.set(sector, aggregate);
            });

            const sectors = Array.from(aggregates.entries())
                .map(([sector, aggregate]) => ({
                    sector,
                    traded_value: aggregate.traded_value,
                    stock_count: aggregate.stock_count,
                    average_volume_ratio: aggregate.volume_ratio_count ? aggregate.volume_ratio_sum / aggregate.volume_ratio_count : null
                }))
                .filter(sector => {
                    const requestedSectors = plan.entities.requested_sectors || [];
                    return requestedSectors.length === 0 || requestedSectors.some(requested => classificationMatchesSector(sector.sector, requested));
                })
                .sort((left, right) => right.traded_value - left.traded_value);
            results.push({
                tool: "get_sector_liquidity",
                source: "stock_fundamentals+stock_technical_indicators",
                data_time: dataDate,
                symbols: [],
                data_type: requestedDate ? "historical" : "live",
                data: { sectors, requested_sector: plan.entities.sector || null, requested_sectors: plan.entities.requested_sectors || [], excluded_sectors: plan.entities.excluded_sectors || [] }
            });
        } catch (e) {
            console.warn("Error fetching sector liquidity:", e);
            results.push({ tool: "get_sector_liquidity", source: "error", data_time: now, symbols: [], data_type: requestedDate ? "historical" : "live", data: { sectors: [] }, error: "sector_liquidity_failed" });
        }
    }

    // ===== STOCK LEVELS =====
    if ((plan.tools.includes("get_stock_levels") || plan.tools.includes("get_stock")) && symbols.length > 0) {
        const levelResults = await Promise.all(symbols.map(async symbol => {
            const requested = symbol.toUpperCase();
            let query = supabase.from("stock_prices").select("symbol, date, close, high, low").ilike("symbol", requested).order("date", { ascending: false }).limit(60);
            if (requestedDate) query = query.lte("date", requestedDate);
            const { data: prices } = await query;
            const rows = (prices || []).filter((row: any) => Number.isFinite(Number(row.close)));
            if (!rows.length) return { tool: "get_stock_levels", source: "empty", data_time: requestedDate || now.slice(0, 10), symbols: [requested], data_type: requestedDate ? "historical" : "live", data: { symbol: requested } } as ToolResult;
            const latest = rows[0];
            const close = Number(latest.close);
            const support = Math.min(...rows.map((row: any) => Number(row.low ?? row.close)));
            const resistance = Math.max(...rows.map((row: any) => Number(row.high ?? row.close)));
            
            const price_vs_support = close >= support ? "فوق الدعم" : "تحت الدعم (كسر الدعم)";
            const price_vs_resistance = close >= resistance ? "فوق المقاومة (اختراق المقاومة)" : "تحت المقاومة";
            const distance_from_support_pct = support > 0 ? Number((((close - support) / support) * 100).toFixed(2)) : 0;
            const distance_from_resistance_pct = resistance > 0 ? Number((((resistance - close) / resistance) * 100).toFixed(2)) : 0;
            const range = resistance - support;
            const position_pct = range > 0 ? Number((((close - support) / range) * 100).toFixed(2)) : 50;
            
            let trading_zone = "منطقة حيادية للمراقبة (بين الدعم والمقاومة)";
            if (close < support) {
                trading_zone = "تحت مستوى الدعم (تم كسر الدعم فنيّاً)";
            } else if (distance_from_support_pct <= 2.5) {
                trading_zone = "عند منطقة الدعم تماماً";
            } else if (position_pct <= 25) {
                trading_zone = "فوق مستوى الدعم وقريب منه (منطقة دعم تجميعية)";
            } else if (close > resistance) {
                trading_zone = "فوق مستوى المقاومة (تم اختراق المقاومة صعوداً)";
            } else if (distance_from_resistance_pct <= 2.5) {
                trading_zone = "عند منطقة المقاومة تماماً";
            } else if (position_pct >= 75) {
                trading_zone = "تحت مستوى المقاومة وقريب منها (منطقة مقاومة وجني أرباح مضاربية)";
            }
            if (distance_from_support_pct > 40) {
                trading_zone += ` (تنبيه: مستوى الدعم ${support} بعيد جداً عن السعر الحالي بمسافة ${distance_from_support_pct}% ولا يُعد مرجعاً عملياً للتداول قصير المدى)`;
            }
            if (distance_from_resistance_pct > 40) {
                trading_zone += ` (تنبيه: مستوى المقاومة ${resistance} بعيد جداً عن السعر الحالي بمسافة ${distance_from_resistance_pct}% ولا يُعد مرجعاً عملياً للتداول قصير المدى)`;
            }

            return {
                tool: "get_stock_levels",
                source: "stock_prices",
                data_time: latest.date,
                symbols: [requested],
                data_type: requestedDate ? "historical" : "live",
                data: {
                    symbol: requested,
                    close,
                    support,
                    resistance,
                    lookback_sessions: rows.length,
                    price_vs_support,
                    price_vs_resistance,
                    distance_from_support_pct,
                    distance_from_resistance_pct,
                    position_pct,
                    trading_zone
                }
            } as ToolResult;
        }));
        results.push(...levelResults);
    }

    if (plan.tools.includes("get_sector")) {
        try {
            const targetSector = plan.entities.sector || "";

            if (targetSector) {
                const { data: fundamentalsRows } = await supabase
                    .from("stock_fundamentals")
                    .select("symbol, data")
                    .eq("exchange", "EGX")
                    .limit(1000);

                const SECTOR_TERMS: Record<string, string[]> = {
                    "ادويه": ["pharmaceutical", "pharma", "drug", "health technology", "health services", "أدوية", "صيدلة", "رعاية صحية"],
                    "عقارات": ["real estate", "realestate", "عقارات", "عقاري", "homebuilding"],
                    "اغذيه": ["food", "beverage", "أغذية", "غذائية", "consumer non-durables", "agricultural"],
                    "استصلاح اراضي": ["reclamation", "land", "agriculture", "agricultural", "farming", "crop", "استصلاح", "اراضي", "زراعة", "زراعي"],
                    "استصلاح": ["reclamation", "land", "agriculture", "agricultural", "farming", "crop", "استصلاح", "اراضي", "زراعة", "زراعي"],
                    "اراضي": ["reclamation", "land", "agriculture", "agricultural", "farming", "crop", "استصلاح", "اراضي", "زراعة", "زراعي"],
                    "زراعة": ["reclamation", "land", "agriculture", "agricultural", "farming", "crop", "استصلاح", "اراضي", "زراعة", "زراعي"],
                    "بترول": ["oil", "gas", "petroleum", "energy", "بترول", "طاقة"],
                };

                const normalizedTargetSector = normalizeArabic(targetSector);
                let cleanedTargetSector = normalizedTargetSector;
                if (cleanedTargetSector.startsWith("ال")) {
                    cleanedTargetSector = cleanedTargetSector.substring(2);
                }

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
                    const matchesRequestedSector = cleanedTargetSector === "بنوك"
                        ? isBank
                        : (SECTOR_TERMS[cleanedTargetSector] || [targetSector.toLowerCase(), normalizedTargetSector, cleanedTargetSector])
                            .some((term) => classification.includes(term.toLowerCase()));

                    return matchesRequestedSector && !isExcludedSector(`${sector} ${industry} ${name}`)
                        ? [{ symbol: row.symbol, name, sector: sector || industry }]
                        : [];
                }).slice(0, 100);

                if (sectorStocks && sectorStocks.length > 0) {
                    const sectorSymbols = sectorStocks.map((s: any) => s.symbol);
                    let sectorTechQuery = supabase
                        .from("stock_technical_indicators")
                            .select("symbol, close, change_pct, volume, vol_sma20, rsi_14, macd_signal, date")
                        .eq("exchange", "EGX")
                        .in("symbol", sectorSymbols)
                        .order("date", { ascending: false })
                        .limit(500);
                    if (requestedDate) sectorTechQuery = sectorTechQuery.eq("date", requestedDate);
                    const { data: latestTechs } = await sectorTechQuery;

                    if (latestTechs && latestTechs.length > 0) {
                        const maxDate = requestedDate || latestTechs[0].date;
                        const todayTechs = latestTechs.filter((r: any) => r.date === maxDate);
                        const techMap = new Map(todayTechs.map((t: any) => [t.symbol.toUpperCase(), t]));

                        const stocksWithTech = sectorStocks
                            .map((s: any) => ({
                                ...s,
                                tech: techMap.get(s.symbol.toUpperCase())
                            }))
                            .filter((s: any) => s.tech)
                            .sort((a: any, b: any) => Math.abs(Number(b.tech.change_pct || 0)) - Math.abs(Number(a.tech.change_pct || 0)))
                            .slice(0, 15);

                        const gainers = stocksWithTech
                            .filter((s: any) => s.tech && Number(s.tech.change_pct || 0) > 0)
                            .sort((a: any, b: any) => Number(b.tech.change_pct || 0) - Number(a.tech.change_pct || 0))
                            .slice(0, 10);

                        const losers = stocksWithTech
                            .filter((s: any) => s.tech && Number(s.tech.change_pct || 0) < 0)
                            .sort((a: any, b: any) => Number(a.tech.change_pct || 0) - Number(b.tech.change_pct || 0))
                            .slice(0, 10);

                        textParts.push(`\n [تحليل قطاع ${targetSector} - ${sectorStocks.length} سهم]:\n`);

                        if (gainers.length > 0) {
                            textParts.push(`أعلى ارتفاعاً في القطاع:`);
                            gainers.forEach((s: any) => {
                                const ch = Number(s.tech.change_pct).toFixed(2);
                                const vRatio = (Number(s.tech.volume || 0) / Number(s.tech.vol_sma20 || 1)).toFixed(2);
                                textParts.push(`• سهم ${s.symbol} (${s.name}): التغير = +${ch}%, RSI = ${s.tech.rsi_14 ?? "N/A"}, نسبة السيولة = ${vRatio}x`);
                            });
                        }
                        if (losers.length > 0) {
                            textParts.push(`\nأعلى انخفاضاً في القطاع:`);
                            losers.forEach((s: any) => {
                                const ch = Number(s.tech.change_pct).toFixed(2);
                                const vRatio = (Number(s.tech.volume || 0) / Number(s.tech.vol_sma20 || 1)).toFixed(2);
                                textParts.push(`• سهم ${s.symbol} (${s.name}): التغير = ${ch}%, RSI = ${s.tech.rsi_14 ?? "N/A"}, نسبة السيولة = ${vRatio}x`);
                            });
                        }

                        results.push({
                            tool: "get_sector",
                            source: "database",
                            data_time: maxDate,
                            symbols: stocksWithTech.map((stock: any) => stock.symbol),
                            data_type: "live",
                            data: { sector: targetSector, stocks: stocksWithTech, gainers, losers }
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
                        (() => { let q = supabase.from("stock_prices").select("symbol, close, volume, date").ilike("symbol", sym1); if (requestedDate) q = q.eq("date", requestedDate); return q.order("date", { ascending: false }).limit(1).maybeSingle(); })(),
                        (() => { let q = supabase.from("stock_prices").select("symbol, close, volume, date").ilike("symbol", sym2); if (requestedDate) q = q.eq("date", requestedDate); return q.order("date", { ascending: false }).limit(1).maybeSingle(); })()
                    ]),
                    Promise.all([
                        (() => { let q = supabase.from("stock_technical_indicators").select("symbol, rsi_14, macd_signal, change_pct, volume, vol_sma20, adx_14, date").ilike("symbol", sym1); if (requestedDate) q = q.eq("date", requestedDate); return q.order("date", { ascending: false }).limit(1).maybeSingle(); })(),
                        (() => { let q = supabase.from("stock_technical_indicators").select("symbol, rsi_14, macd_signal, change_pct, volume, vol_sma20, adx_14, date").ilike("symbol", sym2); if (requestedDate) q = q.eq("date", requestedDate); return q.order("date", { ascending: false }).limit(1).maybeSingle(); })()
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

                if (p1 || p2 || t1 || t2 || requestedDate) {
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
                        data_time: requestedDate || p1?.date || t1?.date || p2?.date || t2?.date || now,
                        symbols: [sym1, sym2],
                        data_type: requestedDate ? "historical" : "live",
                        data: {
                            sym1: { price: p1 || null, tech: t1 || null, info: { ...(sMap.get(sym1.toUpperCase()) || { symbol: sym1 }), sector: sector1 } },
                            sym2: { price: p2 || null, tech: t2 || null, info: { ...(sMap.get(sym2.toUpperCase()) || { symbol: sym2 }), sector: sector2 } }
                        }
                    });
                }
            }
        } catch (e) {
            console.warn("Error fetching comparison data:", e);
        }
    }

    // 1. Process Egyptian Mutual Funds: If user or portfolio image includes a fund (e.g. BMM, AZGD, AZST), provide accurate fund context
    const fundSymbols = symbols.filter(s => !!EGYPTIAN_MUTUAL_FUNDS[s.toUpperCase()]);
    for (const fundSym of fundSymbols) {
        const fund = EGYPTIAN_MUTUAL_FUNDS[fundSym.toUpperCase()];
        results.push({
            tool: "get_fund_info",
            source: "funds",
            data_time: now,
            symbols: [fundSym],
            data_type: "live",
            data: fund
        });
        textParts.push(`\n [معلومات الصندوق ${fund.nameAr}]: هذا ${fund.type}. الصناديق ووثائق الاستثمار لا يتم تداولها بالشموع اليومية أو مؤشرات RSI والدعم والمقاومة مثل الأسهم العادية، وإنما تمثل جانباً من المحفظة مخصصاً للسيولة النقدية أو التحوط أو الادخار بعائد دوري.`);
    }

    // 2. Symbol-level database failure fallback: only for genuine unlisted equity stocks
    const untrackedSymbols = symbols.filter(symbol => {
        if (EGYPTIAN_MUTUAL_FUNDS[symbol.toUpperCase()]) return false;
        if (NON_EQUITY_SYMBOLS.has(symbol.toUpperCase())) return false;
        const symbolResults = results.filter(res => res.symbols && res.symbols.map(s => s.toUpperCase()).includes(symbol.toUpperCase()));
        return symbolResults.length === 0 || symbolResults.every(res => res.source === "empty" || res.source === "error");
    });

    if (untrackedSymbols.length > 0 && !plan.tools.includes("search_web")) {
        try {
            // Resolve company names if possible, otherwise use the tickers
            const { data: nameRows } = await supabase.from("stocks").select("symbol, name").in("symbol", untrackedSymbols);
            const nameMap = new Map((nameRows || []).map((r: any) => [String(r.symbol).toUpperCase(), r.name]));
            const names = untrackedSymbols.map(s => nameMap.get(String(s).toUpperCase()) || s);
            
            const webQuery = `أخبار سهم ${names.join(" ")} البورصة المصرية`;
            const webResults = await searchWeb(webQuery, 6);
            
            results.push({ 
                tool: "search_web", 
                source: "web", 
                data_time: now, 
                symbols: untrackedSymbols, 
                data_type: "live", 
                data: { query: webQuery, results: webResults } 
            });
            if (webResults.length > 0) {
                textParts.push(`\n [نتائج بحث الإنترنت البديلة للرموز غير المدرجة "${webQuery}"]: ${webResults.length} نتيجة موثقة بمصادرها.`);
            }
        } catch (e) {
            console.warn("Error running automatic fallback web search:", e);
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
