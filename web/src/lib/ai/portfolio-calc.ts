/**
 * portfolio-calc.ts
 *
 * Portfolio arithmetic lives in code, not in the language model. Cost, P/L,
 * weights and percentages are computed here from confirmed inputs; the model
 * only explains the resulting numbers. Every derived value carries its formula
 * so the answer gate can verify the claim instead of pattern-matching digits.
 */

export interface PositionInput {
    symbol: string;
    quantity: number;
    entry_price: number;
    last_price: number | null;
}

export interface PositionMath {
    symbol: string;
    quantity: number;
    entry_price: number;
    last_price: number | null;
    cost_basis: number;
    market_value: number | null;
    profit_value: number | null;
    profit_pct: number | null;
    weight_pct: number | null;
}

export interface PortfolioMath {
    positions: PositionMath[];
    totals: {
        positions_count: number;
        cost_basis: number;
        market_value: number;
        profit_value: number;
        profit_pct: number | null;
        cash_balance: number;
        equity: number;
        cash_pct: number | null;
        top_symbol: string | null;
        top_position_pct: number;
    };
    formulas: Record<string, string>;
}

const round = (value: number, digits = 2): number => {
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
};

export const PORTFOLIO_FORMULAS = {
    cost_basis: "تكلفة المركز = الكمية × متوسط سعر الشراء",
    market_value: "القيمة السوقية = الكمية × آخر سعر متاح",
    profit_value: "الربح/الخسارة = القيمة السوقية − التكلفة",
    profit_pct: "نسبة الربح = (الربح ÷ التكلفة) × 100",
    weight_pct: "وزن المركز = (القيمة السوقية ÷ إجمالي القيمة السوقية) × 100",
    equity: "صافي الأصول = إجمالي القيمة السوقية + الرصيد النقدي",
    cash_pct: "نسبة السيولة = (الرصيد النقدي ÷ صافي الأصول) × 100",
    profit_pct_total: "نسبة ربح المحفظة = (إجمالي الربح ÷ إجمالي التكلفة) × 100",
} as const;

function isValidPosition(position: PositionInput): boolean {
    return Boolean(
        position
        && position.symbol
        && Number.isFinite(position.quantity)
        && position.quantity > 0
        && Number.isFinite(position.entry_price)
        && position.entry_price > 0
    );
}

/**
 * Programmatic portfolio math from confirmed inputs. Unpriced positions keep a
 * cost basis but no market value, so the model cannot invent a P/L for them.
 */
export function calculatePortfolio(positions: PositionInput[], cashBalance = 0): PortfolioMath {
    const valid = (Array.isArray(positions) ? positions : []).filter(isValidPosition);

    const rows: PositionMath[] = valid.map(position => {
        const cost = round(position.quantity * position.entry_price);
        const priced = position.last_price != null && Number.isFinite(position.last_price) && position.last_price > 0;
        const marketValue = priced ? round(position.quantity * Number(position.last_price)) : null;
        const profitValue = marketValue == null ? null : round(marketValue - cost);
        const profitPct = marketValue == null || cost === 0 ? null : round(((marketValue - cost) / cost) * 100);
        return {
            symbol: String(position.symbol).toUpperCase(),
            quantity: position.quantity,
            entry_price: position.entry_price,
            last_price: priced ? Number(position.last_price) : null,
            cost_basis: cost,
            market_value: marketValue,
            profit_value: profitValue,
            profit_pct: profitPct,
            weight_pct: null,
        };
    });

    const totalCost = round(rows.reduce((sum, row) => sum + row.cost_basis, 0));
    const totalMarket = round(
        rows.reduce((sum, row) => sum + (row.market_value == null ? row.cost_basis : row.market_value), 0)
    );
    const totalProfit = round(totalMarket - totalCost);
    const cash = Number.isFinite(cashBalance) ? round(cashBalance) : 0;
    const equity = round(totalMarket + cash);

    for (const row of rows) {
        const value = row.market_value == null ? row.cost_basis : row.market_value;
        row.weight_pct = totalMarket > 0 ? round((value / totalMarket) * 100) : null;
    }

    let topSymbol: string | null = null;
    let topWeight = 0;
    for (const row of rows) {
        if (row.weight_pct != null && row.weight_pct > topWeight) {
            topWeight = row.weight_pct;
            topSymbol = row.symbol;
        }
    }

    return {
        positions: rows,
        totals: {
            positions_count: rows.length,
            cost_basis: totalCost,
            market_value: totalMarket,
            profit_value: totalProfit,
            profit_pct: totalCost > 0 ? round((totalProfit / totalCost) * 100) : null,
            cash_balance: cash,
            equity,
            cash_pct: equity > 0 ? round((cash / equity) * 100) : null,
            top_symbol: topSymbol,
            top_position_pct: topWeight,
        },
        formulas: { ...PORTFOLIO_FORMULAS },
    };
}

/** Checks whether a claimed derived number matches a portfolio formula result. */
export function matchesPortfolioMath(
    value: number,
    math: PortfolioMath,
    tolerance = 0.05
): { ok: boolean; formula?: string; expected?: number } {
    const candidates: Array<{ expected: number; formula: string }> = [];
    for (const row of math.positions) {
        candidates.push({ expected: row.cost_basis, formula: `${row.symbol}: ${PORTFOLIO_FORMULAS.cost_basis}` });
        if (row.market_value != null) candidates.push({ expected: row.market_value, formula: `${row.symbol}: ${PORTFOLIO_FORMULAS.market_value}` });
        if (row.profit_value != null) candidates.push({ expected: row.profit_value, formula: `${row.symbol}: ${PORTFOLIO_FORMULAS.profit_value}` });
        if (row.profit_pct != null) candidates.push({ expected: row.profit_pct, formula: `${row.symbol}: ${PORTFOLIO_FORMULAS.profit_pct}` });
        if (row.weight_pct != null) candidates.push({ expected: row.weight_pct, formula: `${row.symbol}: ${PORTFOLIO_FORMULAS.weight_pct}` });
    }
    candidates.push({ expected: math.totals.cost_basis, formula: PORTFOLIO_FORMULAS.cost_basis });
    candidates.push({ expected: math.totals.market_value, formula: PORTFOLIO_FORMULAS.market_value });
    candidates.push({ expected: math.totals.profit_value, formula: PORTFOLIO_FORMULAS.profit_value });
    if (math.totals.profit_pct != null) candidates.push({ expected: math.totals.profit_pct, formula: PORTFOLIO_FORMULAS.profit_pct_total });
    candidates.push({ expected: math.totals.equity, formula: PORTFOLIO_FORMULAS.equity });
    if (math.totals.cash_pct != null) candidates.push({ expected: math.totals.cash_pct, formula: PORTFOLIO_FORMULAS.cash_pct });
    if (math.totals.top_position_pct > 0) candidates.push({ expected: math.totals.top_position_pct, formula: PORTFOLIO_FORMULAS.weight_pct });

    for (const candidate of candidates) {
        const allowed = Math.max(tolerance, Math.abs(candidate.expected) * 0.005);
        if (Math.abs(value - candidate.expected) <= allowed) {
            return { ok: true, formula: candidate.formula, expected: candidate.expected };
        }
    }
    return { ok: false };
}
