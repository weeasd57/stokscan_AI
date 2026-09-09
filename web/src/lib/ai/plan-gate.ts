/**
 * plan-gate.ts — centralized plan tier + feature gating for the frontend.
 *
 * Mirrors api/plan_limits.py. Single source of truth for the two tiers and the
 * PASTYMENTS_ENABLED master flag. When payments are disabled (default) the
 * platform is FREE-UNLIMITED (no signal delay, no message cap, no stock cap);
 * the site stays completely free until the operator flips the env flag.
 */

export interface PlanLimits {
  name: string;
  signal_delay_days: number;
  chat_messages_per_month: number;
  portfolio_stocks: number;
  price_egp: number;
  billing: "enabled" | "disabled";
}

export function paymentsEnabled(): boolean {
  const v = (process.env.PAYMENTS_ENABLED || "false").trim().toLowerCase();
  return !["0", "false", "no", "off", ""].includes(v);
}

const FREE: PlanLimits = {
  name: "free",
  signal_delay_days: Number(process.env.FREE_SIGNAL_DELAY_DAYS || "5"),
  chat_messages_per_month: Number(process.env.FREE_CHAT_MESSAGES || "50"),
  portfolio_stocks: Number(process.env.FREE_PORTFOLIO_STOCKS || "5"),
  price_egp: 0,
  billing: "enabled",
};

const PRO: PlanLimits = {
  name: "pro",
  signal_delay_days: 0,
  chat_messages_per_month: Number(process.env.PRO_CHAT_MESSAGES || "350"),
  portfolio_stocks: Number(process.env.PRO_PORTFOLIO_STOCKS || "10"),
  price_egp: Number(process.env.KASHIER_PRO_PRICE_EGP || "300"),
  billing: "enabled",
};

const UNLIMITED: PlanLimits = {
  ...FREE,
  signal_delay_days: 0,
  chat_messages_per_month: Number.MAX_SAFE_INTEGER,
  portfolio_stocks: Number.MAX_SAFE_INTEGER,
  billing: "disabled",
};

export function planLimits(planId?: string | null): PlanLimits {
  if (!paymentsEnabled()) {
    return { ...UNLIMITED };
  }
  return (planId || "").toLowerCase() === "pro" ? { ...PRO } : { ...FREE };
}

export function isPro(rows: Array<{ plan_id?: unknown; status?: unknown; current_period_end?: unknown | null }>): boolean {
  if (!paymentsEnabled()) {
    return true; // free site: everything available
  }
  const now = Date.now();
  for (const row of rows || []) {
    const plan = String(row.plan_id || "").toLowerCase();
    if (plan !== "pro" || String(row.status || "").toLowerCase() !== "active") {
      continue;
    }
    if (row.current_period_end) {
      const end = new Date(String(row.current_period_end)).getTime();
      if (Number.isFinite(end) && end <= now) {
        continue; // expired
      }
    }
    return true;
  }
  return false;
}

/** Filter recommendations to those at least N days old (for free users). */
export function filterByDelay<T extends { created_at?: string | null }>(
  rows: T[],
  delayDays: number,
): T[] {
  if (delayDays <= 0) {
    return rows;
  }
  const cutoff = Date.now() - delayDays * 24 * 60 * 60 * 1000;
  return rows.filter((r) => {
    if (!r.created_at) return false;
    return new Date(r.created_at).getTime() <= cutoff;
  });
}
