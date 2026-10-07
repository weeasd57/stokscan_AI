import { calculatePortfolio } from "./portfolio-calc";
import { validatedObservationDate } from "./facts";
import { ToolResult } from "./types";

type Column =
  | "symbol"
  | "quantity"
  | "entry"
  | "price"
  | "return"
  | "weight"
  | "rsi"
  | "volume"
  | "scores";

const normalize = (value: string) =>
  value
    .replace(/[*_`]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/٫/g, ".")
    .trim()
    .toLowerCase();

const finite = (value: unknown, allowVolumeSuffix = false): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let text = value
    .trim()
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/٫/g, ".");
  if (!text || /[%٪×✕]/.test(text)) return null;
  if (/[xX]$/.test(text)) {
    if (!allowVolumeSuffix) return null;
    text = text.slice(0, -1).trim();
  }
  if (text.includes(",")) {
    if (!/^[-+]?(?:\d{1,3})(?:,\d{3})+(?:\.\d+)?$/.test(text)) return null;
    text = text.replace(/,/g, "");
  }
  if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

const finitePositive = (value: unknown): number | null => {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

function splitRow(line: string): string[] | null {
  if (!line.trim().startsWith("|")) return null;
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function identifyColumn(header: string): Column | null {
  const h = normalize(header);
  if (/^(?:السهم|الرمز|symbol)$/.test(h)) return "symbol";
  if (/كميه|quantity/.test(h)) return "quantity";
  if (/سعر الشراء|متوسط الشراء|متوسط الدخول|entry/.test(h)) return "entry";
  if (/السعر المتاح|سعر السوق|اخر سعر|السعر|price/.test(h)) return "price";
  if (/العائد|الربح|الخساره|غير المحقق|return|pnl/.test(h)) return "return";
  if (/وزن/.test(h)) return "weight";
  if (/\brsi\b/.test(h)) return "rsi";
  if (/حجم نسبي|vol(?:ume)? ratio/.test(h)) return "volume";
  if (/درجات king\/egx|king\/egx|king ai|egx ai/.test(h)) return "scores";
  return null;
}

function numericClaims(value: string): number[] {
  const text = normalize(value).replace(/\b20\d{2}[-/]\d{2}[-/]\d{2}\b/g, " ");
  return Array.from(text.matchAll(/[+-]?\d[\d,]*(?:\.\d+)?/g))
    .map((match) => Number(match[0].replace(/,/g, "")))
    .filter(Number.isFinite);
}

function labeledNumbers(value: string, suffix: RegExp): number[] {
  const text = normalize(value).replace(/\b20\d{2}[-/]\d{2}[-/]\d{2}\b/g, " ");
  const pattern = new RegExp(
    `[+-]?\\d[\\d,]*(?:\\.\\d+)?\\s*${suffix.source}`,
    suffix.flags.replace("g", ""),
  );
  return Array.from(
    text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`)),
  )
    .map((match) =>
      Number(match[0].replace(suffix, "").replace(/,/g, "").trim()),
    )
    .filter(Number.isFinite);
}

function isMissing(value: string): boolean {
  const text = normalize(value);
  return (
    text === "" ||
    /غير متاح|غير محسوب|غير مسجل|غير موثق|لا يتوفر|لا تتوفر|^[-—–]+$|\bn\/a\b/.test(
      text,
    )
  );
}

function closeEnough(
  actual: number,
  expected: number,
  tolerance = 0.06,
): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function symbolFromCell(cell: string): string | null {
  const match = normalize(cell).match(/\b[A-Z][A-Z0-9]{1,9}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function headerColumns(cells: string[]): Map<Column, number> | null {
  const columns = new Map<Column, number>();
  cells.forEach((cell, index) => {
    const column = identifyColumn(cell);
    if (column && !columns.has(column)) columns.set(column, index);
  });
  const portfolioColumns = [
    "quantity",
    "entry",
    "price",
    "return",
    "weight",
  ].filter((column) => columns.has(column as Column)).length;
  return columns.has("symbol") && portfolioColumns >= 2 ? columns : null;
}

interface PriceEvidence {
  value: number;
  date: string | null;
}

function quoteEvidence(
  results: ToolResult[],
  symbol: string,
  position: any,
): PriceEvidence[] {
  const quotes: PriceEvidence[] = [];
  // The renderer keeps the last get_stock result for a symbol in a Map. Mirror
  // that ordering and do not introduce ambiguity by also counting its cached
  // position price when an explicit quote was fetched.
  let selectedResult: ToolResult | null = null;
  for (const result of results) {
    if (result.error || result.tool !== "get_stock") continue;
    const row = result.data?.symbol ? result.data : null;
    if (!row || String(row.symbol).toUpperCase() !== symbol) continue;
    selectedResult = result;
  }
  const selectedRow = selectedResult?.data;
  const selectedValue = finitePositive(
    selectedRow?.price ?? selectedRow?.close,
  );
  const selectedDate =
    selectedRow?.quote_basis?.as_of || selectedResult?.data_time || null;
  const selectedQuote =
    selectedValue === null
      ? null
      : { value: selectedValue, date: cairoObservationDay(selectedDate) };
  if (selectedQuote) quotes.push(selectedQuote);
  else {
    const saved = finitePositive(position?.last_price);
    if (saved !== null) {
      const dateValue =
        position.price_updated_at || position.last_price_as_of || null;
      const date = cairoObservationDay(dateValue);
      quotes.push({ value: saved, date });
    }
  }
  return quotes;
}

function cairoObservationDay(value: unknown): string | null {
  const valid = validatedObservationDate(value);
  if (!valid) return null;
  if (!valid.includes("T")) return valid;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(valid));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function latestStockRow(results: ToolResult[], symbol: string): any | null {
  let row: any | null = null;
  for (const result of results) {
    if (result.error || result.tool !== "get_stock" || !result.data?.symbol)
      continue;
    if (String(result.data.symbol).toUpperCase() === symbol) row = result.data;
  }
  return row;
}

/**
 * Verifies the bounded Markdown schema emitted for personal portfolio analysis.
 * Prose attribution intentionally skips Markdown rows, so portfolio row values
 * are bound here to the saved positions, dated stock quotes and programmatic
 * portfolio formulas.
 */
export function checkPortfolioTableEvidence(
  reply: string,
  results: ToolResult[],
): string[] {
  const violations: string[] = [];
  const lines = reply.split("\n");
  const positionsResult = results.find(
    (result) =>
      result.tool === "manage_portfolio" &&
      !result.error &&
      result.data?.ok === true &&
      Array.isArray(result.data?.positions),
  );
  const positions: any[] = positionsResult?.data?.positions || [];
  const positionsBySymbol = new Map(
    positions.map((position) => [
      String(position.symbol || "").toUpperCase(),
      position,
    ]),
  );
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index++) {
    const cells = splitRow(lines[index]);
    if (!cells) continue;
    const columns = headerColumns(cells);
    if (!columns) continue;

    const rows: Array<{
      symbol: string;
      cells: string[];
      position: any;
      quotes: PriceEvidence[];
    }> = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const row = splitRow(lines[cursor]);
      if (!row) break;
      if (row.every((cell) => /^:?-+:?$/.test(cell))) {
        cursor++;
        continue;
      }
      if (headerColumns(row)) break;
      const symbolCell = row[columns.get("symbol") ?? -1] || "";
      const symbol = symbolFromCell(symbolCell);
      if (!symbol) {
        violations.push("جدول المحفظة يحتوي صفاً بلا رمز سهم قابل للتحقق.");
        cursor++;
        continue;
      }
      if (row.length !== cells.length) {
        violations.push(
          `${symbol}: صف جدول المحفظة لا يحتوي جميع الأعمدة المحددة في الرأس.`,
        );
      }
      if (seen.has(symbol))
        violations.push(`${symbol}: السهم مكرر في جدول المحفظة.`);
      seen.add(symbol);
      const position = positionsBySymbol.get(symbol);
      if (!position) {
        violations.push(
          `${symbol}: لا يوجد مركز محفوظ يثبت ظهوره في جدول المحفظة.`,
        );
        cursor++;
        continue;
      }
      rows.push({
        symbol,
        cells: row,
        position,
        quotes: quoteEvidence(results, symbol, position),
      });
      cursor++;
    }

    if (!positionsResult) {
      violations.push("جدول المحفظة لا يستند إلى لقطة مراكز محفوظة وناجحة.");
      index = cursor - 1;
      continue;
    }

    const candidateSets = rows.map((row) => ({
      row,
      prices: row.quotes
        .map((quote) => ({
          quantity: finitePositive(row.position.quantity),
          last_price: quote.value,
          date: quote.date,
        }))
        .filter((item) => item.quantity !== null),
    }));

    for (const { symbol, cells: row, position, quotes } of rows) {
      const checkField = (
        field: Column,
        expected: number | null,
        label: string,
        tolerance = 0.06,
      ) => {
        const columnIndex = columns.get(field);
        if (columnIndex === undefined || columnIndex >= row.length) return;
        const cell = row[columnIndex];
        const values = numericClaims(cell);
        if (values.length === 0 && isMissing(cell)) {
          if (expected !== null)
            violations.push(
              `${symbol}: ${label} متاح في الأدلة لكن الجدول أخفاه.`,
            );
          return;
        }
        if (expected === null) {
          if (values.length > 0)
            violations.push(
              `${symbol}: ${label} رقمي بلا مدخلات موثقة تكفي للتحقق.`,
            );
          return;
        }
        if (
          values.length === 0 ||
          values.some((value) => !closeEnough(value, expected, tolerance))
        )
          violations.push(
            `${symbol}: ${label} في جدول المحفظة لا يطابق الأدلة أو الحساب البرمجي.`,
          );
      };

      checkField(
        "quantity",
        finitePositive(position.quantity),
        "الكمية",
        0.0005,
      );
      checkField(
        "entry",
        finitePositive(position.entry_price),
        "سعر الشراء",
        0.011,
      );

      const priceIndex = columns.get("price");
      if (priceIndex !== undefined && priceIndex < row.length) {
        const values = numericClaims(row[priceIndex]);
        if (values.length === 0 && isMissing(row[priceIndex])) {
          if (quotes.length > 0)
            violations.push(`${symbol}: سعر موثق متاح لكن الجدول أخفاه.`);
        } else if (values.length === 0) {
          violations.push(
            `${symbol}: السعر في جدول المحفظة غير قابل للقراءة والتحقق.`,
          );
        } else if (
          values.length > 0 &&
          (quotes.length === 0 ||
            values.some(
              (value) =>
                !quotes.some((quote) => closeEnough(value, quote.value, 0.011)),
            ))
        ) {
          violations.push(
            `${symbol}: السعر في جدول المحفظة لا يطابق سعراً موثقاً للسهم.`,
          );
        }
      }

      const qty = finitePositive(position.quantity);
      const entry = finitePositive(position.entry_price);
      const stock = latestStockRow(results, symbol) || {};
      const returnIndex = columns.get("return");
      if (returnIndex !== undefined && returnIndex < row.length) {
        const cell = row[returnIndex];
        const pctClaims = labeledNumbers(cell, /[%٪]/);
        const moneyClaims = labeledNumbers(cell, /(?:ج\.?م|جنيه(?:ًا)?|egp)/i);
        if (
          pctClaims.length === 0 &&
          moneyClaims.length === 0 &&
          isMissing(cell)
        ) {
          // The renderer correctly withholds return when price/date/entry evidence is incomplete.
          if (
            qty !== null &&
            entry !== null &&
            quotes.some((quote) => quote.date !== null)
          )
            violations.push(
              `${symbol}: العائد قابل للحساب من بيانات مؤرخة لكن الجدول أخفاه.`,
            );
        } else if (pctClaims.length > 0 || moneyClaims.length > 0) {
          const calculations =
            qty !== null && entry !== null
              ? quotes
                  .filter((quote) => quote.date !== null)
                  .map(
                    (quote) =>
                      calculatePortfolio([
                        {
                          symbol,
                          quantity: qty,
                          entry_price: entry,
                          last_price: quote.value,
                        },
                      ]).positions[0],
                  )
              : [];
          const pctSupported = pctClaims.every((claim) =>
            calculations.some(
              (math) =>
                math?.profit_pct !== null &&
                math?.profit_pct !== undefined &&
                closeEnough(claim, math.profit_pct, 0.11),
            ),
          );
          const moneySupported = moneyClaims.every((claim) =>
            calculations.some(
              (math) =>
                math?.profit_value !== null &&
                math?.profit_value !== undefined &&
                closeEnough(claim, math.profit_value),
            ),
          );
          if (
            (!pctSupported && pctClaims.length > 0) ||
            (!moneySupported && moneyClaims.length > 0) ||
            numericClaims(cell).length !== pctClaims.length + moneyClaims.length
          ) {
            violations.push(
              `${symbol}: العائد في جدول المحفظة لا يطابق كمية وسعر شراء وسعراً مؤرخاً.`,
            );
          }
        } else if (numericClaims(cell).length > 0) {
          violations.push(
            `${symbol}: العائد في الجدول رقم بلا علامة نسبة أو وحدة مالية قابلة للتحقق.`,
          );
        }
      }

      const rsiIndex = columns.get("rsi");
      if (rsiIndex !== undefined && rsiIndex < row.length) {
        const cell = row[rsiIndex];
        const values = numericClaims(cell);
        const rawRsi = finite(stock.rsi_14 ?? stock.rsi);
        const expected =
          rawRsi !== null && rawRsi >= 0 && rawRsi <= 100 ? rawRsi : null;
        if (values.length === 0 && isMissing(cell)) {
          if (expected !== null)
            violations.push(`${symbol}: RSI متاح في الأدلة لكن الجدول أخفاه.`);
        } else if (
          values.length > 0 &&
          (expected === null ||
            !closeEnough(values[values.length - 1], expected, 0.15))
        ) {
          violations.push(
            `${symbol}: قيمة RSI في جدول المحفظة لا تطابق بيانات السهم.`,
          );
        } else if (expected !== null) {
          const label = normalize(cell);
          if (
            (/تشبع بيعي|oversold/.test(label) && expected > 30) ||
            (/تشبع شرائي|overbought/.test(label) && expected < 70) ||
            (/محايد/.test(label) && (expected <= 30 || expected >= 70))
          ) {
            violations.push(
              `${symbol}: وصف نطاق RSI لا يطابق قيمة المؤشر وحدوده.`,
            );
          }
        }
      }

      const volumeIndex = columns.get("volume");
      if (volumeIndex !== undefined && volumeIndex < row.length) {
        const cell = row[volumeIndex];
        const values = numericClaims(cell);
        const rawVolume = finite(stock.vol_ratio ?? stock.volume_ratio, true);
        const expected =
          rawVolume !== null && rawVolume >= 0 ? rawVolume : null;
        if (values.length === 0 && isMissing(cell)) {
          if (expected !== null)
            violations.push(
              `${symbol}: نسبة الحجم متاحة في الأدلة لكن الجدول أخفاها.`,
            );
        } else if (
          values.length > 0 &&
          (expected === null ||
            values.some((value) => !closeEnough(value, expected, 0.015)))
        ) {
          violations.push(
            `${symbol}: نسبة الحجم في جدول المحفظة لا تطابق بيانات السهم.`,
          );
        }
      }

      const scoresIndex = columns.get("scores");
      if (scoresIndex !== undefined && scoresIndex < row.length) {
        const cell = row[scoresIndex];
        const pieces = cell.split("/").map((part) => numericClaims(part));
        const actual = [
          stock.king_ai_score ?? stock.king_score,
          stock.egx_ai_score ?? stock.egx_score,
        ]
          .map((value) => finite(value))
          .map((value) =>
            value !== null && value >= 0 && value <= 1 ? value : null,
          );
        for (
          let scoreIndex = 0;
          scoreIndex < Math.min(actual.length, pieces.length);
          scoreIndex++
        ) {
          const values = pieces[scoreIndex];
          if (
            values.length === 0 &&
            isMissing(cell.split("/")[scoreIndex] || "")
          ) {
            if (actual[scoreIndex] !== null)
              violations.push(
                `${symbol}: درجة النموذج متاحة في الأدلة لكن الجدول أخفاها.`,
              );
          } else if (
            values.length > 0 &&
            (actual[scoreIndex] === null ||
              values.some(
                (value) => !closeEnough(value, actual[scoreIndex]! * 100, 0.6),
              ))
          ) {
            violations.push(
              `${symbol}: درجة KING/EGX في جدول المحفظة لا تطابق قيمة النموذج المسجلة.`,
            );
          }
        }
      }
    }

    const weightIndex = columns.get("weight");
    if (weightIndex !== undefined) {
      const portfolioCandidates = candidateSets;
      const dates = new Set(
        portfolioCandidates.map(({ prices }) =>
          prices.length === 1 ? prices[0].date : null,
        ),
      );
      const completeSameDate =
        portfolioCandidates.length === positions.length &&
        portfolioCandidates.length > 0 &&
        portfolioCandidates.every(
          ({ prices }) => prices.length === 1 && prices[0].date,
        ) &&
        dates.size === 1;
      let expectedWeights = new Map<string, number>();
      if (completeSameDate) {
        const values = portfolioCandidates.map(({ row, prices }) => ({
          symbol: row.symbol,
          market_value: prices[0].quantity! * prices[0].last_price,
        }));
        const totalMarketValue = values.reduce(
          (sum, item) => sum + item.market_value,
          0,
        );
        if (totalMarketValue > 0)
          expectedWeights = new Map(
            values.map((item) => [
              item.symbol,
              (item.market_value / totalMarketValue) * 100,
            ]),
          );
      }
      for (const { symbol, cells: row } of rows) {
        const cell = row[weightIndex] || "";
        const values = numericClaims(cell);
        const expected = expectedWeights.get(symbol);
        if (values.length === 0 && isMissing(cell)) {
          if (completeSameDate && expected !== undefined)
            violations.push(
              `${symbol}: وزن المحفظة قابل للحساب لكن الجدول أخفاه.`,
            );
          continue;
        }
        if (
          !completeSameDate ||
          expected === undefined ||
          values.length === 0 ||
          values.some((value) => !closeEnough(value, expected, 0.06))
        )
          violations.push(
            `${symbol}: وزن المحفظة لا يمكن إثباته من أسعار جميع المراكز في التاريخ نفسه، أو لا يطابق الحساب.`,
          );
      }
    }

    if (positions.length > 0 && positions.length <= 12) {
      const missing = positions
        .map((position) => String(position.symbol || "").toUpperCase())
        .filter((symbol) => symbol && !seen.has(symbol));
      if (missing.length)
        violations.push(
          `جدول تحليل المحفظة أغفل المراكز: ${missing.join("، ")}.`,
        );
    }
    index = cursor - 1;
  }

  return [...new Set(violations)];
}
