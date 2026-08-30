/**
 * live-stock-updater.ts
 * Smart On-Demand Intraday Stock Price & Indicator Updater
 * 
 * - Detects active EGX market trading hours (Sun-Thu 10:00 AM - 2:30 PM Cairo Time)
 * - Fetches real-time price & pre-calculated indicators via TradingView scanner in <700ms
 * - Bounded 3-second timeout with 1 attempt only
 * - 5-minute in-memory cache to prevent redundant fetches
 * - Updates Supabase `stock_technical_indicators` (upsert on symbol to maintain 1-row-per-symbol rule)
 */

interface LiveIndicatorsData {
    symbol: string;
    close: number;
    change_pct: number;
    change_abs: number;
    high: number;
    low: number;
    open: number;
    volume: number;
    value_traded: number;
    rsi_14: number | null;
    macd: number | null;
    macd_signal: number | null;
    ema_50: number | null;
    ema_200: number | null;
    sma_50: number | null;
    sma_200: number | null;
    bb_upper: number | null;
    bb_lower: number | null;
    stoch_k: number | null;
    stoch_d: number | null;
    updated_at: string;
    cairo_time_str: string;
}

interface CacheEntry {
    data: LiveIndicatorsData;
    timestamp: number;
}

// 5-minute in-memory cache per symbol
const LIVE_STOCK_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory record of failed attempts to avoid hammering failed tickers in the same minute
const FAILED_REFRESH_ATTEMPTS = new Map<string, number>();
const FAIL_COOLDOWN_MS = 60 * 1000; // 1 minute cooldown on failure

/**
 * Checks if the Egyptian Stock Exchange (EGX) is currently open for trading.
 * Trading hours: Sunday (0) through Thursday (4), 10:00 AM to 2:30 PM Cairo Time (Africa/Cairo).
 */
export function isEgxSessionOpen(overrideDate?: Date): boolean {
    const now = overrideDate || new Date();
    
    // Convert to Cairo time
    const cairoFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Africa/Cairo",
        weekday: "short",
        hour: "numeric",
        minute: "numeric",
        hour12: false
    });

    const parts = cairoFormatter.formatToParts(now);
    let weekday = "";
    let hour = 0;
    let minute = 0;

    for (const part of parts) {
        if (part.type === "weekday") weekday = part.value.toLowerCase();
        if (part.type === "hour") hour = parseInt(part.value, 10);
        if (part.type === "minute") minute = parseInt(part.value, 10);
    }

    // EGX is closed on Friday (Fri) and Saturday (Sat)
    const isTradingDay = ["sun", "mon", "tue", "wed", "thu"].includes(weekday);
    if (!isTradingDay) return false;

    // Trading session: 10:00 to 14:30
    const timeInMinutes = hour * 60 + minute;
    const sessionStart = 10 * 60;       // 10:00 AM
    const sessionEnd = 14 * 60 + 30;    // 02:30 PM

    return timeInMinutes >= sessionStart && timeInMinutes <= sessionEnd;
}

/**
 * Formats Cairo local time as a human-readable string (e.g., "11:45 ص")
 */
export function getCairoTimeString(date?: Date): string {
    const d = date || new Date();
    return new Intl.DateTimeFormat("ar-EG", {
        timeZone: "Africa/Cairo",
        hour: "numeric",
        minute: "numeric",
        hour12: true
    }).format(d);
}

/**
 * Fetches real-time price & indicators for a single stock from TradingView scanner.
 * Maximum 1 attempt with a 3.0-second hard timeout.
 */
export async function fetchLiveStockIndicators(
    symbol: string,
    supabase?: any
): Promise<{
    success: boolean;
    data?: LiveIndicatorsData;
    error?: string;
    from_cache?: boolean;
}> {
    const cleanSym = symbol.trim().toUpperCase().replace(/^(EGX:|CA:)/, "");
    if (!cleanSym) {
        return { success: false, error: "رمز السهم غير صحيح" };
    }

    const now = Date.now();

    // 1. Check in-memory cache (5-minute TTL)
    const cached = LIVE_STOCK_CACHE.get(cleanSym);
    if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
        return { success: true, data: cached.data, from_cache: true };
    }

    // 2. Check failure cooldown (don't retry failed ticker within 1 minute)
    const lastFailed = FAILED_REFRESH_ATTEMPTS.get(cleanSym);
    if (lastFailed && (now - lastFailed < FAIL_COOLDOWN_MS)) {
        return { success: false, error: "محاولة التحديث معلقة مؤقتاً لتجنب تكرار الطلبات" };
    }

    // 3. Perform TradingView scanner fetch with 3.0s timeout
    const tvTicker = `EGX:${cleanSym}`;
    const payload = {
        symbols: { tickers: [tvTicker], query: { types: [] } },
        columns: [
            "name", "close", "change", "change_abs", "high", "low", "open", "volume",
            "RSI", "MACD.macd", "MACD.signal", "EMA50", "EMA200", "SMA50", "SMA200",
            "BB.upper", "BB.lower", "Stoch.K", "Stoch.D", "Value.Traded"
        ]
    };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const res = await fetch("https://scanner.tradingview.com/egypt/scan", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
            FAILED_REFRESH_ATTEMPTS.set(cleanSym, now);
            return { success: false, error: `TradingView HTTP ${res.status}` };
        }

        const json = await res.json();
        const row = json.data?.[0];
        if (!row || !Array.isArray(row.d)) {
            FAILED_REFRESH_ATTEMPTS.set(cleanSym, now);
            return { success: false, error: "لا توجد بيانات متاحة لهذا الرمز في الجلسة المباشرة" };
        }

        const d = row.d;
        const cairoTimeStr = getCairoTimeString();
        const isoNow = new Date().toISOString();
        const dateOnly = isoNow.split("T")[0];

        const liveData: LiveIndicatorsData = {
            symbol: cleanSym,
            close: d[1] != null ? Number(d[1]) : 0,
            change_pct: d[2] != null ? Number(Number(d[2]).toFixed(2)) : 0,
            change_abs: d[3] != null ? Number(Number(d[3]).toFixed(2)) : 0,
            high: d[4] != null ? Number(d[4]) : 0,
            low: d[5] != null ? Number(d[5]) : 0,
            open: d[6] != null ? Number(d[6]) : 0,
            volume: d[7] != null ? Math.round(Number(d[7])) : 0,
            rsi_14: d[8] != null ? Number(Number(d[8]).toFixed(2)) : null,
            macd: d[9] != null ? Number(Number(d[9]).toFixed(4)) : null,
            macd_signal: d[10] != null ? Number(Number(d[10]).toFixed(4)) : null,
            ema_50: d[11] != null ? Number(Number(d[11]).toFixed(2)) : null,
            ema_200: d[12] != null ? Number(Number(d[12]).toFixed(2)) : null,
            sma_50: d[13] != null ? Number(Number(d[13]).toFixed(2)) : null,
            sma_200: d[14] != null ? Number(Number(d[14]).toFixed(2)) : null,
            bb_upper: d[15] != null ? Number(Number(d[15]).toFixed(2)) : null,
            bb_lower: d[16] != null ? Number(Number(d[16]).toFixed(2)) : null,
            stoch_k: d[17] != null ? Number(Number(d[17]).toFixed(2)) : null,
            stoch_d: d[18] != null ? Number(Number(d[18]).toFixed(2)) : null,
            value_traded: d[19] != null ? Number(Number(d[19]).toFixed(2)) : 0,
            updated_at: isoNow,
            cairo_time_str: cairoTimeStr
        };

        // Cache in memory
        LIVE_STOCK_CACHE.set(cleanSym, { data: liveData, timestamp: now });
        FAILED_REFRESH_ATTEMPTS.delete(cleanSym);

        // 4. Update Supabase asynchronously/safely if client provided
        if (supabase && liveData.close > 0) {
            try {
                // Upsert to stock_technical_indicators to maintain 1-row-per-symbol rule
                await supabase.from("stock_technical_indicators").upsert({
                    symbol: cleanSym,
                    exchange: "EGX",
                    date: dateOnly,
                    close: liveData.close,
                    open: liveData.open,
                    high: liveData.high,
                    low: liveData.low,
                    volume: liveData.volume,
                    change_pct: liveData.change_pct,
                    rsi_14: liveData.rsi_14,
                    macd: liveData.macd,
                    macd_signal: liveData.macd_signal,
                    ema_50: liveData.ema_50,
                    ema_200: liveData.ema_200,
                    sma_50: liveData.sma_50,
                    sma_200: liveData.sma_200,
                    bb_upper: liveData.bb_upper,
                    bb_lower: liveData.bb_lower,
                    stoch_k: liveData.stoch_k,
                    stoch_d: liveData.stoch_d,
                    updated_at: isoNow
                }, { onConflict: "symbol" });
            } catch (dbErr) {
                console.warn(`[LIVE_UPDATER] Supabase upsert failed for ${cleanSym}:`, dbErr);
            }
        }

        return { success: true, data: liveData, from_cache: false };
    } catch (err: any) {
        FAILED_REFRESH_ATTEMPTS.set(cleanSym, now);
        const errMsg = err?.name === "AbortError" ? "انتهت مهلة جلب السعر المباشر (3 ثوانٍ)" : (err?.message || "فشل الاتصال");
        return { success: false, error: errMsg };
    }
}
