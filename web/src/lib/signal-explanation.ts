/** Explain saved signals without another model call or invented feature attribution. */
export function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function savedSignalReasons(value: unknown): string[] {
  if (typeof value === "string") {
    try { return savedSignalReasons(JSON.parse(value)); } catch { return value.trim() ? [value.trim()] : []; }
  }
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  if (!value || typeof value !== "object") return [];
  const details = value as Record<string, unknown>;
  return [...new Set([
    ...savedSignalReasons(details.text_reasons),
    ...[details.brief_rationale, details.technical_rationale, details.fundamental_rationale]
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim())),
  ])];
}

export interface SignalExplanationInput {
  signal?: string;
  entry_price?: unknown;
  target_price?: unknown;
  stop_loss?: unknown;
  current_price?: unknown;
  precision?: unknown;
  top_reasons?: unknown;
  created_at?: string | null;
  price_date?: string | null;
}

export function explainSignal(input: SignalExplanationInput) {
  const direction = /SELL/i.test(input.signal || "") ? -1 : 1;
  const entry = finiteNumber(input.entry_price);
  const target = finiteNumber(input.target_price);
  const stop = finiteNumber(input.stop_loss);
  const current = finiteNumber(input.current_price);
  const validEntry = entry !== null && entry > 0;
  const reward = validEntry && target !== null && target > 0 ? direction * (target - entry) : null;
  const risk = validEntry && stop !== null && stop > 0 ? direction * (entry - stop) : null;
  const score = finiteNumber(input.precision);
  const currentReward = current !== null && current > 0 && target !== null && target > 0 ? direction * (target - current) / current * 100 : null;
  return {
    reasons: savedSignalReasons(input.top_reasons),
    rewardPct: reward !== null && reward > 0 && entry ? reward / entry * 100 : null,
    riskPct: risk !== null && risk > 0 && entry ? risk / entry * 100 : null,
    rewardRisk: reward !== null && reward > 0 && risk !== null && risk > 0 ? reward / risk : null,
    remainingPct: currentReward,
    protectedStop: risk !== null && risk <= 0,
    invalidTarget: reward !== null && reward <= 0,
    crossedStop: current !== null && current > 0 && stop !== null && stop > 0 && direction * (current - stop) <= 0,
    scorePct: score !== null && score >= 0 && score <= 1 ? score * 100 : null,
  };
}
