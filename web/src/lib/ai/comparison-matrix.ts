import { ToolResult } from "./types";

export interface StockEvaluation {
    symbol: string;
    name?: string;
    price: number | null;
    change_pct: number | null;
    rsi: number | null;
    vol_ratio: number | null;
    macd: number | null;
    macd_signal: number | null;
    support: number | null;
    resistance: number | null;
    king_ai_score: number | null;
    egx_ai_score: number | null;
    acc_score: number | null;
    dist_score: number | null;
    wyckoff_phase: string | null;

    // Derived Scores (0 to 10)
    technical_score: number;
    liquidity_score: number;
    ml_score: number;
    risk_score: number;

    // Data completeness flags
    has_macd_signal: boolean;
    has_wyckoff: boolean;
    has_levels: boolean;
}

export interface ComparisonMatrixResult {
    stocks: StockEvaluation[];
    deltas: Array<{
        metric: string;
        sym1: string;
        sym2: string;
        diff: number;
        statistically_significant: boolean;
        note: string;
    }>;
    winner_technical: string | null;
    winner_stability: string | null;
    winner_ml: string | null;
    overall_confidence: "عالية" | "متوسطة" | "منخفضة";
    confidence_reasons: string[];
    formatted_prompt_block: string;
}

export function calculateStockScores(stock: any): StockEvaluation {
    const sym = String(stock.symbol || stock.info?.symbol || "UNKNOWN").toUpperCase();
    const price = stock.price != null && !isNaN(Number(stock.price)) ? Number(stock.price) : (stock.close != null && !isNaN(Number(stock.close)) ? Number(stock.close) : null);
    const change_pct = stock.change_pct != null && !isNaN(Number(stock.change_pct)) ? Number(stock.change_pct) : null;
    const rsi = stock.rsi_14 != null && !isNaN(Number(stock.rsi_14)) ? Number(stock.rsi_14) : (stock.rsi != null && !isNaN(Number(stock.rsi)) ? Number(stock.rsi) : null);

    // Parse vol_ratio safely to guaranteed number or null
    let vol_ratio: number | null = null;
    const rawVol = stock.vol_ratio ?? null;
    if (rawVol != null) {
        const num = parseFloat(String(rawVol).replace(/x/gi, ""));
        if (!isNaN(num)) vol_ratio = num;
    }
    if (vol_ratio == null && stock.volume && stock.vol_sma20) {
        const v = Number(stock.volume);
        const sma = Number(stock.vol_sma20);
        if (sma > 0 && !isNaN(v) && !isNaN(sma)) vol_ratio = v / sma;
    }

    const macd = stock.macd != null && !isNaN(Number(stock.macd)) ? Number(stock.macd) : null;
    const macd_signal = stock.macd_signal != null && !isNaN(Number(stock.macd_signal)) ? Number(stock.macd_signal) : null;
    const support = stock.support != null && !isNaN(Number(stock.support)) ? Number(stock.support) : null;
    const resistance = stock.resistance != null && !isNaN(Number(stock.resistance)) ? Number(stock.resistance) : null;
    const king_ai = stock.king_ai_score != null && !isNaN(Number(stock.king_ai_score)) ? Number(stock.king_ai_score) : null;
    const egx_ai = stock.egx_ai_score != null && !isNaN(Number(stock.egx_ai_score)) ? Number(stock.egx_ai_score) : null;
    const acc_score = stock.acc_score != null && !isNaN(Number(stock.acc_score)) ? Number(stock.acc_score) : null;
    const dist_score = stock.dist_score != null && !isNaN(Number(stock.dist_score)) ? Number(stock.dist_score) : null;
    const wyckoff = stock.wyckoff_phase ? String(stock.wyckoff_phase) : null;

    // 1. Technical Score (0-10)
    let techScore = 5.0; // Base neutral
    if (rsi != null) {
        if (rsi >= 50 && rsi <= 68) techScore += 2.5; // Optimal bullish zone
        else if (rsi > 30 && rsi < 50) techScore += 1.0; // Neutral-safe recovery
        else if (rsi >= 70) techScore -= 1.5; // Overbought risk
        else if (rsi <= 30) techScore += 0.5; // Oversold rebound potential
    }
    if (macd != null) {
        if (macd > 0) techScore += 1.5;
        else techScore -= 1.0;
    }
    if (macd != null && macd_signal != null) {
        if (macd > macd_signal) techScore += 1.0;
        else if (macd < macd_signal) techScore -= 1.0;
    }
    techScore = Math.min(10, Math.max(0, Math.round(techScore * 10) / 10));

    // 2. Liquidity Score (0-10)
    let liqScore = 5.0;
    if (vol_ratio != null) {
        if (vol_ratio >= 1.0 && vol_ratio <= 3.0) liqScore += 3.0; // Healthy active volume
        else if (vol_ratio > 3.0) liqScore += 2.0; // High volume
        else if (vol_ratio < 0.5) liqScore -= 2.5; // Illiquid
    }
    if (acc_score != null && acc_score > 50) liqScore += 1.5;
    if (dist_score != null && dist_score > 50) liqScore -= 1.5;
    liqScore = Math.min(10, Math.max(0, Math.round(liqScore * 10) / 10));

    // 3. ML Score (0-10)
    let mlScore = 5.0;
    const validScores: number[] = [];
    if (king_ai != null) validScores.push(king_ai > 1 ? king_ai / 100 : king_ai);
    if (egx_ai != null) validScores.push(egx_ai > 1 ? egx_ai / 100 : egx_ai);
    if (validScores.length > 0) {
        const avg = validScores.reduce((a, b) => a + b, 0) / validScores.length;
        mlScore = Math.round(avg * 10 * 10) / 10;
    }

    // 4. Risk Score (0-10) — Higher means GREATER risk
    let riskScore = 4.0;
    if (rsi != null && rsi >= 70) riskScore += 3.0;
    if (vol_ratio != null && vol_ratio < 0.4) riskScore += 2.5;
    if (dist_score != null && dist_score > 60) riskScore += 2.0;
    if (support == null || resistance == null) riskScore += 1.0;
    riskScore = Math.min(10, Math.max(0, Math.round(riskScore * 10) / 10));

    return {
        symbol: sym,
        name: stock.name || stock.info?.name_ar || stock.info?.name_en || sym,
        price,
        change_pct,
        rsi,
        vol_ratio,
        macd,
        macd_signal,
        support,
        resistance,
        king_ai_score: king_ai,
        egx_ai_score: egx_ai,
        acc_score,
        dist_score,
        wyckoff_phase: wyckoff,
        technical_score: techScore,
        liquidity_score: liqScore,
        ml_score: mlScore,
        risk_score: riskScore,
        has_macd_signal: macd_signal != null,
        has_wyckoff: wyckoff != null || acc_score != null || dist_score != null,
        has_levels: support != null && resistance != null
    };
}

export function buildComparisonMatrix(toolResults: ToolResult[]): ComparisonMatrixResult | null {
    // 1. Gather all stock data from get_stock, get_comparison, or level tools
    const stockMap = new Map<string, any>();

    toolResults.forEach(r => {
        if (r.tool === "get_stock" && r.data?.symbol) {
            stockMap.set(String(r.data.symbol).toUpperCase(), { ...stockMap.get(String(r.data.symbol).toUpperCase()), ...r.data });
        } else if (r.tool === "get_stock_levels" && (r.data?.symbol || r.symbols?.[0])) {
            const sym = String(r.data?.symbol || r.symbols?.[0]).toUpperCase();
            stockMap.set(sym, { ...stockMap.get(sym), ...r.data });
        } else if (r.tool === "get_comparison" && r.data?.sym1 && r.data?.sym2) {
            const s1 = String(r.data.sym1.info?.symbol || r.symbols?.[0] || "").toUpperCase();
            const s2 = String(r.data.sym2.info?.symbol || r.symbols?.[1] || "").toUpperCase();
            if (s1) stockMap.set(s1, { ...stockMap.get(s1), ...r.data.sym1.tech, price: r.data.sym1.price?.close, info: r.data.sym1.info });
            if (s2) stockMap.set(s2, { ...stockMap.get(s2), ...r.data.sym2.tech, price: r.data.sym2.price?.close, info: r.data.sym2.info });
        }
    });

    const evaluatedStocks = Array.from(stockMap.values()).map(calculateStockScores);

    if (evaluatedStocks.length < 2) {
        return null; // Comparison Matrix requires at least 2 stocks
    }

    // 2. Compute Deltas & Significance between pair
    const deltas: ComparisonMatrixResult["deltas"] = [];
    const s1 = evaluatedStocks[0];
    const s2 = evaluatedStocks[1];

    if (s1.king_ai_score != null && s2.king_ai_score != null) {
        const k1 = s1.king_ai_score > 1 ? s1.king_ai_score : s1.king_ai_score * 100;
        const k2 = s2.king_ai_score > 1 ? s2.king_ai_score : s2.king_ai_score * 100;
        const diff = Math.round(Math.abs(k1 - k2) * 10) / 10;
        const isSig = diff >= 2.0;
        const leader = k1 > k2 ? s1.symbol : s2.symbol;
        deltas.push({
            metric: "KING AI Score",
            sym1: s1.symbol,
            sym2: s2.symbol,
            diff,
            statistically_significant: isSig,
            note: isSig
                ? `${leader} متقدم بـ +${diff}% في نموذج KING AI (فرق إحصائي ملحوظ).`
                : `${leader} متقدم بـ +${diff}% فقط في نموذج KING AI (فرق غير كافٍ لاعتباره أفضلية تنبؤية حقيقية).`
        });
    }

    if (s1.egx_ai_score != null && s2.egx_ai_score != null) {
        const e1 = s1.egx_ai_score > 1 ? s1.egx_ai_score : s1.egx_ai_score * 100;
        const e2 = s2.egx_ai_score > 1 ? s2.egx_ai_score : s2.egx_ai_score * 100;
        const diff = Math.round(Math.abs(e1 - e2) * 10) / 10;
        const isSig = diff >= 2.0;
        const leader = e1 > e2 ? s1.symbol : s2.symbol;
        deltas.push({
            metric: "EGX AI Score",
            sym1: s1.symbol,
            sym2: s2.symbol,
            diff,
            statistically_significant: isSig,
            note: isSig
                ? `${leader} متقدم بـ +${diff}% في نموذج EGX AI (فرق إحصائي ملحوظ).`
                : `${leader} متقدم بـ +${diff}% فقط في نموذج EGX AI (فرق غير كافٍ لاعتباره أفضلية تنبؤية حقيقية).`
        });
    }

    // 3. Determine Category Winners
    const sortedTech = [...evaluatedStocks].sort((a, b) => b.technical_score - a.technical_score);
    const winnerTech = sortedTech[0].technical_score - sortedTech[1].technical_score >= 0.5 ? sortedTech[0].symbol : null;

    const sortedRisk = [...evaluatedStocks].sort((a, b) => a.risk_score - b.risk_score);
    const winnerStab = sortedRisk[1].risk_score - sortedRisk[0].risk_score >= 0.5 ? sortedRisk[0].symbol : null;

    const sortedMl = [...evaluatedStocks].sort((a, b) => b.ml_score - a.ml_score);
    const winnerMl = sortedMl[0].ml_score - sortedMl[1].ml_score >= 0.5 ? sortedMl[0].symbol : null;

    // 4. Evaluate Overall Confidence & Reasons for Reductions
    const confidenceReasons: string[] = [];
    let missingSignals = 0;
    let missingWyckoffs = 0;

    evaluatedStocks.forEach(s => {
        if (!s.has_macd_signal) {
            missingSignals++;
            confidenceReasons.push(`بيانات MACD Signal غير متوفرة لسهم ${s.symbol}.`);
        }
        if (!s.has_wyckoff) {
            missingWyckoffs++;
            confidenceReasons.push(`بيانات Wyckoff والتجميع/التصريف غير متوفرة لسهم ${s.symbol}.`);
        }
    });

    let overallConfidence: "عالية" | "متوسطة" | "منخفضة" = "عالية";
    if (confidenceReasons.length >= 3) {
        overallConfidence = "منخفضة";
    } else if (confidenceReasons.length >= 1) {
        overallConfidence = "متوسطة";
    }

    // 5. Format Prompt Block for LLM Evidence
    const lines: string[] = [];
    lines.push("=== DETERMINISTIC COMPARISON DECISION MATRIX ===");
    lines.push("Below is the pre-computed, strict analytical decision matrix. DO NOT alter these scores or invent non-existent metrics:\n");

    evaluatedStocks.forEach(s => {
        const kingStr = typeof s.king_ai_score === "number" && Number.isFinite(s.king_ai_score)
            ? (s.king_ai_score > 1 ? s.king_ai_score.toFixed(1) : (s.king_ai_score * 100).toFixed(1)) + "%"
            : "N/A";
        const egxStr = typeof s.egx_ai_score === "number" && Number.isFinite(s.egx_ai_score)
            ? (s.egx_ai_score > 1 ? s.egx_ai_score.toFixed(1) : (s.egx_ai_score * 100).toFixed(1)) + "%"
            : "N/A";

        lines.push(`📊 ${s.symbol} (${s.name}):`);
        lines.push(`  - Technical Score: ${s.technical_score}/10`);
        lines.push(`  - Liquidity Score: ${s.liquidity_score}/10`);
        lines.push(`  - ML Score: ${s.ml_score}/10 (KING: ${kingStr}, EGX: ${egxStr})`);
        lines.push(`  - Risk Score: ${s.risk_score}/10 (Higher = More Risk)`);
        lines.push(`  - MACD State: ${s.macd != null ? (s.macd > 0 ? "فوق الصفر (موجب)" : "تحت الصفر (سالب)") : "غير متاح"}`);
        lines.push(`  - MACD Signal Line Comparison: ${s.has_macd_signal ? (s.macd! > s.macd_signal! ? "فوق خط الإشارة" : "تحت خط الإشارة") : "NOT_PROVIDED (⛔ DO NOT claim above/below signal line!)"}`);
        lines.push(`  - Volume Interpretation: ${typeof s.vol_ratio === "number" && Number.isFinite(s.vol_ratio) ? (s.vol_ratio >= 1.0 ? `تداول كثيف (${s.vol_ratio.toFixed(2)}x من المتوسط)` : `تداول أقل من المتوسط (${s.vol_ratio.toFixed(2)}x)`) : "غير متاح"}`);
        lines.push(`  - Volume Note: ⛔ Volume ratio alone does NOT equal selling pressure / ضغط بيعي unlessWyckoff/dist_score is explicitly provided.`);
    });

    lines.push("\n📈 ML STATISTICAL DELTAS & SIGNIFICANCE:");
    if (deltas.length > 0) {
        deltas.forEach(d => lines.push(`  - ${d.metric}: ${d.note}`));
    } else {
        lines.push("  - لا تتوفر تقييمات ML كافية لحساب الفروق الإحصائية.");
    }

    lines.push("\n🏆 CATEGORY WINNERS:");
    lines.push(`  - الأفضل فنياً (Technical Leader): ${winnerTech || "تعادل مقاربة"}`);
    lines.push(`  - الأكثر استقراراً وأقل مخاطرة (Stability/Risk Leader): ${winnerStab || "تعادل متقارب"}`);
    lines.push(`  - الأفضل في نماذج الذكاء الاصطناعي (ML Leader): ${winnerMl || "تعادل متقارب"}`);

    lines.push(`\n🎯 OVERALL ANALYTICAL CONFIDENCE: ${overallConfidence}`);
    if (confidenceReasons.length > 0) {
        lines.push(`  - أساب خفض الثقة: ${confidenceReasons.join(" | ")}`);
    }

    lines.push("=== END DECISION MATRIX ===");

    return {
        stocks: evaluatedStocks,
        deltas,
        winner_technical: winnerTech,
        winner_stability: winnerStab,
        winner_ml: winnerMl,
        overall_confidence: overallConfidence,
        confidence_reasons: confidenceReasons,
        formatted_prompt_block: lines.join("\n")
    };
}
