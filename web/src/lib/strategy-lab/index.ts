/** Deterministic, causal chart research. These approximations are not investment advice. */
export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
export type StrategyId =
  | "wyckoff"
  | "smc"
  | "harmonic"
  | "gann"
  | "time_cycles"
  | "elliott"
  | "volume_profile"
  | "price_action"
  | "trend_macd"
  | "fibonacci_time";
export type StrategyParams = {
  lookback?: number;
  fastPeriod?: number;
  slowPeriod?: number;
};
export type Overlay = {
  id: string;
  group?: string;
  label: string;
  kind: "line" | "zone" | "time";
  points: { time: number; value: number }[];
  color?: string;
};
export type Signal = {
  time: number;
  index: number;
  side: "buy" | "sell";
  reason: string;
};
export type StrategyAnalysis = {
  strategyId: StrategyId;
  overlays: Overlay[];
  signals: Signal[];
  warnings: string[];
};
export const STRATEGIES: {
  id: StrategyId;
  name: string;
  description: string;
  backtestable: boolean;
  experimental: boolean;
}[] = [
  {
    id: "wyckoff",
    name: "وايكوف",
    description:
      "تقريب: اختراق نطاق سابق بحجم مرتفع؛ لا يشخص مراحل وايكوف الكاملة.",
    backtestable: true,
    experimental: false,
  },
  {
    id: "smc",
    name: "SMC",
    description:
      "تقريب لسحب السيولة: كسر أدنى النطاق ثم إغلاق صاعد داخله للدخول؛ سحب القمم بإغلاق هابط أو فقد القاع للخروج. لا يكشف أوامر المؤسسات.",
    backtestable: true,
    experimental: false,
  },
  {
    id: "harmonic",
    name: "النماذج التوافقية",
    description:
      "مرشح Gartley من انعكاسات مؤكدة ونسب XA/AB/BC/CD ضمن سماحية 8%؛ يحتاج مراجعة ولا يولد صفقات تلقائية.",
    backtestable: false,
    experimental: false,
  },
  {
    id: "gann",
    name: "زوايا جان",
    description:
      "خط سعري زمني بمقياس متوسط مدى الشمعة، وليس زاوية هندسية ثابتة على الشاشة.",
    backtestable: false,
    experimental: true,
  },
  {
    id: "time_cycles",
    name: "الدورات الزمنية",
    description:
      "نوافذ دورية تجريبية بعدد الشموع؛ لا تستخدم بيانات فلكية ولا تعطي احتمال نجاح.",
    backtestable: false,
    experimental: true,
  },
  {
    id: "elliott",
    name: "موجات إليوت",
    description:
      "مرشح خمس موجات من انعكاسات مؤكدة بشرط عدم ارتداد الموجة 2 بالكامل وعدم تداخل 4 مع 1 وأن 3 ليست الأقصر؛ يحتاج مراجعة.",
    backtestable: false,
    experimental: false,
  },
  {
    id: "volume_profile",
    name: "Volume Profile",
    description:
      "تقريب توزيع الحجم بوضع حجم الشمعة عند سعرها النموذجي؛ لا يمثل حجم التداول الحقيقي لكل سعر.",
    backtestable: false,
    experimental: false,
  },
  {
    id: "price_action",
    name: "البرايس أكشن",
    description: "إغلاق فوق أعلى نطاق سابق للدخول، وتحت أدناه للخروج.",
    backtestable: true,
    experimental: false,
  },
  {
    id: "trend_macd",
    name: "الاتجاه وMACD",
    description:
      "تقاطعات MACD مع خط الإشارة EMA9، باستخدام EMA12 وEMA26 افتراضيًا.",
    backtestable: true,
    experimental: false,
  },
  {
    id: "fibonacci_time",
    name: "فيبوناتشي الزمني",
    description:
      "نوافذ 1، 2، 3، 5، 8… شموع من أول شمعة في الفترة المختارة، دون توقع اتجاه.",
    backtestable: false,
    experimental: true,
  },
];
export const STRATEGY_CATALOG = STRATEGIES;
export const STRATEGY_COLORS: Record<StrategyId, string> = {
  wyckoff: "#10b981",
  smc: "#3b82f6",
  harmonic: "#f59e0b",
  gann: "#a78bfa",
  time_cycles: "#ec4899",
  elliott: "#22d3ee",
  volume_profile: "#fb923c",
  price_action: "#84cc16",
  trend_macd: "#f472b6",
  fibonacci_time: "#eab308",
};
function period(value: number | undefined, fallback: number) {
  return Math.min(
    200,
    Math.max(2, Math.round(Number.isFinite(value) ? value! : fallback)),
  );
}
export function normalizeCandles(input: Candle[]): Candle[] {
  const seen = new Set<number>();
  return input
    .filter(
      (c) =>
        Number.isFinite(c.time) &&
        [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) &&
        c.low > 0 &&
        c.high >= Math.max(c.open, c.close, c.low) &&
        c.low <= Math.min(c.open, c.close) &&
        c.volume >= 0,
    )
    .sort((a, b) => a.time - b.time)
    .filter((c) => {
      if (seen.has(c.time)) return false;
      seen.add(c.time);
      return true;
    });
}
function ema(values: number[], length: number) {
  let v = values[0] ?? 0;
  return values.map((x) => (v += ((x - v) * 2) / (length + 1)));
}
export function analyzeStrategy(
  input: Candle[],
  strategyId: StrategyId,
  params: StrategyParams = {},
): StrategyAnalysis {
  const catalog = STRATEGIES.find((s) => s.id === strategyId);
  if (!catalog) throw new Error("Unknown strategy");
  const candles = normalizeCandles(input),
    lookback = period(params.lookback, 20);
  const result: StrategyAnalysis = {
    strategyId,
    overlays: [],
    signals: [],
    warnings: [],
  };
  if (candles.length !== input.length)
    result.warnings.push("تم استبعاد شموع غير صالحة أو مكررة.");
  if (candles.length < lookback + 2)
    result.warnings.push("تاريخ قصير؛ النتائج قد لا تحتوي إشارات كافية.");
  if (!catalog.backtestable)
    result.warnings.push(
      "رسم تحليلي فقط: لا توجد قواعد صفقات معتمدة للمقارنة.",
    );
  if (catalog.experimental)
    result.warnings.push("تحليل تجريبي بلا احتمالات معايرة.");
  const line = (
    id: string,
    label: string,
    points: Overlay["points"],
    kind: Overlay["kind"] = "line",
  ) =>
    result.overlays.push({
      id: `${strategyId}:${id}`,
      label,
      points,
      kind,
      color: STRATEGY_COLORS[strategyId],
    });
  const signal = (i: number, side: Signal["side"], reason: string) =>
    result.signals.push({ index: i, time: candles[i].time, side, reason });
  if (!candles.length) return result;
  if (["price_action", "smc", "wyckoff"].includes(strategyId)) {
    const upper: Overlay["points"] = [],
      lower: Overlay["points"] = [];
    for (let i = lookback; i < candles.length; i++) {
      const previous = candles.slice(i - lookback, i),
        hi = Math.max(...previous.map((c) => c.high)),
        lo = Math.min(...previous.map((c) => c.low));
      upper.push({ time: candles[i].time, value: hi });
      lower.push({ time: candles[i].time, value: lo });
      if (strategyId === "smc") {
        const current = candles[i];
        if (
          current.low < lo &&
          current.close > lo &&
          current.close > current.open
        )
          signal(
            i,
            "buy",
            "سحب سيولة أسفل القاع السابق وإغلاق صاعد داخل النطاق",
          );
        if (
          (current.high > hi &&
            current.close < hi &&
            current.close < current.open) ||
          current.close < lo
        )
          signal(i, "sell", "سحب سيولة القمة بإغلاق هابط أو فقد قاع الهيكل");
        continue;
      }
      const volumeConfirmed =
        strategyId !== "wyckoff" ||
        candles[i].volume >
          (previous.reduce((s, c) => s + c.volume, 0) / lookback) * 1.5;
      if (candles[i].close > hi && volumeConfirmed)
        signal(
          i,
          "buy",
          "إغلاق فوق أعلى النطاق السابق" +
            (strategyId === "wyckoff" ? " وحجم أكبر من 1.5× المتوسط" : ""),
        );
      if (candles[i].close < lo)
        signal(i, "sell", "إغلاق تحت أدنى النطاق السابق");
    }
    line("range-high", "مقاومة النطاق السابق", upper);
    line("range-low", "دعم النطاق السابق", lower);
  } else if (strategyId === "trend_macd") {
    const close = candles.map((c) => c.close),
      fast = ema(close, period(params.fastPeriod, 12)),
      slow = ema(close, period(params.slowPeriod, 26)),
      macd = fast.map((v, i) => v - slow[i]),
      trigger = ema(macd, 9);
    line(
      "fast",
      "EMA السريع",
      fast.map((value, i) => ({ time: candles[i].time, value })),
    );
    line(
      "slow",
      "EMA البطيء",
      slow.map((value, i) => ({ time: candles[i].time, value })),
    );
    for (
      let i = Math.max(lookback, period(params.slowPeriod, 26));
      i < candles.length;
      i++
    ) {
      if (macd[i] > trigger[i] && macd[i - 1] <= trigger[i - 1])
        signal(i, "buy", "تقاطع MACD أعلى خط الإشارة");
      if (macd[i] < trigger[i] && macd[i - 1] >= trigger[i - 1])
        signal(i, "sell", "تقاطع MACD أسفل خط الإشارة");
    }
  } else if (strategyId === "harmonic" || strategyId === "elliott") {
    const pivots: Overlay["points"] = [];
    // Pivot at i-2 is only drawn at confirmation time i, never traded retrospectively.
    for (let i = 4; i < candles.length; i++) {
      const p = candles[i - 2],
        window = candles.slice(i - 4, i + 1);
      if (p.high === Math.max(...window.map((c) => c.high)))
        pivots.push({ time: candles[i].time, value: p.high });
      else if (p.low === Math.min(...window.map((c) => c.low)))
        pivots.push({ time: candles[i].time, value: p.low });
    }
    line("confirmed-pivots", "انعكاسات عند وقت التأكيد (تأخير شمعتين)", pivots);
    if (strategyId === "harmonic") {
      for (let i = 2; i < pivots.length; i++) {
        const previousLeg = Math.abs(pivots[i - 1].value - pivots[i - 2].value);
        if (previousLeg > 0) {
          const ratio =
            Math.abs(pivots[i].value - pivots[i - 1].value) / previousLeg;
          line("leg-ratio-" + i, "نسبة الضلع السابق: " + ratio.toFixed(3), [
            pivots[i - 1],
            pivots[i],
          ]);
        }
      }
      for (let i = 4; i < pivots.length; i++) {
        const points = pivots.slice(i - 4, i + 1);
        const values = points.map((p) => p.value);
        const legs = values.slice(1).map((v, j) => v - values[j]);
        if (
          !legs.every(
            (leg, j) => leg !== 0 && (j === 0 || leg * legs[j - 1] < 0),
          )
        )
          continue;
        const xa = Math.abs(legs[0]),
          ab = Math.abs(legs[1]),
          bc = Math.abs(legs[2]),
          cd = Math.abs(legs[3]);
        const abXa = ab / xa,
          bcAb = bc / ab,
          cdBc = cd / bc,
          adXa = Math.abs(values[4] - values[1]) / xa;
        if (
          Math.abs(abXa - 0.618) <= 0.08 &&
          bcAb >= 0.382 - 0.08 &&
          bcAb <= 0.886 + 0.08 &&
          cdBc >= 1.272 - 0.08 &&
          cdBc <= 1.618 + 0.08 &&
          Math.abs(adXa - 0.786) <= 0.08
        )
          line(
            "gartley-" + i,
            "مرشح Gartley " + (legs[0] > 0 ? "صاعد" : "هابط") + " عند التأكيد",
            points,
          );
      }
    } else {
      for (let i = 5; i < pivots.length; i++) {
        const points = pivots.slice(i - 5, i + 1),
          values = points.map((p) => p.value);
        const direction = Math.sign(values[1] - values[0]),
          v = values.map((p) => p * direction);
        const legs = v.slice(1).map((p, j) => p - v[j]);
        if (
          direction &&
          legs[0] > 0 &&
          legs[1] < 0 &&
          legs[2] > 0 &&
          legs[3] < 0 &&
          legs[4] > 0 &&
          v[2] > v[0] &&
          v[3] > v[1] &&
          v[4] > v[1] &&
          v[5] > v[3] &&
          legs[2] >= Math.min(legs[0], legs[4])
        ) {
          line(
            "elliott-candidate-" + i,
            "مرشح خمس موجات " + (direction > 0 ? "صاعد" : "هابط"),
            points,
          );
          points
            .slice(1)
            .forEach((p, j) =>
              line("wave-" + i + "-" + j, "موجة " + (j + 1) + " عند التأكيد", [
                p,
              ]),
            );
        }
      }
    }
    result.warnings.push(catalog.description);
  } else if (strategyId === "gann") {
    const start = candles[0],
      scale = start.high - start.low || start.close * 0.01;
    line(
      "gann-scale",
      "خط سعر/زمن: مدى أول شمعة لكل شمعة",
      candles.map((c, i) => ({ time: c.time, value: start.close + i * scale })),
    );
  } else if (strategyId === "time_cycles" || strategyId === "fibonacci_time") {
    const indices =
      strategyId === "time_cycles"
        ? candles.map((_, i) => i).filter((i) => i > 0 && i % lookback === 0)
        : [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987];
    for (const i of indices)
      if (i < candles.length)
        line(
          "time-" + i,
          "نافذة زمنية " + i,
          [
            { time: candles[i].time, value: candles[i].low },
            { time: candles[i].time, value: candles[i].high },
          ],
          "time",
        );
  } else if (strategyId === "volume_profile") {
    const sample = candles.slice(-lookback),
      low = Math.min(...sample.map((c) => c.low)),
      high = Math.max(...sample.map((c) => c.high)),
      step = (high - low) / 12 || low * 0.001,
      bins = Array<number>(12).fill(0);
    for (const c of sample)
      bins[
        Math.min(
          11,
          Math.max(
            0,
            Math.floor(((c.high + c.low + c.close) / 3 - low) / step),
          ),
        )
      ] += c.volume;
    const poc = low + (bins.indexOf(Math.max(...bins)) + 0.5) * step;
    line("poc", "POC تقديري للفترة الأخيرة", [
      { time: sample[0].time, value: poc },
      { time: sample[sample.length - 1].time, value: poc },
    ]);
    result.warnings.push(catalog.description);
  }
  return result;
}
export type CompareOptions = {
  initialCapital?: number;
  commissionBps?: number;
  slippageBps?: number;
  params?: StrategyParams;
};
export type Trade = {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  returnPct: number;
  reason: string;
};
export type EquityPoint = { time: number; value: number };
export type BacktestResult = {
  strategyId: StrategyId;
  analysis: StrategyAnalysis;
  metrics: {
    totalReturnPct: number;
    maxDrawdownPct: number;
    winRatePct: number;
    profitFactor: number | null;
    closedTrades: number;
    finalEquity: number;
  };
  trades: Trade[];
  equity: EquityPoint[];
  warnings: string[];
};
export function compareStrategies(
  input: Candle[],
  ids: StrategyId[],
  options: CompareOptions = {},
) {
  const candles = normalizeCandles(input),
    capital = options.initialCapital ?? 100000,
    commission = (options.commissionBps ?? 10) / 10000,
    slip = (options.slippageBps ?? 10) / 10000;
  if (
    !Number.isFinite(capital) ||
    capital <= 0 ||
    !Number.isFinite(commission) ||
    commission < 0 ||
    commission > 0.1 ||
    !Number.isFinite(slip) ||
    slip < 0 ||
    slip > 0.1
  )
    throw new Error("Invalid backtest costs or capital");
  if (ids.some((id) => !STRATEGIES.some((strategy) => strategy.id === id)))
    throw new Error("Unknown strategy");
  const requested = [...new Set(ids)].slice(0, 10);
  const excludedStrategyIds = requested.filter(
    (id) => !STRATEGIES.find((strategy) => strategy.id === id)?.backtestable,
  );
  const results: BacktestResult[] = requested
    .filter((id) => !excludedStrategyIds.includes(id))
    .map((strategyId) => {
      const analysis = analyzeStrategy(candles, strategyId, options.params),
        trades: Trade[] = [],
        equity: EquityPoint[] = [];
      let cash = capital,
        quantity = 0,
        entryPrice = 0,
        entryCost = 0,
        entryTime = 0,
        peak = capital,
        drawdown = 0;
      const signals = new Map(analysis.signals.map((s) => [s.index, s]));
      candles.forEach((c, i) => {
        const instruction = signals.get(i - 1); // close signal executes at NEXT bar open.
        if (instruction?.side === "buy" && !quantity) {
          entryPrice = c.open * (1 + slip);
          quantity = Math.floor(cash / (entryPrice * (1 + commission)));
          if (quantity > 0) {
            entryCost = quantity * entryPrice * (1 + commission);
            cash -= entryCost;
            entryTime = c.time;
          }
        }
        if (instruction?.side === "sell" && quantity) {
          const exitPrice = c.open * (1 - slip),
            proceeds = quantity * exitPrice * (1 - commission),
            pnl = proceeds - entryCost;
          cash += proceeds;
          trades.push({
            entryTime,
            exitTime: c.time,
            entryPrice,
            exitPrice,
            quantity,
            pnl,
            returnPct: (pnl / entryCost) * 100,
            reason: instruction.reason,
          });
          quantity = 0;
        }
        const value = cash + quantity * c.close * (1 - slip) * (1 - commission);
        peak = Math.max(peak, value);
        drawdown = Math.max(drawdown, ((peak - value) / peak) * 100);
        equity.push({ time: c.time, value });
      });
      const finalEquity = equity.at(-1)?.value ?? capital,
        gains = trades.reduce((s, t) => s + Math.max(0, t.pnl), 0),
        losses = trades.reduce((s, t) => s - Math.min(0, t.pnl), 0);
      return {
        strategyId,
        analysis,
        metrics: {
          totalReturnPct: (finalEquity / capital - 1) * 100,
          maxDrawdownPct: drawdown,
          winRatePct: trades.length
            ? (trades.filter((t) => t.pnl > 0).length / trades.length) * 100
            : 0,
          profitFactor: losses ? gains / losses : null,
          closedTrades: trades.length,
          finalEquity,
        },
        trades,
        equity,
        warnings: [
          ...analysis.warnings,
          ...(trades.length < 10
            ? ["عينة أقل من 10 صفقات مغلقة؛ غير كافية لتقدير نسبة نجاح."]
            : []),
          ...(quantity
            ? [
                "يوجد مركز مفتوح؛ قيمة النهاية تقدير تصفية بالتكاليف، ولم يحتسب كصفقة مغلقة.",
              ]
            : []),
        ],
      };
    });
  const first = candles[0],
    benchmarkQuantity = first
      ? Math.floor(capital / (first.open * (1 + slip) * (1 + commission)))
      : 0,
    benchmarkCash = first
      ? capital - benchmarkQuantity * first.open * (1 + slip) * (1 + commission)
      : capital;
  const benchmark = candles.map((c) => ({
    time: c.time,
    value:
      benchmarkCash +
      benchmarkQuantity * c.close * (1 - slip) * (1 - commission),
  }));
  return {
    results,
    analyses: requested.map(
      (id) =>
        results.find((result) => result.strategyId === id)?.analysis ??
        analyzeStrategy(candles, id, options.params),
    ),
    excludedStrategyIds,
    benchmark,
    warnings: [
      ...excludedStrategyIds.map(
        (id) =>
          `${STRATEGIES.find((strategy) => strategy.id === id)!.name}: رسم تحليلي فقط؛ لم تحسب له مقاييس أداء.`,
      ),
      "تنفيذ شراء فقط عند افتتاح الشمعة التالية؛ لا وقف أو هدف داخل الشمعة. البيانات يجب أن تكون معدلة للأحداث الرأسمالية قبل الاستخدام.",
    ],
  };
}
export function calculateTradeSizing(
  entry: number,
  stop: number,
  target: number,
  capital: number,
  riskPct = 1,
  costs: { commissionBps?: number; slippageBps?: number } = {},
) {
  const commission = (costs.commissionBps ?? 0) / 10000,
    slip = (costs.slippageBps ?? 0) / 10000;
  if (
    ![entry, stop, target, capital, riskPct].every(Number.isFinite) ||
    entry <= 0 ||
    stop <= 0 ||
    stop >= entry ||
    target <= entry ||
    capital <= 0 ||
    riskPct <= 0 ||
    riskPct > 100 ||
    !Number.isFinite(commission) ||
    !Number.isFinite(slip) ||
    commission < 0 ||
    slip < 0 ||
    commission > 0.1 ||
    slip > 0.1
  )
    throw new Error("Invalid long trade levels");
  const entryCost = entry * (1 + slip) * (1 + commission),
    stopProceeds = stop * (1 - slip) * (1 - commission),
    targetProceeds = target * (1 - slip) * (1 - commission);
  const quantity = Math.max(
    0,
    Math.min(
      Math.floor(capital / entryCost),
      Math.floor((capital * riskPct) / 100 / (entryCost - stopProceeds)),
    ),
  );
  return {
    quantity,
    positionValue: quantity * entryCost,
    riskAmount: quantity * (entryCost - stopProceeds),
    rewardAmount: quantity * (targetProceeds - entryCost),
    riskReward: (targetProceeds - entryCost) / (entryCost - stopProceeds),
  };
}
export function buildScenarios(input: Candle[]) {
  const candles = normalizeCandles(input).slice(-20);
  if (!candles.length) return [];
  const resistance = Math.max(...candles.map((c) => c.high)),
    support = Math.min(...candles.map((c) => c.low));
  return [
    {
      id: "bullish",
      label: "صاعد",
      trigger: resistance,
      invalidation: support,
    },
    {
      id: "bearish",
      label: "هابط",
      trigger: support,
      invalidation: resistance,
    },
    { id: "range", label: "عرضي", support, resistance },
  ];
}
/** UTC period buckets; input times are Unix seconds. Last bucket may be incomplete. */
export function aggregateCandles(
  input: Candle[],
  timeframe: "daily" | "weekly" | "monthly",
): Candle[] {
  const candles = normalizeCandles(input);
  if (timeframe === "daily") return candles;
  const buckets = new Map<string, Candle>();
  for (const c of candles) {
    const date = new Date(c.time * 1000);
    if (timeframe === "weekly") {
      const day = date.getUTCDay(); // EGX trading week begins Sunday.
      date.setUTCDate(date.getUTCDate() - day);
    }
    date.setUTCHours(0, 0, 0, 0);
    if (timeframe === "monthly") date.setUTCDate(1);
    const key = date.toISOString().slice(0, 10),
      prior = buckets.get(key);
    if (prior) {
      prior.high = Math.max(prior.high, c.high);
      prior.low = Math.min(prior.low, c.low);
      prior.close = c.close;
      prior.volume += c.volume;
    } else buckets.set(key, { ...c, time: date.getTime() / 1000 });
  }
  return [...buckets.values()];
}

/** Intrabar penetration followed by a same-bar close back in the prior range. */
export function detectFalseBreakouts(input: Candle[], lookback = 20): Signal[] {
  const candles = normalizeCandles(input),
    length = period(lookback, 20),
    signals: Signal[] = [];
  for (let i = length; i < candles.length; i++) {
    const previous = candles.slice(i - length, i),
      high = Math.max(...previous.map((c) => c.high)),
      low = Math.min(...previous.map((c) => c.low)),
      c = candles[i];
    if (c.high > high && c.close <= high)
      signals.push({
        time: c.time,
        index: i,
        side: "sell",
        reason: "اختراق أعلى النطاق ثم إغلاق داخله: اختراق صاعد كاذب محتمل",
      });
    if (c.low < low && c.close >= low)
      signals.push({
        time: c.time,
        index: i,
        side: "buy",
        reason: "كسر أدنى النطاق ثم إغلاق داخله: كسر هابط كاذب محتمل",
      });
  }
  return signals;
}
/** Normalize both series from their first shared day; never forward-fill missing days. */
export function calculateRelativeStrength(
  stock: Candle[],
  benchmark: Candle[],
): {
  time: number;
  stockIndex: number;
  benchmarkIndex: number;
  relativeStrength: number;
}[] {
  const benchmarkByTime = new Map(
    normalizeCandles(benchmark).map((c) => [c.time, c.close]),
  );
  const aligned = normalizeCandles(stock).filter((c) =>
    benchmarkByTime.has(c.time),
  );
  if (!aligned.length) return [];
  const first = aligned[0],
    firstBenchmark = benchmarkByTime.get(first.time)!;
  return aligned.map((c) => {
    const stockIndex = (c.close / first.close) * 100,
      benchmarkIndex = (benchmarkByTime.get(c.time)! / firstBenchmark) * 100;
    return {
      time: c.time,
      stockIndex,
      benchmarkIndex,
      relativeStrength: (stockIndex / benchmarkIndex) * 100,
    };
  });
}
/** Explicit user-supplied assumptions. No financial statements or market P/E are inferred. */
export function estimateFairValue(input: {
  eps: number;
  peLow: number;
  peHigh: number;
  asOf: string;
  source: string;
}) {
  const { eps, peLow, peHigh, asOf, source } = input;
  if (
    ![eps, peLow, peHigh].every(Number.isFinite) ||
    eps <= 0 ||
    peLow <= 0 ||
    peHigh < peLow ||
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    !Number.isFinite(Date.parse(asOf)) ||
    !source.trim()
  )
    throw new Error("Positive EPS, P/E assumptions, dated source required");
  return {
    method: "EPS × assumed P/E",
    low: eps * peLow,
    high: eps * peHigh,
    asOf,
    source,
    assumptions: { eps, peLow, peHigh },
    warning:
      "نطاق تقديري يعتمد على افتراضات المستخدم؛ لا يشمل النمو أو الدين ولا يمثل سعرًا مستهدفًا موثوقًا.",
  };
}
export type MarketEvent = {
  date: string;
  type: "earnings" | "dividend" | "corporate_action" | "other";
  title: string;
  source: string;
};
export function normalizeMarketEvents(events: MarketEvent[]): MarketEvent[] {
  const seen = new Set<string>();
  return events
    .filter(
      (e) =>
        /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
        Number.isFinite(Date.parse(e.date)) &&
        ["earnings", "dividend", "corporate_action", "other"].includes(
          e.type,
        ) &&
        e.title.trim() &&
        e.source.trim(),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((e) => {
      const key = [e.date, e.type, e.title].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
