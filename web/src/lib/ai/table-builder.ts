/**
 * table-builder.ts
 * 
 * Parses the raw text output from executeTools() and builds
 * markdown tables programmatically using EXACT database values.
 * 
 * This eliminates LLM hallucination of prices, RSI, MACD, etc.
 * because the table is built server-side from real data.
 */

// Symbols that are indices, currencies, or non-stock entities
// These should NEVER appear in a stock table
const NON_STOCK_SYMBOLS = new Set([
  "USD", "USDEGP", "USDMXN", "USDEUR", "USDGBP",
  "EGX30", "EGX70", "EGX100", "EGX", "INDEX",
  "TASI", "DFM", "ADX", "QE", "MSM",
]);

export interface ParsedStockData {
  symbol: string;
  name: string;
  price: string;
  change: string;
  volRatio: string;
  rsi: string;
  macd: string;
  signal: string;
}

export interface ParsedMarketData {
  egx30?: { value: string; change: string };
  egx100?: { value: string };
  usdEgp?: { value: string; change?: string };
  regime?: string;
}

export interface ParsedRecommendation {
  symbol: string;
  name: string;
  signal: string;
  entryPrice: string;
  targetPrice: string;
  stopLoss: string;
  date: string;
}

export interface ParsedMissingSymbols {
  symbols: string[];
}

export interface ParsedToolsOutput {
  stocks: ParsedStockData[];
  market: ParsedMarketData | null;
  recommendations: ParsedRecommendation[];
  missingSymbols: string[];
  accumulationStocks: ParsedStockData[];
  distributionStocks: ParsedStockData[];
}

/**
 * Parse a single stock data line from tools.ts output format.
 * Format: • سهم SYMBOL (NAME): السعر اللحظي = X, التغير = X%, RSI = X, MACD = X, نسبة السيولة = Xx, الإشارة = SIGNAL
 */
function parseStockLine(line: string): ParsedStockData | null {
  // Match symbol extraction
  const stockMatch = line.match(/•\s*سهم\s+(\w+)\s*\(([^)]*)\)/);
  if (!stockMatch) return null;

  const symbol = stockMatch[1].toUpperCase();
  const name = stockMatch[2].trim();

  // Extract individual fields with case-insensitive regex
  const priceMatch = line.match(/السعر اللحظي\s*[:=]\s*([0-9.]+(?:\s*ج\.م)?)/i);
  const changeMatch = line.match(/التغير\s*[:=]\s*([+\-]?\s*[0-9.]+\s*%)/i);
  const rsiMatch = line.match(/RSI\s*[:=]\s*([0-9.]+)/i);
  const macdMatch = line.match(/MACD\s*[:=]\s*([+\-]?\s*[0-9.]+)/i);
  const ratioMatch = line.match(/نسبة (?:السيولة|الحجم)\s*[:=]\s*([0-9.]+\s*x?)/i);
  const signalMatch = line.match(/الإشارة\s*[:=]\s*([^,\n]+)/i) || line.match(/(تجميع 📈|تصريف 📉|محايد ⚪|صعود ضعيف ⚠️|هبوط ضعيف ⚠️)/i);

  return {
    symbol,
    name,
    price: priceMatch ? priceMatch[1].trim() : "-",
    change: changeMatch ? changeMatch[1].replace(/\s+/g, "").trim() : "-",
    volRatio: ratioMatch ? ratioMatch[1].replace(/\s+/g, "").trim() : "-",
    rsi: rsiMatch ? rsiMatch[1].trim() : "-",
    macd: macdMatch ? macdMatch[1].trim() : "-",
    signal: signalMatch ? signalMatch[1].trim() : "محايد ⚪",
  };
}

/**
 * Parse an accumulation/distribution stock line (may have slightly different format)
 */
function parseAccumulationLine(line: string): ParsedStockData | null {
  // Format: • 1. سهم BIOC (GlaxoSmithKline S.A.E.): درجة التجميع = 85/100 | نسبة السيولة = 1.50x من المتوسط | التغير = +2.50% | RSI = 55.20 ...
  const stockMatch = line.match(/•\s*\d+\.\s*سهم\s+(\w+)\s*\(([^)]*)\)/);
  if (!stockMatch) return null;

  const symbol = stockMatch[1].toUpperCase();
  const name = stockMatch[2].trim();

  const changeMatch = line.match(/التغير\s*=\s*([+\-]?\s*[0-9.]+\s*%)/i);
  const ratioMatch = line.match(/نسبة السيولة\s*=\s*([0-9.]+\s*x?)/i);
  const rsiMatch = line.match(/RSI\s*=\s*([0-9.]+)/i);
  const macdMatch = line.match(/MACD\s*=\s*([+\-]?\s*[0-9.]+)/i);

  // Determine signal based on keywords in line
  let signal = "محايد ⚪";
  if (line.includes("تجميع 📈")) signal = "تجميع 📈";
  else if (line.includes("تصريف 📉")) signal = "تصريف 📉";

  return {
    symbol,
    name,
    price: "-",
    change: changeMatch ? changeMatch[1].replace(/\s+/g, "").trim() : "-",
    volRatio: ratioMatch ? ratioMatch[1].replace(/\s+/g, "").trim() : "-",
    rsi: rsiMatch ? rsiMatch[1].trim() : "-",
    macd: macdMatch ? macdMatch[1].trim() : "-",
    signal,
  };
}

/**
 * Parse market data from tools.ts output
 */
function parseMarketData(text: string): ParsedMarketData | null {
  const market: ParsedMarketData = {};
  let hasData = false;

  // Parse EGX30
  const egx30Match = text.match(/مؤشر EGX30\s*:\s*([0-9.]+)\s*نقطة\s*\|\s*التغير\s*:\s*([+\-]?\s*[0-9.]+\s*%)/i);
  if (egx30Match && egx30Match[1] && egx30Match[2]) {
    market.egx30 = {
      value: egx30Match[1].trim(),
      change: egx30Match[2].replace(/\s+/g, "").trim(),
    };
    hasData = true;
  }

  // Parse EGX100
  const egx100Match = text.match(/مؤشر EGX100\s*:\s*([0-9.]+)\s*نقطة/i);
  if (egx100Match && egx100Match[1]) {
    market.egx100 = { value: egx100Match[1].trim() };
    hasData = true;
  }

  // Parse USD/EGP
  const usdMatch = text.match(/(?:سعر صرف )?USD\/EGP\s*:\s*([0-9.]+)\s*جنيه/i);
  if (usdMatch && usdMatch[1]) {
    market.usd = { value: usdMatch[1].trim() };
    hasData = true;
  }
  if (usdMatch) {
    market.usdEgp = { value: usdMatch[1].trim() };
    hasData = true;

    // Parse USD change if available
    const usdChangeMatch = text.match(/(?:التغيير الحقيقي|التغير)\s*:\s*([+\-]?\s*[0-9.]+)\s*\(([+\-]?\s*[0-9.]+\s*%)\)/i);
    if (usdChangeMatch) {
      market.usdEgp.change = usdChangeMatch[2].replace(/\s+/g, "").trim();
    }
  }

  // Parse market regime
  const regimeMatch = text.match(/اتجاه السوق \(Market Regime\)\s*:\s*([^\n]+)/i);
  if (regimeMatch) {
    market.regime = regimeMatch[1].trim();
    hasData = true;
  }

  return hasData ? market : null;
}

/**
 * Parse recommendation lines
 */
function parseRecommendation(line: string): ParsedRecommendation | null {
  // Format: • توصية سهم BIOC (NAME): الإشارة = BUY | سعر الدخول = 4.37 ج.م | الهدف = 7.06 ج.م | وقف الخسارة = 3.74 ج.م | تاريخ التوصية = 2026-07-28
  const recMatch = line.match(/توصية سهم\s+(\w+)\s*\(([^)]*)\)/);
  if (!recMatch) return null;

  const signalMatch = line.match(/الإشارة\s*=\s*(\w+)/i);
  const entryMatch = line.match(/سعر الدخول\s*=\s*([^|]+)/i);
  const targetMatch = line.match(/الهدف\s*=\s*([^|]+)/i);
  const stopMatch = line.match(/وقف الخسارة\s*=\s*([^|]+)/i);
  const dateMatch = line.match(/تاريخ التوصية\s*=\s*([^|^\n]+)/i);

  return {
    symbol: recMatch[1].toUpperCase(),
    name: recMatch[2].trim(),
    signal: signalMatch ? signalMatch[1].trim() : "BUY",
    entryPrice: entryMatch ? entryMatch[1].trim() : "N/A",
    targetPrice: targetMatch ? targetMatch[1].trim() : "N/A",
    stopLoss: stopMatch ? stopMatch[1].trim() : "N/A",
    date: dateMatch ? dateMatch[1].trim() : "N/A",
  };
}

/**
 * Parse missing symbols
 */
function parseMissingSymbols(text: string): string[] {
  const missingMatch = text.match(/غير متوفرة بيانات حقيقية لها حالياً:\s*([^\n]+)/i);
  if (!missingMatch) return [];
  return missingMatch[1].split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * Main parser: takes the raw liveDataString from executeTools()
 * and returns structured, typed data.
 */
export function parseToolsOutput(liveDataString: string): ParsedToolsOutput {
  try {
    const result: ParsedToolsOutput = {
      stocks: [],
      market: null,
      recommendations: [],
      missingSymbols: [],
      accumulationStocks: [],
      distributionStocks: [],
    };

    if (!liveDataString || typeof liveDataString !== "string" || liveDataString.trim().length === 0) {
      return result;
    }

    const lines = liveDataString.split("\n");

  let currentSection = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect sections
    if (trimmed.includes("بيانات الأسهم الحية")) {
      currentSection = "stocks";
      continue;
    } else if (trimmed.includes("حالة البورصة والأخبار") || trimmed.includes("المؤشرات المصرية")) {
      currentSection = "market";
      continue;
    } else if (trimmed.includes("إشارات وتوصيات تداول")) {
      currentSection = "recommendations";
      continue;
    } else if (trimmed.includes("أسهم غير موجودة") || trimmed.includes("تنبيه للنموذج")) {
      currentSection = "missing";
      continue;
    } else if (trimmed.includes("أسهم التجميع") || trimmed.includes("أهم الأسهم التي تشهد تجميع")) {
      currentSection = "accumulation";
      continue;
    } else if (trimmed.includes("أسهم التصريف") || trimmed.includes("أهم الأسهم التي تشهد تصريف")) {
      currentSection = "distribution";
      continue;
    } else if (trimmed.includes("المؤشرات والعملات") || trimmed.includes("سعر صرف الدولار")) {
      currentSection = "market";
      continue;
    }

    // Parse based on current section
    if (currentSection === "stocks" && trimmed.startsWith("•")) {
      const stock = parseStockLine(trimmed);
      if (stock) {
        // Avoid duplicates
        if (!result.stocks.find(s => s.symbol === stock.symbol)) {
          result.stocks.push(stock);
        }
      }
    } else if (currentSection === "market" && trimmed.startsWith("•")) {
      const market = parseMarketData(trimmed);
      if (market) {
        result.market = result.market ? mergeMarketData(result.market, market) : market;
      }
    } else if (currentSection === "market") {
      // Also catch USD/EGP data that might be on its own line without bullet
      if (trimmed.includes("USD/EGP") || trimmed.includes("سعر صرف الدولار") || trimmed.includes("EGX30") || trimmed.includes("EGX100")) {
        const market = parseMarketData(trimmed);
        if (market) {
          result.market = result.market ? mergeMarketData(result.market, market) : market;
        }
      }
    } else if (currentSection === "recommendations" && trimmed.startsWith("•")) {
      const rec = parseRecommendation(trimmed);
      if (rec) {
        result.recommendations.push(rec);
      }
    } else if (currentSection === "missing") {
      result.missingSymbols = parseMissingSymbols(trimmed);
    } else if (currentSection === "accumulation" && trimmed.startsWith("•")) {
      const acc = parseAccumulationLine(trimmed);
      if (acc) {
        result.accumulationStocks.push(acc);
      }
    } else if (currentSection === "distribution" && trimmed.startsWith("•")) {
      const dist = parseAccumulationLine(trimmed);
      if (dist) {
        result.distributionStocks.push(dist);
      }
    }
  }

  // Fallback: if section detection failed, try parsing stock lines anywhere
  if (result.stocks.length === 0) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("•") && trimmed.includes("سهم") && !trimmed.includes("توصية") && !trimmed.includes("مؤشر")) {
        const stock = parseStockLine(trimmed);
        if (stock && !result.stocks.find(s => s.symbol === stock.symbol)) {
          result.stocks.push(stock);
        }
      }
    }
  }

  // 🚫 Filter out non-stock symbols (indices, currencies, etc.) from all stock lists
  result.stocks = result.stocks.filter(s => !NON_STOCK_SYMBOLS.has(s.symbol.toUpperCase()));
  result.accumulationStocks = result.accumulationStocks.filter(s => !NON_STOCK_SYMBOLS.has(s.symbol.toUpperCase()));
  result.distributionStocks = result.distributionStocks.filter(s => !NON_STOCK_SYMBOLS.has(s.symbol.toUpperCase()));
  result.missingSymbols = result.missingSymbols.filter(s => !NON_STOCK_SYMBOLS.has(s.toUpperCase()));

	  return result;
    } catch (parseError) {
      console.warn("[table-builder] parseToolsOutput error:", parseError);
      return {
        stocks: [],
        market: null,
        recommendations: [],
        missingSymbols: [],
        accumulationStocks: [],
        distributionStocks: [],
      };
    }
  }

function mergeMarketData(a: ParsedMarketData, b: ParsedMarketData): ParsedMarketData {
  return {
    egx30: b.egx30 || a.egx30,
    egx100: b.egx100 || a.egx100,
    usdEgp: b.usdEgp || a.usdEgp,
    regime: b.regime || a.regime,
  };
}

/**
 * Build the standard stock markdown table from parsed data.
 * Matches the exact format expected by the frontend:
 * | السهم | السعر اللحظي | التغير اليومي | نسبة السيولة | RSI (14) | إشارة MACD | إشارة السيولة |
 */
export function buildStockTable(stocks: ParsedStockData[]): string {
  try {
    if (!stocks || stocks.length === 0) return "";
    if (!Array.isArray(stocks)) return "";

    // 🚫 Final safety filter: remove any non-stock symbols
    const filteredStocks = stocks.filter(s => s && s.symbol && !NON_STOCK_SYMBOLS.has(s.symbol.toUpperCase()));
    if (filteredStocks.length === 0) return "";

    // 🛡️ Remove stocks with clearly hallucinated/suspicious values
    const safeStocks = filteredStocks.filter(s => {
      const priceStr = (s.price || "").replace(/[^0-9.\-]/g, "");
      const price = parseFloat(priceStr);
      const changeStr = (s.change || "").replace(/[^0-9.\-]/g, "");
      const change = parseFloat(changeStr);
      const rsiStr = (s.rsi || "").replace(/[^0-9.\-]/g, "");
      const rsi = parseFloat(rsiStr);
      // Remove if: price > 50000 OR daily change > 30% OR RSI outside 0-100
      if (!isNaN(price) && price > 50000) return false;
      if (!isNaN(change) && Math.abs(change) > 30) return false;
      if (!isNaN(rsi) && (rsi < 0 || rsi > 100)) return false;
      return true;
    });
    if (safeStocks.length === 0) return "";

    const header = "| السهم | السعر اللحظي | التغير اليومي | نسبة السيولة | RSI (14) | إشارة MACD | إشارة السيولة |";
    const separator = "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |";

    const rows = safeStocks.map(s => {
    const price = s.price && s.price !== "-" ? s.price : "-";
    const change = s.change && s.change !== "-" ? s.change : "-";
    const volRatio = s.volRatio && s.volRatio !== "-" ? s.volRatio : "-";
    const rsi = s.rsi && s.rsi !== "-" ? s.rsi : "-";
    const macd = s.macd && s.macd !== "-" ? s.macd : "-";
    const signal = s.signal || "محايد ⚪";
    return `| ${s.symbol} | ${price} | ${change} | ${volRatio} | ${rsi} | ${macd} | ${signal} |`;
  });

    return [header, separator, ...rows].join("\n");
  } catch (tableError) {
    console.warn("[table-builder] buildStockTable error:", tableError);
    return "";
  }
}

/**
 * Build market summary table (EGX30, EGX100, USD/EGP)
 */
export function buildMarketTable(market: ParsedMarketData): string {
  if (!market) return "";

  const lines: string[] = [];
  lines.push("### ملخص السوق");
  lines.push("");

  if (market.egx30) {
    lines.push(`- **مؤشر EGX30**: ${market.egx30.value} نقطة (${market.egx30.change})`);
  }
  if (market.egx100) {
    lines.push(`- **مؤشر EGX100**: ${market.egx100.value} نقطة`);
  }
  if (market.usdEgp) {
    const changeStr = market.usdEgp.change ? ` (${market.usdEgp.change})` : "";
    lines.push(`- **سعر USD/EGP**: ${market.usdEgp.value} جنيه${changeStr}`);
  }
  if (market.regime) {
    lines.push(`- **اتجاه السوق**: ${market.regime}`);
  }

  return lines.join("\n");
}

/**
 * Build recommendations table
 */
export function buildRecommendationTable(recommendations: ParsedRecommendation[]): string {
  if (!recommendations || recommendations.length === 0) return "";

  const header = "| السهم | الإشارة | سعر الدخول | الهدف | وقف الخسارة | التاريخ |";
  const separator = "| :--- | :--- | :--- | :--- | :--- | :--- |";

  const rows = recommendations.map(r =>
    `| ${r.symbol} | ${r.signal} | ${r.entryPrice} | ${r.targetPrice} | ${r.stopLoss} | ${r.date} |`
  );

  return [header, separator, ...rows].join("\n");
}

/**
 * Get the appropriate liquidity signal emoji based on data
 */
export function getLiquiditySignal(stock: ParsedStockData): string {
  // If signal is already clearly defined in the data, use it
  if (stock.signal === "تجميع 📈" || stock.signal === "تصريف 📉") {
    return stock.signal;
  }

  // Otherwise compute from the volume ratio and change
  const volRatio = parseFloat(stock.volRatio);
  const changeStr = stock.change.replace("%", "").trim();
  const change = parseFloat(changeStr);

  if (!isNaN(volRatio) && !isNaN(change)) {
    if (volRatio >= 1.2 && change > 0) return "تجميع 📈";
    if (volRatio >= 1.2 && change < 0) return "تصريف 📉";
    if (volRatio < 0.6 && change > 0) return "صعود ضعيف ⚠️";
    if (volRatio < 0.6 && change < 0) return "هبوط ضعيف ⚠️";
  }
  return "محايد ⚪";
}

/**
 * Validate if a numerical value looks reasonable.
 * Returns true if the value is "suspicious" (likely hallucinated).
 */
export function isSuspiciousValue(value: string, type: "price" | "rsi" | "change" | "volRatio" | "macd"): boolean {
  try {
    if (!value || value === "-" || value === "N/A") return false;

    const num = parseFloat(value.replace(/[^0-9.\-]/g, ""));
    if (isNaN(num)) return false;

    switch (type) {
      case "price":
        return num <= 0 || num > 50000;
      case "rsi":
        return num < 0 || num > 100;
      case "change":
        return Math.abs(num) > 30;
      case "volRatio":
        return num > 50;
      case "macd":
        return Math.abs(num) > 100;
      default:
        return false;
    }
  } catch {
    return false;
  }
}
