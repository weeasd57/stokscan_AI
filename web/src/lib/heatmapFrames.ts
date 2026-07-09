type HeatmapRow = {
  date?: string | number | null;
  close?: number | string | null;
  volume?: number | string | null;
  change_pct?: number | string | null;
  sector?: string | number | null;
  symbol?: string;
  name?: string;
};

type HeatmapFrameSector = {
  sector: string;
  sector_ar: string;
  money_flow: number;
  change_pct: number;
  market_share: number;
  stocks_count: number;
  stocks: Array<{
    symbol?: string;
    name?: string;
    close: number;
    volume: number;
    change_pct: number;
    money_flow: number;
    weight_in_sector?: number;
  }>;
  sentiment: string;
};

const normalizeSector = (sector: string | number | null | undefined): string => {
  const raw = String(sector || "Other").trim();
  if (!raw) return "Other";
  const s = raw.toLowerCase();
  if (s.includes("real estate") || s.includes("عقارات")) return "Real Estate";
  if (s.includes("financial") || s.includes("bank") || s.includes("investment") || s.includes("مالية") || s.includes("بنوك")) return "Financial Services";
  if (s.includes("construction") || s.includes("cement") || s.includes("building") || s.includes("بناء") || s.includes("تشييد")) return "Construction";
  if (s.includes("material") || s.includes("mining") || s.includes("steel") || s.includes("حديد") || s.includes("تعدين")) return "Materials";
  if (s.includes("utility") || s.includes("energy") || s.includes("طاقة") || s.includes("مرافق")) return "Utilities";
  if (s.includes("health") || s.includes("pharma") || s.includes("medical") || s.includes("أدوية")) return "Health Care";
  if (s.includes("food") || s.includes("beverage") || s.includes("dairy") || s.includes("أغذية") || s.includes("مشروبات")) return "Food & Beverage";
  if (s.includes("telecom") || s.includes("communication") || s.includes("technology") || s.includes("اتصالات")) return "Telecom";
  if (s.includes("chemical") || s.includes("fertilizer") || s.includes("كيماويات") || s.includes("أسمدة")) return "Chemicals";
  if (s.includes("industrial") || s.includes("manufacturing") || s.includes("paper") || s.includes("صناعات")) return "Industrial Goods";
  return raw;
};

const getHeatmapSentiment = (changePct: number, flowBias: number): string => {
  if (changePct >= 1.0 && flowBias > 0.05) return "strong_accumulation";
  if (changePct > 0.0) return "accumulation";
  if (changePct <= -1.0 && flowBias < -0.05) return "strong_distribution";
  if (changePct < 0.0) return "distribution";
  return "neutral";
};

export const buildHeatmapFramesFromRows = (
  rows: HeatmapRow[] = [],
  availableDates: Array<string | number | null | undefined> = [],
): { animationDates: string[]; framesByDate: Record<string, any> } => {
  const normalizedDates = availableDates.filter((value): value is string | number => value !== null && value !== undefined && value !== "").map((value) => String(value));
  const frameDates = Array.from(new Set(normalizedDates)).sort((a, b) => a.localeCompare(b));
  const grouped = new Map<string, HeatmapRow[]>();

  for (const row of rows) {
    const date = String(row.date || "").slice(0, 10);
    if (!date) continue;
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date)?.push(row);
  }

  const framesByDate: Record<string, any> = {};
  const animationDates = frameDates.filter((date) => grouped.has(date));

  for (const date of animationDates) {
    const dateRows = grouped.get(String(date)) || [];
    const sectorGroups = new Map<string, HeatmapFrameSector>();
    let totalMarketFlow = 0;

    for (const row of dateRows) {
      const close = Number(row.close || 0);
      const volume = Number(row.volume || 0);
      if (!close || !volume) continue;

      const moneyFlow = close * volume;
      const changePct = Number(row.change_pct || 0);
      const sector = normalizeSector(row.sector);
      totalMarketFlow += moneyFlow;

      if (!sectorGroups.has(sector)) {
        sectorGroups.set(sector, {
          sector,
          sector_ar: sector,
          money_flow: 0,
          change_pct: 0,
          market_share: 0,
          stocks_count: 0,
          stocks: [],
          sentiment: "neutral",
        });
      }

      const group = sectorGroups.get(sector);
      if (!group) continue;
      group.money_flow += moneyFlow;
      group.stocks_count += 1;
      group.stocks.push({
        symbol: row.symbol,
        name: row.name || row.symbol,
        close,
        volume,
        change_pct: changePct,
        money_flow: moneyFlow,
      });
    }

    const sectors = Array.from(sectorGroups.values())
      .map((sector) => {
        sector.stocks.sort((a, b) => b.money_flow - a.money_flow);
        const weightedChange = sector.money_flow > 0
          ? sector.stocks.reduce((sum, stock) => sum + stock.change_pct * stock.money_flow, 0) / sector.money_flow
          : 0;
        sector.change_pct = Number(weightedChange.toFixed(2));
        sector.market_share = totalMarketFlow > 0 ? Number(((sector.money_flow / totalMarketFlow) * 100).toFixed(2)) : 0;
        sector.sentiment = getHeatmapSentiment(sector.change_pct, sector.change_pct / 100);
        sector.stocks = sector.stocks.map((stock) => ({
          ...stock,
          weight_in_sector: sector.money_flow > 0 ? (stock.money_flow / sector.money_flow) * 100 : 0,
        }));
        return sector;
      })
      .sort((a, b) => b.money_flow - a.money_flow);

    framesByDate[date] = {
      date,
      sectors,
      total_market_flow: totalMarketFlow,
      updated_at: date,
    };
  }

  return { animationDates, framesByDate };
};

export const getFirstHeatmapFrame = (framesByDate: Record<string, any>, animationDates: string[]) => {
  const firstDate = animationDates[0];
  return firstDate ? framesByDate[firstDate] || null : null;
};
