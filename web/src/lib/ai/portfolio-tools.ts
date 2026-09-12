/**
 * portfolio-tools.ts
 * "My Portfolio" (محفظتى) chat tools — let users manage their stock holdings
 * and cash conversationally. Backed by the Supabase `positions` table
 * (quantity column) and `profiles.cash_balance`.
 *
 * Supported operations:
 *  - get_portfolio: full holdings snapshot with live prices, P/L and cash
 *  - add_portfolio_position: add/increase a holding (symbol, quantity, entry price)
 *  - update_portfolio_position: change quantity/entry price of an open position
 *  - remove_portfolio_position: fully remove a holding
 *  - sell_portfolio_position: record a sell (close position, add proceeds to cash)
 *  - set_portfolio_cash: set / adjust the free cash balance
 *
 * Every function returns a plain object with `ok` + Arabic `message` so the
 * pipeline can hand it to the LLM or render it deterministically.
 */
import { fetchLiveStockIndicators, isEgxSessionOpen } from "./live-stock-updater";
import { isPro, paymentsEnabled } from "./plan-gate";

export interface PortfolioPosition {
    id: string;
    symbol: string;
    name: string | null;
    quantity: number | null;
    entry_price: number | null;
    entry_at: string | null;
    status: string;
    source: string | null;
    added_at: string | null;
}

export interface PortfolioSnapshot {
    ok: boolean;
    message: string;
    positions: Array<PortfolioPosition & {
        last_price: number | null;
        market_value: number | null;
        cost_basis: number | null;
        profit_pct: number | null;
        profit_value: number | null;
        price_source?: "live" | "stock_prices" | "unavailable";
        price_updated_at?: string | null;
    }>;
    cash_balance: number;
    /** Symbols tracked in the Technical Scanner that are not real holdings yet. */
    watch_positions?: Array<{ symbol: string; name: string | null; last_price: number | null }>;
    totals: {
        positions_count: number;
        cost_basis: number | null;
        market_value: number;
        profit_value: number | null;
        profit_pct: number | null;
        equity: number;
    };
    analysis?: {
        top_symbol: string | null;
        top_position_pct: number;
        cash_pct: number;
        diversification: "منخفض" | "متوسط" | "جيد";
        suggestions: string[];
    };
}

const FREE_PORTFOLIO_LIMIT = 5;

async function hasActiveProPlan(supabase: any, userId: string): Promise<boolean> {
    if (!paymentsEnabled()) return true; // site free until PAYMENTS_ENABLED=true
    try {
        const { data } = await supabase.from("subscriptions").select("plan_id,status,current_period_end").eq("user_id", userId).limit(10);
        return isPro(data || []);
    } catch {
        return false;
    }
}

async function canAddPortfolioPositions(supabase: any, userId: string, additional: number): Promise<{ ok: boolean; message?: string }> {
    if (await hasActiveProPlan(supabase, userId)) return { ok: true };
    const { data, error } = await supabase.from("positions").select("symbol,quantity,source").eq("user_id", userId).eq("status", "open");
    if (error) return { ok: false, message: "تعذر التحقق من حد الخطة المجانية. حاول مرة أخرى." };
    const current = new Set(
        (data || [])
            .filter((row: any) => num(row.quantity) !== null && Number(row.quantity) > 0)
            .map((row: any) => String(row.symbol || "").toUpperCase())
    ).size;
    if (current + additional > FREE_PORTFOLIO_LIMIT) {
        return { ok: false, message: `الخطة المجانية تسمح بحد أقصى ${FREE_PORTFOLIO_LIMIT} أسهم مختلفة في المحفظة. احذف مركزاً أو قم بالترقية لإضافة أسهم أكثر.` };
    }
    return { ok: true };
}

const num = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const fmt = (value: number | null | undefined, digits = 2): string => {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

async function fetchOpenPositions(supabase: any, userId: string): Promise<PortfolioPosition[]> {    const { data, error } = await supabase
        .from("positions")
        .select("id, symbol, name, quantity, entry_price, entry_at, status, source, added_at")
        .eq("user_id", userId)
        .eq("status", "open")
        .order("added_at", { ascending: false })
        .limit(100);
    if (error) throw error;
    return (data || []).map((row: any) => ({
        id: String(row.id),
        symbol: String(row.symbol || "").toUpperCase(),
        name: row.name || null,
        quantity: num(row.quantity),
        entry_price: num(row.entry_price),
        entry_at: row.entry_at || null,
        status: String(row.status || "open"),
        source: row.source || null,
        added_at: row.added_at || null,
    }));
}

/**
 * A real portfolio holding must have a recorded quantity. The Technical
 * Scanner stores "track this stock" entries in the same `positions` table with
 * `source = "tech_scanner"` and `quantity = null`; those are watch items, not
 * holdings, and must never appear in "محفظتي" as zero-share positions.
 */
function isRealHolding(position: PortfolioPosition): boolean {
    return position.quantity !== null && position.quantity > 0;
}

async function fetchCashBalance(supabase: any, userId: string): Promise<number> {
    try {
        const { data } = await supabase
            .from("profiles")
            .select("cash_balance")
            .eq("id", userId)
            .maybeSingle();
        return num(data?.cash_balance) ?? 0;
    } catch {
        return 0;
    }
}

async function upsertCashBalance(supabase: any, userId: string, value: number): Promise<void> {
    const { error } = await supabase
        .from("profiles")
        .update({ cash_balance: value })
        .eq("id", userId);
    if (error) throw error;
}

async function recordEvent(supabase: any, userId: string, positionId: string | null, eventType: string, payload: Record<string, any>): Promise<boolean> {
    try {
        const { error } = await supabase.from("position_events").insert({
            user_id: userId,
            position_id: positionId,
            event_type: eventType,
            payload,
            event_at: new Date().toISOString(),
        });
        return !error;
    } catch {
        return false;
    }
}

async function fetchStockName(supabase: any, symbol: string): Promise<string | null> {
    try {
        const { data } = await supabase
            .from("stocks")
            .select("name, name_ar")
            .eq("symbol", symbol)
            .limit(1);
        return data?.[0]?.name_ar || data?.[0]?.name || null;
    } catch {
        return null;
    }
}

/** True when the symbol is a real listed EGX stock in the stocks table. */
async function symbolExistsInMarket(supabase: any, symbol: string): Promise<boolean> {
    try {
        const { data } = await supabase
            .from("stocks")
            .select("symbol")
            .eq("symbol", symbol)
            .limit(1);
        return Array.isArray(data) && data.length > 0;
    } catch {
        // Fail closed: a database validation failure must never authorize a
        // symbol write during a portfolio replacement.
        return false;
    }
}

/** Insert a position, tolerating a restrictive positions.source enum. */
async function insertPositionRow(supabase: any, row: Record<string, any>): Promise<{ data: any; error: any }> {
    const { data, error } = await supabase.from("positions").insert(row).select("id").single();
    if (error && /symbol_source|enum/i.test(`${error?.message || ""} ${error?.details || ""}`) && row.source !== undefined) {
        // The source enum doesn't accept this value — retry without source
        const { source, ...rest } = row;
        void source;
        return await supabase.from("positions").insert(rest).select("id").single();
    }
    return { data, error };
}

/** Full portfolio snapshot enriched with the latest close prices. */
export async function getPortfolioSnapshot(supabase: any, userId: string): Promise<PortfolioSnapshot> {
    const allPositions = await fetchOpenPositions(supabase, userId);
    // Only real holdings (with a recorded quantity) are the user's portfolio.
    const positions = allPositions.filter(isRealHolding);
    const cash = await fetchCashBalance(supabase, userId);
    const latestPrices = new Map<string, number | null>();

    if (positions.length > 0) {
        try {
            const symbols = Array.from(new Set(positions.map((pos) => pos.symbol).filter(Boolean)));
            const { data: latestDateRows } = await supabase
                .from("stock_prices")
                .select("date")
                .eq("exchange", "EGX")
                .order("date", { ascending: false })
                .limit(1);
            const latestDate = latestDateRows?.[0]?.date;

            if (!latestDate) throw new Error("No market price date available");

            const { data: priceRows } = await supabase
                .from("stock_prices")
                .select("symbol, close")
                .eq("exchange", "EGX")
                .eq("date", latestDate)
                .in("symbol", symbols);

            for (const row of priceRows || []) {
                const symbol = String(row.symbol || "").toUpperCase();
                if (symbol && !latestPrices.has(symbol)) {
                    latestPrices.set(symbol, num(row.close));
                }
            }
        } catch {
            // Keep the snapshot usable when the market-date query is unavailable.
            // This is only a compatibility fallback; the normal path is one batch query.
            await Promise.all(positions.map(async (pos) => {
                try {
                    const { data: priceRow } = await supabase
                        .from("stock_prices")
                        .select("close")
                        .eq("symbol", pos.symbol)
                        .eq("exchange", "EGX")
                        .order("date", { ascending: false })
                        .limit(1);
                    latestPrices.set(pos.symbol, num(priceRow?.[0]?.close));
                } catch {
                    latestPrices.set(pos.symbol, null);
                }
            }));
        }
    }

    const liveSession = isEgxSessionOpen();
    const liveResults = liveSession
        ? await Promise.all(positions.map(async (pos) => [pos.symbol, await fetchLiveStockIndicators(pos.symbol, supabase)] as const))
        : [];
    const liveBySymbol = new Map(liveResults);
    const enriched: PortfolioSnapshot["positions"] = [];
    for (const pos of positions) {
        const live = liveBySymbol.get(pos.symbol);
        const lastPrice = live?.success && live.data?.close ? live.data.close : (latestPrices.get(pos.symbol) ?? null);

        const qty = pos.quantity;
        const entry = pos.entry_price;
        // Zero/negative entry prices are legacy incomplete records, not a free
        // purchase. Keep market value visible but do not fabricate cost/profit.
        const validEntry = entry !== null && entry > 0;
        const costBasis = qty !== null && validEntry ? qty * entry : null;
        const marketValue = qty !== null && lastPrice !== null ? qty * lastPrice : null;
        const profitValue = costBasis !== null && marketValue !== null ? marketValue - costBasis : null;
        const profitPct = costBasis && costBasis > 0 && profitValue !== null ? (profitValue / costBasis) * 100 : null;

        enriched.push({ ...pos, last_price: lastPrice, market_value: marketValue, cost_basis: costBasis, profit_pct: profitPct, profit_value: profitValue, price_source: live?.success ? "live" : lastPrice !== null ? "stock_prices" : "unavailable", price_updated_at: live?.data?.updated_at || null });
    }

    const hasUnknownCost = enriched.some((p) => p.cost_basis === null);
    const totalCost = hasUnknownCost ? null : enriched.reduce((sum, p) => sum + (p.cost_basis || 0), 0);
    const totalValue = enriched.reduce((sum, p) => sum + (p.market_value || 0), 0);
    const totalProfit = totalCost === null ? null : totalValue - totalCost;
    const equity = totalValue + cash;
    const topPosition = [...enriched].sort((a, b) => (b.market_value || 0) - (a.market_value || 0))[0];
    const topPositionPct = equity > 0 ? ((topPosition?.market_value || 0) / equity) * 100 : 0;
    const cashPct = equity > 0 ? (cash / equity) * 100 : 0;
    const diversification = enriched.length >= 5 && topPositionPct < 40 ? "جيد" : enriched.length >= 3 && topPositionPct < 60 ? "متوسط" : "منخفض";
    const suggestions: string[] = [];
    if (topPositionPct >= 50 && topPosition?.symbol) suggestions.push(`مركز ${topPosition.symbol} يمثل ${fmt(topPositionPct, 1)}% من قيمة المحفظة؛ راجع التركيز قبل زيادة المركز.`);
    if (cashPct < 10 && equity > 0) suggestions.push("السيولة أقل من 10% من قيمة المحفظة؛ احتفظ باحتياطي مناسب حسب خطتك.");
    if (enriched.length < 3 && enriched.length > 0) suggestions.push("عدد المراكز قليل؛ التنويع بين أكثر من سهم وقطاع قد يقلل أثر هبوط سهم واحد.");

    return {
        ok: true,
        message: positions.length === 0
            ? "محفظتك فاضية حالياً. ابعتلي صورة محفظتك أو قولي الأسهم اللي معاك وهضيفها فوراً."
            : `محفظتك فيها ${positions.length} سهم.`,
        positions: enriched,
        cash_balance: cash,
        watch_positions: allPositions
            .filter((pos) => !isRealHolding(pos))
            .map((pos) => ({ symbol: pos.symbol, name: pos.name, last_price: latestPrices.get(pos.symbol) ?? null })),
        totals: {
            positions_count: positions.length,
            cost_basis: totalCost,
            market_value: totalValue,
            profit_value: totalProfit,
            profit_pct: totalCost && totalCost > 0 && totalProfit !== null ? (totalProfit / totalCost) * 100 : null,
            equity: totalValue + cash,
        },
        analysis: {
            top_symbol: topPosition?.symbol || null,
            top_position_pct: topPositionPct,
            cash_pct: cashPct,
            diversification,
            suggestions,
        },
    };
}

/** Add a position (or increase the quantity of an existing open one). */
export async function addPortfolioPosition(
    supabase: any,
    userId: string,
    symbol: string,
    quantity: number,
    entryPrice: number | null,
): Promise<{ ok: boolean; message: string }> {
    const sym = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(sym)) {
        return { ok: false, message: `رمز السهم «${symbol}» غير صالح.` };
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return { ok: false, message: "عدد الأسهم لازم يكون رقم أكبر من صفر." };
    }
    if (!(await symbolExistsInMarket(supabase, sym))) {
        return { ok: false, message: `الرمز ${sym} مش موجود في البورصة المصرية. اتأكد من كتابة الرمز الصح (مثلاً COMI أو EAST).` };
    }

    const existing = (await fetchOpenPositions(supabase, userId)).find((p) => p.symbol === sym);
    if (!existing) {
        const capacity = await canAddPortfolioPositions(supabase, userId, 1);
        if (!capacity.ok) return { ok: false, message: capacity.message || "تجاوزت حد المحفظة المجانية." };
    }
    const name = await fetchStockName(supabase, sym);

    if (existing) {
        const newQty = (existing.quantity || 0) + quantity;
        const avgEntry = existing.entry_price && entryPrice
            ? ((existing.entry_price * (existing.quantity || 0)) + (entryPrice * quantity)) / newQty
            : entryPrice ?? existing.entry_price;
        const { error } = await supabase
            .from("positions")
            .update({ quantity: newQty, entry_price: avgEntry, name: existing.name || name })
            .eq("id", existing.id);
        if (error) { console.error("Portfolio add update failed:", error); return { ok: false, message: "فشل تحديث السهم مؤقتًا." }; }
        await recordEvent(supabase, userId, existing.id, "portfolio_add", { symbol: sym, quantity, entry_price: entryPrice });
        return { ok: true, message: `تمام ✅ زودت ${quantity} سهم من ${sym} — إجمالي حوزتك الآن ${newQty} سهم بسعر متوسط ${fmt(avgEntry)} ج.م.` };
    }

    const { data: inserted, error } = await insertPositionRow(supabase, {
        user_id: userId,
        symbol: sym,
        name,
        quantity,
        entry_price: entryPrice,
        status: "open",
        source: "chatbot",
    });
    if (error) { console.error("Portfolio add insert failed:", error); return { ok: false, message: "فشل حفظ السهم مؤقتًا." }; }
    await recordEvent(supabase, userId, inserted?.id || null, "portfolio_add", { symbol: sym, quantity, entry_price: entryPrice });
    return {
        ok: true,
        message: entryPrice
            ? `تمام ✅ ضفت ${quantity} سهم من ${sym} على محفظتك بسعر ${fmt(entryPrice)} ج.م.`
            : `تمام ✅ ضفت ${quantity} سهم من ${sym} على محفظتك.`,
    };
}

/** Update quantity / entry price of an open position. */
export async function updatePortfolioPosition(
    supabase: any,
    userId: string,
    symbol: string,
    quantity: number | null,
    entryPrice: number | null,
): Promise<{ ok: boolean; message: string }> {
    const sym = symbol.trim().toUpperCase();
    const positions = await fetchOpenPositions(supabase, userId);
    const existing = positions.find((p) => p.symbol === sym);
    if (!existing) {
        return { ok: false, message: `مفيش سهم ${sym} مفتوح في محفظتك. ${positions.length ? `الأسهم الحالية: ${positions.map((p) => p.symbol).join("، ")}.` : "محفظتك فاضية."}` };
    }

    const updates: Record<string, any> = {};
    if (quantity !== null && Number.isFinite(quantity) && quantity >= 0) {
        if (quantity === 0) return removePortfolioPosition(supabase, userId, sym);
        updates.quantity = quantity;
    }
    if (entryPrice !== null && Number.isFinite(entryPrice) && entryPrice > 0) {
        updates.entry_price = entryPrice;
    }
    if (Object.keys(updates).length === 0) {
        return { ok: false, message: "محتاج أعرف العدد الجديد أو السعر الجديد للتعديل." };
    }

    const { error } = await supabase.from("positions").update(updates).eq("id", existing.id);
    if (error) { console.error("Portfolio update failed:", error); return { ok: false, message: "فشل تعديل السهم مؤقتًا." }; }
    await recordEvent(supabase, userId, existing.id, "portfolio_update", { symbol: sym, ...updates });
    return { ok: true, message: `تم ✅ عدلت ${sym}: ${updates.quantity !== undefined ? `العدد بقى ${updates.quantity} سهم` : ""}${updates.quantity !== undefined && updates.entry_price !== undefined ? " و" : ""}${updates.entry_price !== undefined ? `السعر ${fmt(updates.entry_price)} ج.م` : ""}.` };
}

/** Fully remove a holding (no cash effect). */
export async function removePortfolioPosition(
    supabase: any,
    userId: string,
    symbol: string,
): Promise<{ ok: boolean; message: string }> {
    const sym = symbol.trim().toUpperCase();
    const positions = await fetchOpenPositions(supabase, userId);
    const existing = positions.find((p) => p.symbol === sym);
    if (!existing) {
        return { ok: false, message: `مفيش سهم ${sym} في محفظتك. ${positions.length ? `الأسهم الحالية: ${positions.map((p) => p.symbol).join("، ")}.` : "محفظتك فاضية."}` };
    }

    const { error } = await supabase
        .from("positions")
        .update({ status: "removed", status_at: new Date().toISOString() })
        .eq("id", existing.id)
        .eq("user_id", userId);
    if (error) {
        // Some legacy deployments have an RLS policy for the position update
        // but not for the historical `removed` status. Fall back to deleting
        // this user's row so the profile action still has the expected result.
        const fallback = await supabase
            .from("positions")
            .delete()
            .eq("id", existing.id)
            .eq("user_id", userId);
        if (fallback.error) { console.error("Portfolio remove fallback failed:", fallback.error); return { ok: false, message: "فشل حذف السهم مؤقتًا." }; }
    }
    await recordEvent(supabase, userId, existing.id, "portfolio_remove", { symbol: sym, quantity: existing.quantity });
    return { ok: true, message: `تم ✅ شيلت ${sym} من محفظتك.` };
}

/** Sell a holding — close it and add proceeds to the cash balance. */
export async function sellPortfolioPosition(
    supabase: any,
    userId: string,
    symbol: string,
    quantity: number | null,
    sellPrice: number | null,
): Promise<{ ok: boolean; message: string }> {
    const sym = symbol.trim().toUpperCase();
    const positions = await fetchOpenPositions(supabase, userId);
    const existing = positions.find((p) => p.symbol === sym);
    if (!existing) {
        return { ok: false, message: `مفيش سهم ${sym} مفتوح في محفظتك. ${positions.length ? `الأسهم الحالية: ${positions.map((p) => p.symbol).join("، ")}.` : "محفظتك فاضية."}` };
    }

    const held = existing.quantity;
    let qtyToSell = quantity ?? held;
    if (held !== null && qtyToSell !== null && qtyToSell > held) {
        qtyToSell = held;
    }
    if (qtyToSell === null || !Number.isFinite(qtyToSell) || qtyToSell <= 0) {
        return { ok: false, message: "عدد الأسهم اللي هتبيعها لازم يكون أكبر من صفر." };
    }

    // Resolve the sell price: explicit > last close > entry price
    let price = sellPrice;
    if (price === null || !Number.isFinite(price)) {
        try {
            const { data: priceRow } = await supabase
                .from("stock_prices")
                .select("close")
                .eq("symbol", sym)
                .eq("exchange", "EGX")
                .order("date", { ascending: false })
                .limit(1);
            price = num(priceRow?.[0]?.close);
        } catch {}
    }
    if (price === null) price = existing.entry_price;
    if (price === null) {
        return { ok: false, message: `محتاج أعرف سعر البيع عشان أسجل بيع ${sym}.` };
    }

    const proceeds = qtyToSell * price;
    const isFullSale = held === null || qtyToSell >= held;

    if (isFullSale) {
        const { error } = await supabase
            .from("positions")
            .update({
                status: "closed",
                status_at: new Date().toISOString(),
                status_price: price,
            })
            .eq("id", existing.id);
        if (error) { console.error("Portfolio sell close failed:", error); return { ok: false, message: "فشل تسجيل البيع مؤقتًا." }; }
    } else {
        const { error } = await supabase
            .from("positions")
            .update({ quantity: (held || 0) - qtyToSell })
            .eq("id", existing.id);
        if (error) { console.error("Portfolio sell update failed:", error); return { ok: false, message: "فشل تسجيل البيع مؤقتًا." }; }
    }

    const cash = await fetchCashBalance(supabase, userId);
    await upsertCashBalance(supabase, userId, cash + proceeds);
    await recordEvent(supabase, userId, existing.id, "portfolio_sell", { symbol: sym, quantity: qtyToSell, sell_price: price, proceeds });

    return {
        ok: true,
        message: `تم ✅ سجلت بيع ${qtyToSell} سهم من ${sym} بسعر ${fmt(price)} ج.م (إجمالي ${fmt(proceeds)} ج.م اتضافت للسيولة). ${isFullSale ? "السهم اتقفل من المحفظة." : `باقي معاك ${(held || 0) - qtyToSell} سهم.`}`,
    };
}

/** Set the free cash balance (absolute value). */
export async function setPortfolioCash(
    supabase: any,
    userId: string,
    amount: number,
): Promise<{ ok: boolean; message: string }> {
    if (!Number.isFinite(amount) || amount < 0) {
        return { ok: false, message: "قيمة السيولة لازم تكون رقم موجب." };
    }
    try {
        await upsertCashBalance(supabase, userId, amount);
        await recordEvent(supabase, userId, null, "portfolio_cash_set", { amount });
        return { ok: true, message: `تم ✅ السيولة في محفظتك الآن ${fmt(amount)} ج.م.` };
    } catch (e: any) {
        console.error("Portfolio cash update failed:", e);
        return { ok: false, message: "فشل تحديث السيولة مؤقتًا." };
    }
}

/** Add (deposit) an amount on top of the existing free cash balance. */
export async function addPortfolioCash(
    supabase: any,
    userId: string,
    amount: number,
): Promise<{ ok: boolean; message: string }> {
    if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, message: "قيمة الإيداع لازم تكون رقم أكبر من صفر." };
    }
    try {
        const current = await fetchCashBalance(supabase, userId);
        const updated = current + amount;
        await upsertCashBalance(supabase, userId, updated);
        await recordEvent(supabase, userId, null, "portfolio_cash_add", { amount, previous: current, updated });
        return { ok: true, message: `تم ✅ ضفت ${fmt(amount)} ج.م للسيولة — الإجمالي الآن ${fmt(updated)} ج.م.` };
    } catch (e: any) {
        console.error("Failed to add portfolio cash:", e);
        return { ok: false, message: "فشل تحديث السيولة مؤقتًا. حاول مرة أخرى." };
    }
}

/** Replace the whole portfolio from a confirmed screenshot (chatbot flow). */
export async function replacePortfolioFromImage(
    supabase: any,
    userId: string,
    items: Array<{ symbol: string; quantity: number | null; price: number | null }>,
): Promise<{ ok: boolean; message: string }> {
    if (!items || items.length === 0) {
        return { ok: false, message: "مفيش أسهم واضحة في الصورة." };
    }
    const uniqueIncoming = new Set(items.map(item => String(item.symbol || "").trim().toUpperCase()).filter(Boolean));
    if (!(await hasActiveProPlan(supabase, userId)) && uniqueIncoming.size > FREE_PORTFOLIO_LIMIT) {
        return { ok: false, message: `الخطة المجانية تسمح بحد أقصى ${FREE_PORTFOLIO_LIMIT} أسهم مختلفة في المحفظة. الصورة تحتوي على ${uniqueIncoming.size} أسهماً.` };
    }

    const normalizedItems = items.map(item => ({
        ...item,
        symbol: String(item.symbol || "").trim().toUpperCase(),
    }));
    if (normalizedItems.some(item => !/^[A-Z]{2,6}$/.test(item.symbol))) {
        return { ok: false, message: "الصورة تحتوي على رمز سهم غير صالح، ولم يتم تعديل المحفظة القديمة." };
    }
    const uniqueSymbols = new Set(normalizedItems.map(item => item.symbol));
    if (uniqueSymbols.size !== normalizedItems.length) {
        return { ok: false, message: "الصورة تحتوي على سهم مكرر، ولم يتم تعديل المحفظة القديمة." };
    }
    if (normalizedItems.some(item => !Number.isFinite(item.quantity) || item.quantity == null || item.quantity <= 0
        || !Number.isFinite(item.price) || item.price == null || item.price <= 0)) {
        return { ok: false, message: "الكميات أو أسعار الشراء في الصورة غير صالحة، ولم يتم تعديل المحفظة القديمة." };
    }

    // Validate every symbol before any write. This prevents a partial image
    // import from replacing the existing portfolio with only some holdings.
    for (const item of normalizedItems) {
        if (!(await symbolExistsInMarket(supabase, item.symbol))) {
            return { ok: false, message: `السهم ${item.symbol} غير موجود في السوق، ولم يتم تعديل المحفظة القديمة.` };
        }
    }

    // Insert the replacement first; preserve the old portfolio if insertion
    // fails. The compensating updates below cover failures during replacement.
    const positions = await fetchOpenPositions(supabase, userId);
    let added = 0;
    const insertedIds: string[] = [];
    for (const item of normalizedItems) {
        const sym = item.symbol;
        const name = await fetchStockName(supabase, sym);
        const { data: inserted, error } = await insertPositionRow(supabase, {
            user_id: userId,
            symbol: sym,
            name,
            quantity: item.quantity,
            entry_price: item.price,
            status: "open",
            source: "chatbot_image",
        });
        if (error || !inserted) {
            let rollbackFailed = false;
            for (const id of insertedIds) {
                const rollback = await supabase.from("positions").delete().eq("id", id).eq("user_id", userId);
                if (rollback.error) rollbackFailed = true;
            }
            return { ok: false, message: rollbackFailed
                ? "حدث خطأ أثناء حفظ الصورة. أوقفنا العملية وتحتاج مراجعة حالة المحفظة من الدعم."
                : `تعذر حفظ السهم ${sym}، ولم يتم تعديل المحفظة القديمة.` };
        }
        added++;
        insertedIds.push(inserted.id);
        const eventSaved = await recordEvent(supabase, userId, inserted.id, "portfolio_image_import", { symbol: sym, quantity: item.quantity, price: item.price });
        if (!eventSaved) {
            let rollbackFailed = false;
            for (const id of insertedIds) {
                const rollback = await supabase.from("positions").delete().eq("id", id).eq("user_id", userId);
                if (rollback.error) rollbackFailed = true;
            }
            return { ok: false, message: rollbackFailed
                ? "حدث خطأ أثناء تسجيل الاستيراد. أوقفنا العملية وتحتاج مراجعة حالة المحفظة من الدعم."
                : "تعذر تسجيل عملية الاستيراد بأمان، ولم يتم تعديل المحفظة القديمة." };
        }
    }

    if (added === 0) {
        return { ok: false, message: "تعذر حفظ أي سهم من الصورة — اتأكد إن الرموز ظاهرة بوضوح." };
    }
    const latestPositions = (await fetchOpenPositions(supabase, userId)).filter(pos => !insertedIds.includes(pos.id));
    const expectedIds = positions.map(pos => pos.id).sort().join(",");
    const latestIds = latestPositions.map(pos => pos.id).sort().join(",");
    if (expectedIds !== latestIds) {
        for (const id of insertedIds) {
            await supabase.from("positions").delete().eq("id", id).eq("user_id", userId);
        }
        return { ok: false, message: "تغيرت المحفظة أثناء الاستيراد، ولم يتم تعديل المحفظة القديمة." };
    }
    const removedIds: string[] = [];
    for (const pos of positions) {
        const { error } = await supabase
            .from("positions")
            .update({ status: "removed", status_at: new Date().toISOString() })
            .eq("id", pos.id);
        if (error) {
            let rollbackFailed = false;
            for (const id of insertedIds) {
                const rollback = await supabase.from("positions").delete().eq("id", id).eq("user_id", userId);
                if (rollback.error) rollbackFailed = true;
            }
            for (const restoredId of removedIds) {
                const restore = await supabase.from("positions").update({ status: "open", status_at: null }).eq("id", restoredId).eq("user_id", userId);
                if (restore.error) rollbackFailed = true;
            }
            return { ok: false, message: rollbackFailed
                ? "حدث خطأ أثناء استبدال المحفظة. أوقفنا العملية وتحتاج مراجعة حالة المحفظة من الدعم."
                : "تعذر استبدال المحفظة بأمان، ولم يتم حذف المحفظة القديمة." };
        }
        removedIds.push(pos.id);
    }
    return { ok: true, message: `تم ✅ حفظ محفظتك من الصورة: ${added} سهم ${added === 1 ? "" : ""}اتسجلوا في حسابك.` };
}
