import { IntentPlan, ToolResult } from "./types";
import { ResponseTask, resolveResponseTask } from "./response-task";
import { buildComparisonMatrix, ComparisonStock } from "./comparison-matrix";
import { todayInCairo } from "./cairo-date";
import { proseOwner, stockSection } from "./prose-ownership";

const dateOnly = (date: string | null | undefined) => date && Number.isFinite(Date.parse(date)) ? date.slice(0, 10) : null;
type Metric = "vol_ratio" | "rsi" | "change_pct";
const field = (metric: Metric) => metric === "rsi" ? "rsi_14" : metric;
export function buildDecisionEvidence(task: ResponseTask, results: ToolResult[], today = todayInCairo()) {
    const matrix = buildComparisonMatrix(results);
    const stocks = task.symbols.map(symbol => matrix?.stocks.find(s => s.symbol === symbol)).filter(Boolean) as ComparisonStock[];
    const complete = stocks.length === task.symbols.length && stocks.every(s => s.price != null && s.price > 0 && s.as_of);
    const dates = stocks.map(s => dateOnly(s.as_of));
    const sameDate = complete && new Set(dates).size === 1;
    const sameKind = new Set(stocks.map(s => s.quote_kind)).size === 1;
    const age = dates[0] ? (Date.parse(today) - Date.parse(dates[0])) / 86400000 : Infinity;
    // Calendar bound protects current requests across weekends without claiming
    // knowledge of exchange holidays or a future session's opening conditions.
    const recent = sameDate && age >= 0 && age <= 7;
    const historical = Boolean(task.target?.match(/^\d{4}-\d{2}-\d{2}$/));
    const comparable = sameDate && sameKind && (historical ? dates[0] === task.target : recent);
    const leader = (metric: Metric, direction: "higher" | "lower") => {
        if (!comparable || stocks.some(s => s[metric] == null ||
            dateOnly(Object.prototype.hasOwnProperty.call(s.metric_dates, field(metric)) ? s.metric_dates[field(metric)] : s.as_of) !== dates[0])) return null;
        const sorted = [...stocks].sort((a, b) => direction === "higher" ? b[metric]! - a[metric]! : a[metric]! - b[metric]!);
        return sorted[0][metric] !== sorted[1][metric] ? sorted[0].symbol : null;
    };
    return { task, stocks, complete, comparable, leaders: {
        relative_volume: leader("vol_ratio", "higher"), less_rsi_extension: leader("rsi", "lower"), recorded_price_change: leader("change_pct", "higher"),
    }, limits: [
        ...(!complete ? ["بيانات السعر أو تاريخ الرصد غير مكتملة لكل المرشحين"] : []),
        ...(complete && !sameDate ? ["تواريخ مختلفة لبيانات المرشحين"] : []),
        ...(complete && !sameKind ? ["بيانات سعر لحظي وإغلاق مسجل مختلطة؛ لا توجد لقطة مقارنة متزامنة"] : []),
        ...(sameDate && historical && dates[0] !== task.target ? ["لا توجد بيانات المقارنة في التاريخ المطلوب"] : []),
        ...(sameDate && !recent && !historical ? ["البيانات قديمة أو تاريخها لاحق لتاريخ اليوم"] : []),
        historical ? "هذه مفاضلة للملاحظات المسجلة في التاريخ المطلوب وليست توقعاً لعائد لاحق"
            : "الأدلة المستخدمة هنا أسعار ومؤشرات مسجلة، ولا تتضمن بيانات افتتاح الجلسة المطلوبة وفارق الطلب والعرض وعمق الأوامر؛ لا يمكن حسم تنفيذ المضاربة منها",
    ] };
}

export function decisionPrompt(message: string, plan: IntentPlan, results: ToolResult[], history: Array<{ role: string; content: string }> = []) {
    const task = resolveResponseTask(message, plan, history);
    if (task.kind !== "decision_comparison") return "";
    return ["=== ANSWER COMPLETION CONTRACT ===", JSON.stringify(buildDecisionEvidence(task, results)),
        "المستخدم يريد مفاضلة، لا قائمة أرقام. ابدأ بخلاصة مشروطة أو نقص دليل محدد. فسّر المفاضلة لكل الأسهم ومعيار المضاربة/المخاطرة/الحجم المطلوب.",
        "قارن فقط الجوانب المدعومة في leaders؛ null يعني غياب دليل مقارنة أو تعادل، وليس صفرًا. لا تحول حجم التداول النسبي إلى سيولة مطلقة أو RSI أقل إلى أمان عام.",
        "اذكر تاريخ كل سعر بجانبه. افصل جلسة المستخدم المطلوبة عن جلسة البيانات. قدم ما تراقبه عند الافتتاح وما يلغي الفكرة؛ لا تخترع سعر دخول/وقف/هدف أو توقعًا مضمونًا.",
        "لو الأدلة متعارضة قل أي سهم يتقدم في أي زاوية. لا تتهرب بعبارة القرار لك، ولا تطلب الأفق الزمني إذا حدده المستخدم.",
    ].join("\n");
}

/** Outage/repair response preserves the job of the answer, with no extra call. */
export function buildDecisionFallback(message: string, plan: IntentPlan, results: ToolResult[], history: Array<{ role: string; content: string }> = []): string | null {
    const task = resolveResponseTask(message, plan, history);
    if (task.kind !== "decision_comparison") return null;
    const evidence = buildDecisionEvidence(task, results);
    const { leaders } = evidence;
    const lines: string[] = [];
    if (!evidence.comparable) {
        lines.push(`لا أستطيع ترجيح ${task.symbols.join(" أو ")} بصورة موثوقة: ${evidence.limits.slice(0, -1).join("؛ ") || "لا توجد بيانات مقارنة مكتملة"}.`);
    } else if (task.criterion === "relative_volume" && leaders.relative_volume) {
        lines.push(`${leaders.relative_volume} يتقدم من زاوية نشاط الحجم النسبي؛ هذه أفضلية حجم مقارنة بمتوسطه فقط، ولا تثبت أنه الأعلى في قيمة التداول أو عمق السيولة.`);
    } else if (task.criterion === "momentum" && leaders.recorded_price_change) {
        lines.push(`${leaders.recorded_price_change} أقوى من زاوية تغير السعر في الجلسة المسجلة؛ هذا وصف أداء سابق وليس توقع الجلسة المطلوبة.`);
    } else if (leaders.relative_volume && leaders.relative_volume === leaders.less_rsi_extension && task.criterion !== "risk") {
        lines.push(`أميل لمراقبة ${leaders.relative_volume} أولاً من زاوية نشاط الحجم النسبي مع امتداد أقل في RSI؛ هذه أولوية مراقبة مشروطة وليست أمر شراء عند الافتتاح.`);
    } else {
        lines.push(`لا أرجّح سهمًا أفضل مطلقًا بين ${task.symbols.join(" و")}: المفاضلة تتغير حسب معيارك، ولا توجد أفضلية موثقة كافية لحسمها.`);
    }
    const number = (value: number | null, suffix = "") => value == null ? "غير متاح" : `${value.toFixed(2)}${suffix}`;
    for (const symbol of task.symbols) {
        const stock = evidence.stocks.find(s => s.symbol === symbol);
        const metricDate = (key: string) => {
            if (!stock || !Object.prototype.hasOwnProperty.call(stock.metric_dates, key)) return "";
            const observed = dateOnly(stock.metric_dates[key]);
            return !observed ? " (تاريخه غير موثق)" : observed !== dateOnly(stock.as_of) ? ` (بتاريخ ${observed})` : "";
        };
        lines.push(stock ? `- ${symbol}: ${stock.quote_kind === "live_intraday" ? "سعر لحظي" : "إغلاق مسجل"} ${number(stock.price, " جنيه")} بتاريخ ${stock.as_of || "غير موثق"}؛ التغير ${number(stock.change_pct, "%")}${metricDate("change_pct")}، RSI ${number(stock.rsi)}${metricDate("rsi_14")}، نسبة الحجم ${number(stock.vol_ratio, "x")}${metricDate("vol_ratio")}.`
            : `- ${symbol}: بيانات السعر والمؤشرات غير متاحة في النتائج الحالية.`);
    }
    if (evidence.comparable) {
        if (leaders.relative_volume) lines.push(`${leaders.relative_volume} لديه حجم نسبي أعلى من بقية المرشحين؛ الحجم النسبي ليس قيمة السيولة المطلقة.`);
        if (leaders.less_rsi_extension) lines.push(`${leaders.less_rsi_extension} أقل امتدادًا من زاوية RSI فقط؛ لا يعني ذلك أمانًا عامًا أو أن الآخر سيهبط.`);
        if (leaders.recorded_price_change) lines.push(`${leaders.recorded_price_change} أقوى من زاوية التغير السعري المسجل، بينما قوة الجلسة السابقة لا تضمن استمرارها.`);
        if (!Object.values(leaders).some(Boolean)) lines.push("لا توجد أفضلية كمية موثقة بين المرشحين؛ بيانات المؤشرات غير متاحة للمقارنة أو متعادلة.");
    }
    if (!task.target || !/^\d{4}-\d{2}-\d{2}$/.test(task.target)) lines.push(`لـ${task.target || "الجلسة المطلوبة"}: لو ظهرت فجوة سعرية كبيرة أو ضعف تنفيذ، انتظر؛ راقب تأكيد الحركة بحجم الجلسة والثبات فوق دعم موثق، وتجنب مطاردة السعر. هذه شروط مراقبة، لا إثبات لحدوثها.`);
    lines.push(evidence.limits[evidence.limits.length - 1]);
    return lines.join("\n");
}

export function checkDecisionComparatives(reply: string, task: ResponseTask, results: ToolResult[]): string[] {
    if (task.kind !== "decision_comparison") return [];
    const evidence = buildDecisionEvidence(task, results);
    const reasons: string[] = [];
    const normalized = reply.replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
    let section: string | null = null;
    for (const line of normalized.split("\n")) {
        section = stockSection(line, task.symbols) || section;
        for (const clause of line.split(/[؛.!؟،]|\s+(?:بينما|مقابل|لكن)\s+|\s+و(?=[a-z]{2,6}\b)/i)) {
        const first = proseOwner(clause, task.symbols, section);
        if (!first) continue;
        const index = clause.toUpperCase().indexOf(first);
        const before = index >= 0 ? clause.slice(0, index) : clause;
        const after = index >= 0 ? clause.slice(index + first.length) : clause;
        if (/(?:لو|اذا|قد|لا يمكن|لا استطيع)\s*$/.test(before.trim()) || /^\s*(?:ليس|مش|لا\b)/.test(after)) continue;
        const volumeClaim = /(?:حجم.{0,20}(?:اعلي|اكبر)|(?:اعلي|اكبر).{0,20}حجم|يتقدم.{0,35}حجم)/i.test(clause);
        const rsiClaim = /اقل.{0,30}(?:rsi|امتداد|تشبع|سخون)/i.test(clause);
        const changeClaim = /اقوي.{0,25}تغير|اعلي.{0,25}تغير/i.test(clause);
        const claims = [volumeClaim ? evidence.leaders.relative_volume : undefined,
            rsiClaim ? evidence.leaders.less_rsi_extension : undefined, changeClaim ? evidence.leaders.recorded_price_change : undefined];
        if (claims.some(claimed => claimed !== undefined && claimed !== first)) reasons.push(`${first}: الأفضلية المقارنة المذكورة لا تثبتها قيم المؤشر وتواريخه لكل المرشحين.`);
        }
    }
    return reasons;
}

/** Missing is a claim too. Keep it tied to the supplied observations rather
 * than accepting a generic model disclaimer that contradicts available data. */
export function checkDecisionGrounding(reply: string, task: ResponseTask, results: ToolResult[]): string[] {
    if (task.kind !== "decision_comparison") return [];
    const evidence = buildDecisionEvidence(task, results);
    const reasons: string[] = [];
    for (const raw of reply.split("\n")) {
        const line = raw.replace(/[\u064B-\u065F\u0670\u0640*_`]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").toLowerCase();
        const deniesScores = /(?:لا تتوفر|لا توجد|غير متاحه).{0,25}(?:درجات|قيم|تقييم).{0,30}(?:نماذج|نموذج|king|egx)|(?:درجات|قيم|تقييم).{0,30}(?:king|egx|النماذج).{0,25}(?:غير متاحه|لا تتوفر|لا توجد)/.test(line);
        if (deniesScores) {
            const named = evidence.stocks.filter(stock => new RegExp(`\\b${stock.symbol}\\b`, "i").test(raw));
            const candidates = named.length ? named : evidence.stocks;
            const keys: Array<"king_ai_score" | "egx_ai_score"> = [];
            if (/king/.test(line)) keys.push("king_ai_score");
            if (/egx/.test(line)) keys.push("egx_ai_score");
            if (!keys.length) keys.push("king_ai_score", "egx_ai_score");
            if (candidates.some(stock => keys.some(key => stock[key] != null))) reasons.push("الرد ينفي وجود درجات نموذج متاحة في البيانات؛ غياب تفسير الدرجة أو معايرتها لا يعني غياب الدرجة نفسها.");
        }
        if (/(?:اول|انتظر|انتظار|خلال|بعد).{0,25}\d+(?:\s*[–-]\s*\d+)?\s*دقيقه/.test(line)) {
            reasons.push("مدة الانتظار الرقمية للتنفيذ ليست قاعدة موثقة في أدلة المفاضلة؛ استخدم تأكيد الحركة دون اختراع توقيت دخول.");
        }
    }
    return reasons;
}
