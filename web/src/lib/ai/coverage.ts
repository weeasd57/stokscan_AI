/**
 * coverage.ts
 *
 * Tool coverage for the request contract. The planner first records which
 * facts the answer needs; the executor then picks tools that supply them. After
 * execution this module reports which required facts are actually backed by a
 * usable tool result. A missing fact must surface in the answer (or be fetched)
 * instead of the system silently swapping the question for an easier one.
 */

import { ToolAvailability, ToolResult } from "./types";

export type RequiredFact =
    | "stock_quote"
    | "technical_indicators"
    | "price_levels"
    | "news"
    | "corporate_actions"
    | "liquidity"
    | "accumulation"
    | "distribution"
    | "market_summary"
    | "recommendations"
    | "historical_prices"
    | "portfolio_positions";

export const REQUIRED_FACTS: readonly RequiredFact[] = [
    "stock_quote",
    "technical_indicators",
    "price_levels",
    "news",
    "corporate_actions",
    "liquidity",
    "accumulation",
    "distribution",
    "market_summary",
    "recommendations",
    "historical_prices",
    "portfolio_positions",
];

/** Which tools can actually produce each required fact. */
export const FACT_TOOLS: Record<RequiredFact, string[]> = {
    stock_quote: ["get_stock", "get_comparison"],
    technical_indicators: ["get_stock", "get_comparison", "get_technical_scan"],
    price_levels: ["get_stock_levels", "get_stock", "get_comparison"],
    news: ["get_news", "search_web"],
    corporate_actions: ["get_corporate_actions"],
    liquidity: ["get_stock", "get_comparison", "get_sector_liquidity", "get_price_history"],
    accumulation: ["get_accumulation_stocks", "get_technical_scan"],
    distribution: ["get_distribution_stocks", "get_technical_scan"],
    market_summary: ["get_market"],
    recommendations: ["get_recommendations", "get_signals"],
    historical_prices: ["get_price_history"],
    portfolio_positions: ["manage_portfolio", "get_portfolio"],
};

export interface FactCoverage {
    fact: RequiredFact;
    covered: boolean;
    status: "covered" | "partial" | "unsupported" | "stale" | "empty" | "missing_tool" | "failed";
    tools_used: string[];
    note?: string;
}

export interface CoverageReport {
    required: RequiredFact[];
    facts: FactCoverage[];
    missing: RequiredFact[];
    uncovered: RequiredFact[];
    /** True when every required fact is backed by usable data. */
    complete: boolean;
    checked_at: string;
}

function availabilityOf(result: ToolResult): ToolAvailability {
    return result.availability || "available";
}

function isUsable(result: ToolResult): boolean {
    if (result.error) return false;
    const availability = availabilityOf(result);
    return availability === "available" || availability === "partial" || availability === "stale";
}

/**
 * Checks whether the executed tools actually cover the facts the request
 * contract asked for. News freshness is part of coverage: a "today" news
 * request backed only by older rows is `stale`, not `covered`.
 */
export function checkCoverage(
    required: RequiredFact[],
    toolResults: ToolResult[],
    options: { newsMustBeToday?: boolean; today?: string } = {}
): CoverageReport {
    const checkedAt = new Date().toISOString();
    const results = Array.isArray(toolResults) ? toolResults : [];
    const wanted = Array.from(new Set((required || []).filter(fact => REQUIRED_FACTS.includes(fact))));
    const today = options.today || new Date().toISOString().slice(0, 10);

    const facts: FactCoverage[] = wanted.map(fact => {
        const acceptedTools = FACT_TOOLS[fact] || [];
        const used = results.filter(result => acceptedTools.includes(result.tool));
        const toolsUsed = used.map(result => result.tool);

        if (used.length === 0) {
            return {
                fact,
                covered: false,
                status: "missing_tool",
                tools_used: [],
                note: `لا توجد أداة منفذة تغطي المطلوب: ${fact}`,
            };
        }

        const usable = used.filter(isUsable);
        if (usable.length === 0) {
            const failed = used.every(result => availabilityOf(result) === "failed");
            return {
                fact,
                covered: false,
                status: failed ? "failed" : "empty",
                tools_used: toolsUsed,
                note: failed
                    ? `فشل جلب ${fact} من ${toolsUsed.join(", ")}`
                    : `المصدر ردّ بدون بيانات تغطي: ${fact}`,
            };
        }

        if (fact === "news" && options.newsMustBeToday) {
            const todayRows = usable.some(result => {
                const rows = Array.isArray(result.data) ? result.data : result.data?.results || [];
                return rows.some((row: any) => {
                    const published = row?.published_at || row?.date || row?.created_at || null;
                    return typeof published === "string" && published.slice(0, 10) === today;
                });
            });
            if (!todayRows) {
                return {
                    fact,
                    covered: false,
                    status: "stale",
                    tools_used: toolsUsed,
                    note: `لا يوجد خبر منشور بتاريخ اليوم (${today}) — التغطية أقدم من المطلوب`,
                };
            }
        }

        const partial = usable.some(result => availabilityOf(result) === "partial" || availabilityOf(result) === "stale");
        return {
            fact,
            covered: true,
            status: partial ? "partial" : "covered",
            tools_used: toolsUsed,
        };
    });

    const missing = facts.filter(entry => entry.status === "missing_tool" || entry.status === "failed").map(entry => entry.fact);
    const uncovered = facts.filter(entry => !entry.covered).map(entry => entry.fact);

    return {
        required: wanted,
        facts,
        missing,
        uncovered,
        complete: uncovered.length === 0,
        checked_at: checkedAt,
    };
}

/** Human-readable gap list for the correction prompt / answer text. */
export function describeCoverageGaps(report: CoverageReport): string[] {
    return report.facts
        .filter(entry => !entry.covered)
        .map(entry => entry.note || `تغطية ناقصة لـ ${entry.fact}`);
}
