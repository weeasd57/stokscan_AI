import { IntentPlan, ToolResult } from "./types";

export interface ResponseTask {
    kind: "decision_comparison" | "comparison" | "explanation" | "fact";
    symbols: string[];
    criterion: "intraday" | "risk" | "relative_volume" | "momentum" | "unspecified";
    target: string | null;
    requires: string[];
}

const normalize = (value: string) => value.replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase();

/** The answer's job is independent of the dominant intent/tool. Both the
 * responder and publication gate derive it from the same current request. */
export function resolveResponseTask(message: string, plan: IntentPlan,
    history: Array<{ role: string; content: string }> = []): ResponseTask {
    const text = normalize(message);
    const symbols = Array.from(new Set((plan.entities?.symbols || []).map(s => s.toUpperCase())));
    const choice = /ايهما|ايهم|انهي|انهو|مين|اي واحد|افضل|احسن|انسب|اختار|اختيار|ترجح|ترشح|تفضل|اقوي|اقل مخاطره|\b(?:which|better|best|prefer|choose)\b/.test(text);
    // A short criterion answer inherits only the immediately preceding task,
    // never an arbitrary old conversation or a fresh explicit data question.
    const criterionReply = /^(?:عايز|عاوزه|عايزه|انا|لـ|ل|اللي|الا)?\s*(?:للمضاربه|مضاربه|اقل مخاطره|مخاطره اقل|الاكثر سيوله|سيوله|الزخم)(?:\s+(?:بس|اكتر|اعلي|النهارده))?[.!؟?]*$/.test(text.trim());
    const previousUser = [...history].reverse().find(m => m.role === "user")?.content || "";
    const previousAssistant = [...history].reverse().find(m => m.role === "assistant")?.content || "";
    const inherited = symbols.length >= 2 && criterionReply
        && /ايهما|افضل|احسن|انسب|اختار|ترشح|مين/.test(normalize(previousUser + " " + previousAssistant));
    const context = inherited ? `${normalize(previousUser)} ${text}` : text;
    const decision = symbols.length >= 2 && (choice || inherited || plan.request?.answer_kind === "decision_comparison" || plan.response_task?.kind === "decision_comparison");
    const criterion: ResponseTask["criterion"] = /مخاطر|مخاطره|امن|امان|محافظ/.test(context) ? "risk"
        : /مضارب|سكالب|intraday|يومي|جلسه/.test(context) ? "intraday"
        : /سيول|حجم|تداول/.test(context) ? "relative_volume"
        : /زخم|momentum|اقوي|اسرع/.test(context) ? "momentum" : plan.response_task?.criterion || "unspecified";
    const target = plan.entities?.requested_date || context.match(/(?:يوم\s+)?(?:الاثنين|الاتنين|الاحد|الثلاثاء|الاربعاء|الخميس|الجمعه|السبت)|بكره|غدا|النهارده|اليوم|الاسبوع/)?.[0] || plan.response_task?.target || null;
    return { kind: decision ? "decision_comparison" : symbols.length >= 2 && plan.intent === "comparison" ? "comparison"
        : /ليه|لماذا|اشرح|فسر|يعني ايه/.test(text) ? "explanation" : "fact", symbols, criterion, target,
        requires: decision ? ["direct_conclusion_or_specific_insufficiency", "evidence_for_all_candidates", "criterion_tradeoffs", "conditions_and_limits"] : ["requested_facts"] };
}

export function completeDecisionTools(message: string, plan: IntentPlan, history: Array<{ role: string; content: string }> = []): void {
    const task = resolveResponseTask(message, plan, history);
    plan.response_task = task;
    if (task.kind !== "decision_comparison" || plan.clarification_needed || plan.tools.includes("manage_portfolio")) return;
    plan.intent = "comparison";
    const tools = new Set([...plan.tools, "get_stock", "get_comparison"]);
    if (task.criterion === "intraday" || task.criterion === "risk") tools.add("get_stock_levels");
    plan.tools = Array.from(tools);
    plan.needs_live_data = true;
}

/** Completion checks are additional to numerical/source checks. A verified
 * list of numbers does not satisfy a request to choose between alternatives. */
export function checkResponseTask(reply: string, task: ResponseTask, results: ToolResult[]): string[] {
    if (task.kind !== "decision_comparison") return [];
    const reasons: string[] = [];
    const text = normalize(reply);
    for (const symbol of task.symbols) {
        if (!new RegExp(`\\b${symbol}\\b`, "i").test(reply)) reasons.push(`المفاضلة لم تغطِ المرشح ${symbol}.`);
    }
    const clauses = text.split(/[\n؛.!؟]/).filter(Boolean);
    const conclusion = clauses.some(c => task.symbols.some(s => c.includes(s.toLowerCase()))
        && /ارجح|ارشح|اميل|اختار|الاولويه|اولويه|انسب|افضل|احسن|اقوي|اهد[اأ]|اقل.{0,15}(?:تشبع|سخون)|اعلي.{0,15}(?:حجم|نشاط)|حجم.{0,15}(?:اعلي|اكبر)/.test(c)
        && !/لا (?:يعني|يثبت|يكفي|ارجح|ارشح)|لا استطيع|لا يمكن|ليس (?:افضل|الافضل)|مش (?:افضل|الافضل)/.test(c));
    const explicitLimit = /(?:لا استطيع|لا يمكن|لا اقدر|لا ارجح|لا تسمح|لا تكفي|غير كافيه|تعذر).{0,90}(?:ترجيح|اختيار|تحديد.{0,15}(?:الافضل|الانسب)|مفاضله|حسم|افضل)/.test(text);
    const concreteMissing = /(?:غير متاح|غير موثق|غير مكتمل|ناقص|ينقص|غياب|لا تتوفر|لا توجد).{0,65}(?:بيانات|سعر|تاريخ|حجم|افتتاح|طلبات|عروض|دعم|مقاومه)|(?:بيانات|سعر|تاريخ|حجم|افتتاح|طلبات|عروض|دعم|مقاومه).{0,65}(?:غير متاح|غير موثق|ناقص|غياب|لا تتوفر|لا توجد)|تواريخ مختلفه|قديمه|اقدم|لم تبدا الجلسه|قبل الافتتاح/.test(text);
    if (!conclusion && !(explicitLimit && concreteMissing)) reasons.push("السؤال يطلب مفاضلة: عرض الأسعار والمؤشرات فقط لا يجيب عنه. قدم خلاصة مشروطة مرتبطة بالمعيار أو اذكر المعلومة المحددة التي تمنع الترجيح.");
    const reasoning = /لان|بسبب|من زاويه|بينما|مقارنه|مقابل|لكن|يتفوق|اعلي|اقل|اكبر|اقوي|تشبع|سخون/.test(text);
    if (conclusion && !reasoning) reasons.push("الترجيح يحتاج تفسيراً من الأدلة، ولا يكفي ذكر اسم السهم المختار.");
    if (task.criterion === "risk" && !/مخاطر|مخاطره|دعم|وقف|افتتاح|تنفيذ|امتداد|تشبع/.test(text)) reasons.push("السؤال يطلب مفاضلة المخاطرة، لا مفاضلة حجم أو تغير سعر فقط.");
    const recordedPeriod = Boolean(task.target && /^\d{4}-\d{2}-\d{2}$/.test(task.target));
    if (!recordedPeriod && (task.criterion === "intraday" || task.target) && !/لو|اذا|بشرط|مشروط|راقب|مراقبه|انتظر|تنتظر|تأكيد|تاكيد|عند.{0,20}(?:افتتاح|اختراق|ثبات)|لا استطيع|لا يمكن|لا اقدر|تعذر/.test(text)) {
        reasons.push("المفاضلة لجلسة محددة تحتاج شرط تنفيذ أو عدم يقين، ولا يجوز تحويل إغلاق سابق إلى نتيجة مستقبلية مؤكدة.");
    }
    if (/مضمون|اكيد.{0,20}(?:هيطلع|يصعد|يرتفع|يكسب)|سيحقق.{0,20}(?:ربح|مكسب)|سيرتفع حتما/.test(text)) reasons.push("لا تضمن نتيجة الجلسة أو ربح المضاربة من بيانات تاريخية.");
    // No global safety/return claim follows from a relative-volume or RSI edge.
    if (/(?:اقل مخاطره|اكثر امانا|اضمن|اعلي عائد)/.test(text)
        && !/من زاويه|تشبع|سخون|لا يثبت|لا يعني|لا تكفي|لا يمكن|ليس|مش مضمون/.test(text)) reasons.push("ميزة مؤشر واحد لا تثبت أماناً عاماً أو عائداً أعلى؛ حدد زاوية المفاضلة وحدودها.");
    return reasons;
}
