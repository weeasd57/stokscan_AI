export const MIN_SIMILARITY = 0.8;
export type SimilarityPoint = { date: string; close: number; rel_change?: number; day?: number; return?: number };
export type SimilarityMatch = {
  symbol: string; date: string; similarity: number; outcome: string; final_return: number | null;
  mfe: number; mae: number; exit_date?: string | null; exit_reason?: string;
  before_path: SimilarityPoint[]; forward_path: SimilarityPoint[];
  market_context?: string | null; sector_context?: string | null;
};
export type HorizonStats = {
  sessions: number; sample_size: number; positive_rate: number; average_return: number | null;
  median_return: number | null; best_return: number | null; worst_return: number | null;
  lower_quartile: number | null; upper_quartile: number | null;
};
export type SimilarityStats = {
  total_matches: number; observed_matches: number; wins: number; losses: number; flat: number;
  win_rate: number | null; average_return: number | null; median_return: number | null;
  profit_factor: number | null; win_interval: [number, number] | null;
  average_similarity: number | null; exit_counts: Record<string, number>;
  horizon_stats: Record<string, HorizonStats>;
};
export type SimilarityScan = {
  symbol: string; name: string; sector: string; target_date: string; target_path?: SimilarityPoint[];
  matches?: SimilarityMatch[]; stats: SimilarityStats; rejected_matches: number;
  current_market?: string | null; current_sector?: string | null;
  context_coverage?: { market: number; sector: number; matched: number; observed: number };
};
export type SimilarityReport = {
  id: string | null; name: string; updated_at: string | null; as_of: string | null;
  k: number; forward_days: number; target_return: number; stop_loss: number;
  minimum_similarity: number; scans: SimilarityScan[];
  excluded: { stale: number; indices: number }; features?: string[];
};

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  return sorted[Math.floor(index)] + (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index % 1);
}
export function wilsonInterval(wins: number, total: number): [number, number] | null {
  if (!total) return null;
  const z = 1.96, p = wins / total, denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}
export function calculateSimilarityStats(matches: SimilarityMatch[], forwardDays: number, target: number, stop: number): SimilarityStats {
  const completed = matches.filter(m => ["win", "loss", "flat"].includes(m.outcome) && finite(m.final_return));
  const returns = completed.map(m => m.final_return as number);
  const wins = returns.filter(r => r > 0).length, losses = returns.filter(r => r < 0).length;
  const gains = returns.reduce((sum, r) => sum + Math.max(0, r), 0);
  const loss = -returns.reduce((sum, r) => sum + Math.min(0, r), 0);
  const exit_counts: Record<string, number> = { target: 0, stop: 0, horizon_positive: 0, horizon_negative: 0, horizon_flat: 0, incomplete: 0 };
  for (const match of matches) {
    const reason = match.exit_reason || (match.final_return == null ? "incomplete"
      : Math.abs(match.final_return - target) < 1e-8 ? "target"
      : Math.abs(match.final_return - stop) < 1e-8 ? "stop"
      : match.final_return > 0 ? "horizon_positive" : match.final_return < 0 ? "horizon_negative" : "horizon_flat");
    exit_counts[reason] = (exit_counts[reason] || 0) + 1;
  }
  const horizon_stats: Record<string, HorizonStats> = {};
  for (const horizon of [5, 10, 20].filter(h => h <= forwardDays)) {
    const values = matches.map(m => m.forward_path?.find(p => p.day === horizon)?.return).filter(finite);
    horizon_stats[String(horizon)] = {
      sessions: horizon, sample_size: values.length,
      positive_rate: values.length ? values.filter(v => v > 0).length / values.length : 0,
      average_return: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
      median_return: quantile(values, .5), lower_quartile: quantile(values, .25), upper_quartile: quantile(values, .75),
      best_return: values.length ? Math.max(...values) : null, worst_return: values.length ? Math.min(...values) : null,
    };
  }
  return {
    total_matches: completed.length, observed_matches: matches.length, wins, losses, flat: completed.length - wins - losses,
    win_rate: completed.length ? wins / completed.length : null,
    average_return: returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : null,
    median_return: quantile(returns, .5), profit_factor: loss ? gains / loss : null,
    win_interval: wilsonInterval(wins, completed.length),
    average_similarity: matches.length ? matches.reduce((sum, m) => sum + m.similarity, 0) / matches.length : null,
    exit_counts, horizon_stats,
  };
}

/** Existing reports are re-evaluated as well, so weak cases cannot survive until the next daily scan. */
export function prepareSimilarityReport(raw: any, minimum = MIN_SIMILARITY): SimilarityReport {
  const scans: any[] = Array.isArray(raw?.scans) ? raw.scans : [];
  const as_of = scans.map(s => s.target_date).filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1) || null;
  const reportDay = as_of ? Date.parse(as_of) : null;
  const forward_days = Number(raw?.forward_days) || 20;
  const target_return = Number(raw?.target_return) || .05, stop_loss = Number(raw?.stop_loss) || -.03;
  const excluded = { stale: 0, indices: 0 };
  const cleaned: SimilarityScan[] = [];
  const seen = new Set<string>();
  for (const scan of scans) {
    if (!scan.symbol || seen.has(scan.symbol)) continue;
    seen.add(scan.symbol);
    if (/^EGX\d/i.test(scan.symbol)) { excluded.indices++; continue; }
    const date = Date.parse(scan.target_date);
    if (!Number.isFinite(date) || (reportDay != null && (reportDay - date) / 86400000 > 5)) { excluded.stale++; continue; }
    const original: SimilarityMatch[] = Array.isArray(scan.matches) ? scan.matches : [];
    const matches: SimilarityMatch[] = [];
    for (const candidate of [...original].sort((a, b) => b.similarity - a.similarity)) {
      if (!finite(candidate.similarity) || candidate.similarity < minimum || candidate.date >= scan.target_date) continue;
      // Legacy reports spaced cases in calendar days; enforce non-overlapping forward sessions as well.
      if (matches.some(accepted => accepted.date === candidate.date ||
        (accepted.date < candidate.date && accepted.forward_path.some(point => point.date >= candidate.date)) ||
        (candidate.date < accepted.date && candidate.forward_path.some(point => point.date >= accepted.date)))) continue;
      matches.push(candidate);
    }
    cleaned.push({
      symbol: scan.symbol, name: scan.name || scan.symbol.split(".")[0], sector: scan.sector || "Other",
      target_date: scan.target_date, target_path: scan.target_path || [], matches,
      stats: calculateSimilarityStats(matches, forward_days, target_return, stop_loss),
      rejected_matches: original.length - matches.length,
    });
  }
  cleaned.sort((a, b) => b.stats.total_matches - a.stats.total_matches ||
    (b.stats.average_similarity ?? -Infinity) - (a.stats.average_similarity ?? -Infinity));
  return { id: raw?.id || null, name: raw?.name || "", updated_at: raw?.updated_at || null,
    as_of, k: Number(raw?.k) || 10, forward_days, target_return, stop_loss, minimum_similarity: minimum,
    scans: cleaned, excluded };
}

/** Calendar-aligned, past-only context. Missing or old observations remain unknown. */
export function marketRegimeAt(rows: Array<{ date: string; close: number }>, date: string): string | null {
  const prices = rows.filter(r => r.date <= date && finite(r.close) && r.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const last = prices.at(-1);
  if (!last || prices.length < 21 || Date.parse(date) - Date.parse(last.date) > 5 * 86400000) return null;
  const short = last.close / prices[prices.length - 6].close - 1;
  const long = last.close / prices[prices.length - 21].close - 1;
  return short < -.015 || long < -.04 ? "down" : short > .01 && long > .01 ? "up" : "range";
}
export function sectorFlowAt(rows: Array<{ date: string; cmf: number }>, date: string): string | null {
  const available = rows.filter(r => r.date <= date && finite(r.cmf)).sort((a, b) => a.date.localeCompare(b.date));
  const last = available.at(-1);
  if (!last || Date.parse(date) - Date.parse(last.date) > 5 * 86400000) return null;
  return last.cmf < -.05 ? "outflow" : last.cmf > .05 ? "inflow" : "balanced";
}
