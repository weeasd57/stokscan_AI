import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Memory store for tracking duplicate portfolio total values per user session
const portfolioTotalsByUser = new Map<string, Set<string>>();


// Input security filters to prevent jailbreaks, extraction of system prompt, or unauthorized access
const BLOCKED_INPUT_PATTERNS = [
    "system prompt", "ignore previous", "your instructions",
    "developer mode", "jailbreak", "ignore all",
    "admin_secret_key", "api_key", "database", "supabase", "postgres",
    "بيانات مستخدم", "قاعدة بيانات", "كلمة السر", "بيانات سرية", "اختراق", "باسورد",
    "ignore previous instructions", "system instructions", "you must ignore"
];

type UserIntent = "Count" | "YesNo" | "Compare" | "Analyze" | "News" | "Portfolio" | "Recommendation" | "ActionAdvice" | "Sector" | "Education" | "Emotional" | "Dividends" | "General";

async function detectIntent(message: string, apiKey: string): Promise<UserIntent> {
    if (!message || message.trim() === "") return "General";
    if (message.includes("صورة") || message.includes("محفظة")) return "Portfolio";
    
    const lower = message.toLowerCase();
    if (/كام|كم عدد|عددي|كم/.test(lower)) return "Count";
    if (/أشتري إيه|ترشحلي|توصية|توصيات|سهم كويس|أدخل في إيه|ادخل في ايه|توصيه|سهم حلو|أدخل ولا|ادخل ولا/.test(lower)) return "Recommendation";
    if (/أبيع|ابيع|أحتفظ|احتفظ|أوقف خسارة|وقف خسارة|اخرج ولا|اصبر|أصبر|أنسل|انسل|أخلع|اخلع|أمسك|امسك/.test(lower)) return "ActionAdvice";
    if (/هل|تجميع|مؤسسي|في مشتري|مشتري|تمام ولا|حلو ده|حلو دا|فيها خير/.test(lower)) return "YesNo";
    if (/ولا|أو|مقارنة|قارن|vs/i.test(lower)) return "Compare";
    if (/قطاع|قطاعات|عقارات|بنوك|أدوية|بتروكيماويات|اسمدة|أسمدة/.test(lower)) return "Sector";
    if (/أخبار|خبر|اخبار/.test(lower)) return "News";
    if (/يعني إيه|يعني ايه|إيه هو|ايه هو|اشرح|شرح|كيف يعمل|مؤشر|فوليوم|سيولة/.test(lower)) return "Education";
    if (/خسران|فلوسي|السوق وحش|زعلان|نصابة|اتمرجنت|خسارة كبيرة|نازلة للركب/.test(lower)) return "Emotional";
    if (/كوبون|توزيع|أرباح|ارباح|جمعية عمومية|مجاني/.test(lower)) return "Dividends";
    
    try {
        const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "meta/llama-3.1-8b-instruct",
                messages: [
                    {
                        role: "system",
                        content: `You are an Intent Classifier. Categorize the user's message into EXACTLY ONE of these intents: Count, YesNo, Compare, Analyze, News, Portfolio, Recommendation, ActionAdvice, Sector, Education, Emotional, Dividends, General. Output ONLY the word.`
                    },
                    { role: "user", content: message }
                ],
                max_tokens: 15,
                temperature: 0.1
            })
        });
        const json = await res.json();
        const intentText = json.choices?.[0]?.message?.content?.trim() || "General";
        const valid = ["Count", "YesNo", "Compare", "Analyze", "News", "Portfolio", "Recommendation", "ActionAdvice", "Sector", "Education", "Emotional", "Dividends", "General"];
        if (valid.includes(intentText)) return intentText as UserIntent;
    } catch (e) {
        console.warn("Intent detection failed", e);
    }
    return "General";
}

function filterInput(text: string): boolean {
    const lowered = text.toLowerCase();
    return !BLOCKED_INPUT_PATTERNS.some(pattern => lowered.includes(pattern));
}

// Output filter to prevent direct financial recommendations or guaranteed profit statements
function filterOutput(response: string): string {
    const blockedOutputRegex = /(اشتري الآن|شراء فوراً|شراء الان|مضمون|ضمان|أرباح مؤكدة|ارباح مؤكدة|guaranteed|assurance|buy now)/i;
    if (blockedOutputRegex.test(response)) {
        return "أنا أداة تحليلية ذكية، ولا يمكنني تقديم نصائح مالية أو توصيات شراء مباشرة. يمكنك مراجعة تقييم الأسهم في صفحة الماسح الذكي لمساعدتك في اتخاذ القرار.";
    }
    return response;
}

// Vision model configuration - Use 11B Vision model (fastest and available across all API tiers)
const NVIDIA_VISION_MODELS = [
    "meta/llama-3.2-11b-vision-instruct",
    "meta/llama-3.2-90b-vision-instruct"
];

const VISION_MODEL = NVIDIA_VISION_MODELS[0];

export async function POST(req: NextRequest) {
    try {
        const authClient = createSupabaseServerClient(req);
        const supabase = getSupabaseClient(); // Service role client for DB

        // 1. Authenticate user
        const { data: { user }, error: authError } = await authClient.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
        }
        
        const userId = user.id;
        const { message, history, image, images, model: userRequestedModel, session_id: inputSessionId } = await req.json();

        
        // Normalize images into array
        const rawImages: string[] = Array.isArray(images) && images.length > 0 
            ? images 
            : (typeof image === "string" && image.startsWith("data:image/") ? [image] : []);
        
        const imageList = rawImages.filter(img => typeof img === "string" && img.startsWith("data:image/"));
        const hasImages = imageList.length > 0;

        if (!message && !hasImages) {
            return NextResponse.json({ detail: "Message or image is required" }, { status: 400 });
        }

        // Apply Input Filtering Layer
        if (message && typeof message === "string" && !filterInput(message)) {
            return NextResponse.json({
                reply: "معذرة، لا يمكنني الاستجابة لهذه الرسالة بناءً على إرشادات الأمان والحماية الخاصة بالمنصة.",
                remaining_quota: 4
            });
        }

        // Format conversation history for AI model (text-only for history, max 4 turns)
        const formattedHistory = Array.isArray(history)
            ? history
                .filter((item: any) => item && item.content && (item.role === "user" || item.role === "assistant"))
                .slice(-4)
                .map((item: any) => {
                    let text = String(item.content);
                    // Filter out repetitive English image captions or long repetitive template text
                    if (text.includes("[Caption:")) {
                        text = text.replace(/\[Caption:[^\]]+\]/gi, "").trim();
                    }
                    if (text.startsWith("📷 [")) {
                        text = text.replace(/^📷\s*\[[^\]]+\]\s*/, "").trim();
                    }
                    if (text.includes("The image depicts a screenshot of")) {
                        text = "تحليل صورة الشاشة والمحفظة.";
                    }
                    // Strip old hallucinated button lists from history so AI doesn't mimic them in old sessions
                    if (text.includes("أزرار الاقتراحات") || text.includes("[قارن بـ")) {
                        text = text.replace(/.*أزرار الاقتراحات.*?\n/gi, "")
                                   .replace(/•\s*\[[^\]]+\]/gi, "")
                                   .replace(/اختر أزرار الاقتراحات.*?\n/gi, "").trim();
                    }
                    if (text.length > 500) {
                        text = text.substring(0, 500) + "...";
                    }
                    return { role: item.role, content: text || "تحليل الأسهم" };
                })

            : [];

        // 2. Fetch User Profile
        const { data: profile } = await supabase
            .from("profiles")
            .select("display_name, username, telegram_chat_id")
            .eq("id", userId)
            .single();

        const userName = profile?.display_name || profile?.username || user.email || "Unknown User";

        const userEmail = user.email || "";
        const isUnlimited = ["weeessd57@gmail.com", "user@gmail.com", "weeasd57@gmail.com"].includes(userEmail.toLowerCase());

        // 3. Enforce Daily Limit (Skipped for unlimited users)
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        
        let { data: limitData } = await supabase
            .from("ai_chatbot_limits")
            .select("chat_count")
            .eq("user_id", userId)
            .eq("date", today)
            .maybeSingle();

        if (!isUnlimited && limitData && limitData.chat_count >= 15) {
            return NextResponse.json({ 
                detail: "Daily limit reached. You can send up to 15 messages per day." 
            }, { status: 429 });
        }

        // 3.5 Prepare API Keys and Intent Engine
        const keysToTry = Array.from(new Set([
            process.env.NVIDIA_API_KEY,
            process.env.NVIDIA_SECONDARY_API_KEY,
        ].filter((k): k is string => Boolean(k))));

        if (keysToTry.length === 0) {
            return NextResponse.json({ detail: "AI service not configured" }, { status: 500 });
        }
        const primaryApiKey = keysToTry[0];
        
        const textMessage = message || "";
        const userIntent = hasImages ? "Portfolio" : await detectIntent(textMessage, primaryApiKey);
        
        // 4. Fetch Chatbot Settings & Build Dynamic System Prompt based on Intent
        let systemPrompt = `🚫 قاعدة صارمة ومطلقة ضد الاختلاق (Anti-Hallucination Rule #1):
- ممنوع منعاً باتاً اختراع، تكميل، أو تخمين أي أرقام، أسعار، نسب، أسهم.
- لا تخترع أي أرقام أو أسعار أو إحصائيات غير موجودة صراحة في البيانات المرفقة.
- إذا طلب المستخدم "أقوى الأسهم" ولم تكن في البيانات، يُمنع الاختراع.

أنت المساعد الذكي المالي والمحلل الفني الأول للبورصة المصرية على منصة EGX Bots.
التاريخ والوقت الحالي: ${new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })}

🗣️ **لغة البورصة المصرية الحقيقية:**
استخدم لغة "البورصجية" (مثل: طالع بقوة، في تجميع، قافل على قد نفسه).

🎯 **تعليمات الإجابة الخاصة بنوع السؤال (${userIntent}):**
`;

        switch (userIntent) {
            case "Count":
                systemPrompt += `- المستخدم يسأل عن عدد شيء معين.
- أجب برقم فقط، متبوعاً بجملة واحدة قصيرة جداً توضح العدد.
- مثال: "يوجد 4 أخبار إيجابية اليوم." أو "يوجد سهمين صاعدين."
- ممنوع ذكر تفاصيل أو قوائم طويلة، فقط العدد المطلوب.`;
                break;
            case "YesNo":
                systemPrompt += `- المستخدم يسأل سؤال نعم أو لا (مثل: هل يوجد تجميع؟ هل السهم صاعد؟).
- أجب بـ (نعم) أو (لا) صريحة في بداية الرد.
- أتبعها بجملة واحدة تبريرية من البيانات المرفقة.
- مثال: "نعم، السهم به تجميع واضح بسبب ارتفاع السيولة."`;
                break;
            case "Compare":
                systemPrompt += `- المستخدم يقارن بين سهمين أو أكثر.
- استخدم جدول مقارنة صغير وبسيط (Markdown Table) للمؤشرات.
- اكتب سطر خلاصة تحت الجدول يوضح أيهما الأفضل فنياً باختصار.`;
                break;
            case "News":
                systemPrompt += `- المستخدم يسأل عن أخبار.
- أجب بأهم خبرين فقط بأسلوب مختصر ومباشر.
- لا تذكر تحليلات فنية (MACD, RSI) ما لم تُسأل عنها.`;
                break;
            case "Portfolio":
                systemPrompt += `- المستخدم أرسل صورة محفظة أو يسأل عنها.
- استخرج الأسهم والأرقام المكتوبة فقط في قائمة نقطية.
- لا تقدم نصائح مالية، اقرأ البيانات المكتوبة فقط بصيغة (الاسم: القيمة).`;
                break;
            case "Recommendation":
                systemPrompt += `- المستخدم يطلب توصية مباشرة بالاسم (أشتري إيه؟).
- يمنع منعاً باتاً ذكر اسم سهم من خيالك أو تقديم نصيحة شراء مباشرة.
- أجب بأنك أداة تحليل ذكية ولست مستشاراً مالياً، ثم وجهه لمتابعة كاشف الحد اليومي أو الأسهم ذات السيولة العالية في السوق كأمثلة للدراسة.`;
                break;
            case "ActionAdvice":
                systemPrompt += `- المستخدم يطلب قراراً صريحاً بالبيع أو الشراء أو وقف الخسارة.
- يمنع تماماً إعطاء أمر مباشر "بيع" أو "اشتري".
- بدلاً من ذلك، حدد له بوضوح أرقام الدعم والمقاومة، واتجاه السهم الحالي، ثم أخبره أن "القرار النهائي يرجع لإدارة محفظتك".`;
                break;
            case "Sector":
                systemPrompt += `- المستخدم يسأل عن قطاع معين.
- ركز بنسبة 100% على أداء هذا القطاع من بيانات السوق المرفقة (Sectors).
- اذكر ما إذا كان القطاع يستقطب سيولة أم يشهد جني أرباح.`;
                break;
            case "Education":
                systemPrompt += `- المستخدم يسأل سؤالاً تعليمياً (مثل شرح مؤشر أو مصطلح).
- اشرح المفهوم بأسلوب مبسط جداً وبلغة البورصجية.
- لا تسرد أرقاماً، بل أعطِ مثالاً عملياً بسيطاً يسهل فهمه.`;
                break;
            case "Emotional":
                systemPrompt += `- المستخدم يشعر بالإحباط، الخسارة، أو يتحدث بانفعال عن السوق.
- تعاطف معه باحترافية، وذكره أن أسواق المال تمر بدورات صعود وهبوط.
- انصحه بأهمية "إدارة المخاطر" وتفعيل "وقف الخسارة" لحماية رأس المال، وازرع فيه الأمل بحذر دون وعود كاذبة.`;
                break;
            case "Dividends":
                systemPrompt += `- المستخدم يسأل عن توزيعات الأرباح، الكوبونات، أو الجمعيات العمومية.
- أخبره بوضوح ولباقة أنه لا تتوفر لديك بيانات اللحظية للكوبونات في الوقت الحالي.
- وضح أن تخصصك هو قراءة حركة الأسعار والسيولة الفنية، واطلب منه مراجعة الشاشة الرسمية للشركة.`;
                break;
            case "Analyze":
                systemPrompt += `- المستخدم يطلب تحليل فني أو استعراض لوضع السوق.
- أجب بنقاط سريعة (Bullet points) توضح الاتجاه، الدعم، والمقاومة، أو الخلاصة المفيدة.
- لا تسرد أرقاماً لا معنى لها، أعطِ الخلاصة المفيدة فقط وبجمل قصيرة.`;
                break;
            case "General":
            default:
                systemPrompt += `- أجب باختصار وبأسلوب ذكي لا يتعدى 3 أسطر.
- كن مباشراً وموجزاً، لا تكتب تقارير مطولة إذا لم يُطلب منك.`;
                break;
        }

        systemPrompt += `\n\n✅ **التنصل والخاتمة (إلزامي):**\nاختم كل رد بالسطر التالي بالضبط بدون تغيير:\n"✅ تحليل EGX Bots مبني على بيانات حية — مش نصيحة استثمار، القرار ليك."`;

        // 4. Fetch Chatbot Settings
        const { data: settings, error: settingsError } = await supabase
            .from("ai_chatbot_settings")
            .select("*")
            .eq("id", 1)
            .single();

        if (settingsError || !settings) {
            return NextResponse.json({ detail: "Chatbot is not configured properly." }, { status: 500 });
        }

        const defaultTextModel = settings.model || "meta/llama-3.1-8b-instruct";
        let chosenModel = userRequestedModel || defaultTextModel;
        let apiUrl = settings.api_url || "https://integrate.api.nvidia.com/v1";

        if (apiUrl.includes("nvidia.com")) {
            const validModels = [
                "meta/llama-3.1-8b-instruct",
                "meta/llama-3.2-11b-vision-instruct",
                "deepseek-ai/deepseek-v4-flash",
                "deepseek-ai/deepseek-v4-pro"
            ];
            if (!validModels.includes(chosenModel)) {
                chosenModel = "meta/llama-3.1-8b-instruct";
            }
        }

        const modelToUse = hasImages ? VISION_MODEL : chosenModel;

        // 4.5 Search Database for Stock Data if mentioned in message or history
        let dynamicSuggestedButtons: string[] = [];

        try {
            let targetSymbol = "";
            let targetStockName = "";

            // Preload exact DB matches for all words in prompt and history to avoid DB queries in loops
            const allWords = new Set<string>();
            const textMessageWords = textMessage.trim().split(/[\s,.-]+/).map((w: string) => w.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()).filter((w: string) => w.length >= 2);
            textMessageWords.forEach((w: string) => allWords.add(w));
            
            formattedHistory.forEach((h: any) => {
                const words = (h.content || "").trim().split(/[\s,.-]+/).map((w: string) => w.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()).filter((w: string) => w.length >= 2);
                words.forEach((w: string) => allWords.add(w));
            });

            let preloadedExactStocks: any[] = [];
            if (allWords.size > 0) {
                const { data } = await supabase.from("stocks").select("symbol, name").in("symbol", Array.from(allWords)).limit(20);
                if (data) preloadedExactStocks = data;
            }

            const stockAliases: Record<string, { sym: string; name: string }> = {
                "abuk": { sym: "ABUK", name: "أبو قير للأسمدة والصناعات الكيماوية" },
                "أبو قير": { sym: "ABUK", name: "أبو قير للأسمدة والصناعات الكيماوية" },
                "ابو قير": { sym: "ABUK", name: "أبو قير للأسمدة والصناعات الكيماوية" },
                "comi": { sym: "COMI", name: "البنك التجاري الدولي (CIB)" },
                "التجاري الدولي": { sym: "COMI", name: "البنك التجاري الدولي (CIB)" },
                "cib": { sym: "COMI", name: "البنك التجاري الدولي (CIB)" },
                "موبكو": { sym: "MFPC", name: "مصر لإنتاج الأسمدة (موبكو)" },
                "mfpc": { sym: "MFPC", name: "مصر لإنتاج الأسمدة (موبكو)" },
                "فوري": { sym: "FWRY", name: "فوري تكنولوجيا البنوك والمدفوعات الإلكترونية" },
                "fwry": { sym: "FWRY", name: "فوري تكنولوجيا البنوك والمدفوعات الإلكترونية" },
                "سويدي": { sym: "SWDY", name: "السويدي إلكتريك" },
                "swdy": { sym: "SWDY", name: "السويدي إلكتريك" },
                "طلعت مصطفى": { sym: "TMGH", name: "مجموعة طلعت مصطفى القابضة" },
                "tmgh": { sym: "TMGH", name: "مجموعة طلعت مصطفى القابضة" },
                "بلتون": { sym: "BTFH", name: "بلتون القابضة" },
                "btfh": { sym: "BTFH", name: "بلتون القابضة" },
                "حديد عز": { sym: "ESRS", name: "عز للدخيلة للحديد والصلب" },
                "esrs": { sym: "ESRS", name: "عز للدخيلة للحديد والصلب" },
                "إعمار": { sym: "EMFD", name: "إعمار مصر للتنمية" },
                "emfd": { sym: "EMFD", name: "إعمار مصر للتنمية" },
                "أموك": { sym: "AMOC", name: "الإسكندرية للزيوت المعدنية (أموك)" },
                "amoc": { sym: "AMOC", name: "الإسكندرية للزيوت المعدنية (أموك)" },
                "مصر للألومنيوم": { sym: "EGAL", name: "مصر للألومنيوم" },
                "egal": { sym: "EGAL", name: "مصر للألومنيوم" },
                "سيدي كرير": { sym: "SKPC", name: "سيدي كرير للبتروكيماويات" },
                "سيدبيك": { sym: "SKPC", name: "سيدي كرير للبتروكيماويات" },
                "skpc": { sym: "SKPC", name: "سيدي كرير للبتروكيماويات" },
                "إي فاينانس": { sym: "EFIH", name: "إي فاينانس للاستثمارات المالية والرقمية" },
                "اي فاينانس": { sym: "EFIH", name: "إي فاينانس للاستثمارات المالية والرقمية" },
                "efih": { sym: "EFIH", name: "إي فاينانس للاستثمارات المالية والرقمية" },
                "مدينة مصر": { sym: "MASR", name: "مدينة مصر للإسكان والتعمير" },
                "مدينة نصر": { sym: "MASR", name: "مدينة مصر للإسكان والتعمير" },
                "masr": { sym: "MASR", name: "مدينة مصر للإسكان والتعمير" },
                "بالم هيلز": { sym: "PHDC", name: "بالم هيلز للتعمير" },
                "phdc": { sym: "PHDC", name: "بالم هيلز للتعمير" },
                "جهينة": { sym: "JUFO", name: "جهينة للصناعات الغذائية" },
                "jufo": { sym: "JUFO", name: "جهينة للصناعات الغذائية" },
                "دومتي": { sym: "DOMT", name: "الصناعات الغذائية العربية (دومتي)" },
                "domt": { sym: "DOMT", name: "الصناعات الغذائية العربية (دومتي)" },
                "كليوباترا": { sym: "CLHO", name: "مجموعة مستشفيات كليوباترا" },
                "clho": { sym: "CLHO", name: "مجموعة مستشفيات كليوباترا" },
                "أبو ظبي": { sym: "ADIB", name: "مصرف أبو ظبي الإسلامي - مصر" },
                "ابو ظبي": { sym: "ADIB", name: "مصرف أبو ظبي الإسلامي - مصر" },
                "adib": { sym: "ADIB", name: "مصرف أبو ظبي الإسلامي - مصر" },
                "قناة السويس": { sym: "CANA", name: "بنك قناة السويس" },
                "cana": { sym: "CANA", name: "بنك قناة السويس" },
                "سوديك": { sym: "OCDI", name: "السادس من أكتوبر للتنمية والاستثمار (سوديك)" },
                "ocdi": { sym: "OCDI", name: "السادس من أكتوبر للتنمية والاستثمار (سوديك)" },
                "ابن سينا": { sym: "ISPH", name: "ابن سينا فارما" },
                "isph": { sym: "ISPH", name: "ابن سينا فارما" },
            };

            const findSymbolInText = (msgText: string) => {
                if (!msgText) return null;
                const msgLower = msgText.toLowerCase();
                const msgWords = msgText.trim().split(/[\s,.-]+/).map((w: string) => w.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()).filter((w: string) => w.length >= 2);

                // 1. Direct exact symbol lookup
                for (const word of msgWords) {
                    const exact = preloadedExactStocks.find(s => s.symbol === word);
                    if (exact) return { sym: exact.symbol, name: exact.name };
                }

                // 2. Arabic & English Common Stock Alias Mapping
                for (const [alias, info] of Object.entries(stockAliases)) {
                    if (msgLower.includes(alias)) return { sym: info.sym, name: info.name };
                }

                return null;
            };

            // Analyze CURRENT message first
            let found = findSymbolInText(textMessage);
            if (found) {
                targetSymbol = found.sym;
                targetStockName = found.name;
            }

            // If not found in current message, analyze HISTORY from NEWEST to OLDEST
            if (!targetSymbol) {
                for (let i = formattedHistory.length - 1; i >= 0; i--) {
                    found = findSymbolInText(formattedHistory[i].content);
                    if (found) {
                        targetSymbol = found.sym;
                        targetStockName = found.name;
                        break;
                    }
                }
            }

            // 3. Fallback for Niche / Unpopular Stocks (Dynamic DB Fuzzy Search across ALL EGX stocks)
            if (!targetSymbol) {
                const textWords = textMessage.trim().split(/[\s,.-]+/).filter((w: string) => w.length >= 3);
                const historyWords = formattedHistory.map((h: any) => h.content).join(" ").split(/[\s,.-]+/).filter((w: string) => w.length >= 3);
                const candidateWords = Array.from(new Set([...textWords, ...historyWords])).slice(0, 5);

                if (candidateWords.length > 0) {
                    const orFilters = candidateWords.map((w: string) => `name.ilike.%${w}%,symbol.ilike.%${w}%`).join(",");
                    const { data: fuzzyMatches } = await supabase
                        .from("stocks")
                        .select("symbol, name")
                        .or(orFilters)
                        .limit(5);

                    if (fuzzyMatches && fuzzyMatches.length > 0) {
                        // Priority given to exact textMessage match if any
                        const textLower = textMessage.toLowerCase();
                        const best = fuzzyMatches.find((s: any) => 
                            textLower.includes(s.symbol.toLowerCase()) || 
                            (s.name && textLower.includes(s.name.toLowerCase().split(" ")[0]))
                        ) || fuzzyMatches[0];

                        targetSymbol = best.symbol;
                        targetStockName = best.name;
                    }
                }
            }

            if (!targetSymbol) {
                const { data: matchedStocks } = await supabase.from("stocks").select("symbol, name").limit(300);
                const allStocks = matchedStocks || [];

                const findSymbolInAllStocks = (msgText: string) => {
                    if (!msgText) return null;
                    const msgLower = msgText.toLowerCase();

                    for (const s of allStocks) {
                        const sym = (s.symbol || "").trim();
                        if (sym.length >= 3) {
                            const wordRegex = new RegExp(`\\b${sym}\\b`, "i");
                            if (wordRegex.test(msgLower)) return { sym: s.symbol, name: s.name };
                        }
                    }

                    return null;
                };

                found = findSymbolInAllStocks(textMessage);
                if (found) {
                    targetSymbol = found.sym;
                    targetStockName = found.name;
                }

                if (!targetSymbol) {
                    for (let i = formattedHistory.length - 1; i >= 0; i--) {
                        found = findSymbolInAllStocks(formattedHistory[i].content);
                        if (found) {
                            targetSymbol = found.sym;
                            targetStockName = found.name;
                            break;
                        }
                    }
                }
            }

            const combinedText = (textMessage + " " + formattedHistory.map((h: any) => h.content).join(" ")).toLowerCase();


            // Dynamic Smart Buttons based on context
            if (targetSymbol) {
                // Stock-specific buttons (real trader questions)
                const compareSymbol = targetSymbol === "COMI" ? "ABUK" : "COMI";
                dynamicSuggestedButtons = [
                    `قارن بـ ${compareSymbol}`,
                    `هل في تجميع مؤسسي على ${targetSymbol}؟`,
                    `قد إيه بعيد عن الحد اليومي؟`
                ];

                // 4. Fetch Exact Real-Time Database Data for targetSymbol from Supabase
                // Determine if user wants historical data
                const wantsHistory = combinedText.includes("شهر") || combinedText.includes("تاريخ") || combinedText.includes("اكسيل") || combinedText.includes("جدول") || combinedText.includes("ايام") || combinedText.includes("اسبوع") || combinedText.includes("سابق");
                const limitCount = wantsHistory ? 30 : 1;

                const [priceRes, techRes, scanRes, newsRes] = await Promise.all([
                    supabase.from("stock_prices").select("*").eq("symbol", targetSymbol).order("date", { ascending: false }).limit(limitCount),
                    supabase.from("stock_technical_indicators").select("*").eq("symbol", targetSymbol).order("date", { ascending: false }).limit(limitCount),
                    supabase.from("scan_results").select("*").eq("symbol", targetSymbol).order("created_at", { ascending: false }).limit(1).maybeSingle(),
                    supabase.from("stock_news_sentiment").select("*").eq("symbol", targetSymbol).order("date", { ascending: false }).limit(3)
                ]);

                const priceDataArray = priceRes.data || [];
                const techDataArray = techRes.data || [];
                const scanData = scanRes.data;
                const stockNews = newsRes.data || [];

                const latestPrice = priceDataArray[0];
                const latestTech = techDataArray[0];

                if (latestPrice || latestTech || scanData || stockNews.length > 0) {
                    systemPrompt += `\n\n=== 🔴 REAL-TIME SUPABASE DATABASE DATA FOR STOCK: ${targetSymbol} (${targetStockName}) ===\n`;
                    systemPrompt += `CRITICAL INSTRUCTION: You MUST use the exact real-time live numbers provided below.\n`;
                    systemPrompt += `- Stock Symbol: ${targetSymbol}\n`;
                    systemPrompt += `- Official Stock Name: ${targetStockName}\n`;
                    
                    if (limitCount > 1 && priceDataArray.length > 0 && userIntent !== "News") {
                        systemPrompt += `\n[Historical Price Data - Last ${priceDataArray.length} Days]:\n`;
                        systemPrompt += `Date | Close | High | Low | Volume\n`;
                        priceDataArray.forEach((p: any) => {
                            systemPrompt += `${p.date} | ${p.close_price} | ${p.high_price} | ${p.low_price} | ${p.volume}\n`;
                        });
                    } else if (latestPrice && userIntent !== "News") {
                        systemPrompt += `- Latest Close Price: ${latestPrice.close_price} (Date: ${latestPrice.date})\n`;
                        systemPrompt += `- Trading Volume: ${latestPrice.volume}\n`;
                    }

                    if (latestTech && userIntent !== "News") {
                        systemPrompt += `\n[Technical Indicators]:\n`;
                        systemPrompt += `- RSI (14): ${latestTech.rsi_14}\n`;
                        systemPrompt += `- MACD: ${latestTech.macd} (Signal: ${latestTech.macd_signal})\n`;
                        systemPrompt += `- Bollinger Bands: Upper ${latestTech.bollinger_upper}, Lower ${latestTech.bollinger_lower}\n`;
                        systemPrompt += `- CMF (Chaikin Money Flow - Tagmaee/Tasreef Indicator): ${latestTech.cmf}\n`;
                    }

                    if (scanData && userIntent !== "News") {
                        systemPrompt += `\n[AI Technical Scanner Signal]:\n`;
                        systemPrompt += `- Signal: ${scanData.signal}\n`;
                        if (scanData.precision) systemPrompt += `- Precision Score: ${scanData.precision}%\n`;
                    }
                    
                    if (stockNews.length > 0 && (userIntent === "News" || userIntent === "Count" || userIntent === "Analyze" || userIntent === "General")) {
                        systemPrompt += `\n[Latest News & Sentiment]:\n`;
                        stockNews.forEach((n: any) => {
                            const score = n.sentiment_score || 0;
                            const sentimentText = score > 0.1 ? "إيجابي" : score < -0.1 ? "سلبي" : "حيادي";
                            const headlineStr = Array.isArray(n.headlines) ? n.headlines[0] : n.headlines;
                            systemPrompt += `- Date: ${n.date} | Sentiment: ${sentimentText} (${score}) | Count: ${n.news_count} | Headline: ${headlineStr}\n`;
                        });
                    }

                    systemPrompt += `\n=== END OF DATA ===\n`;
                }
            } else if (combinedText.includes("قطاع") || combinedText.includes("sector") || combinedText.includes("بنوك") || combinedText.includes("أسمدة")) {
                // Sector-related buttons
                dynamicSuggestedButtons = [
                    "البنوك ماشية إزاي؟",
                    "مين الأقوى في القطاع؟",
                    "القطاع طالع ولا نازل؟"
                ];
            } else if (combinedText.includes("egx30") || combinedText.includes("السوق") || combinedText.includes("market")) {
                // Market-wide buttons
                dynamicSuggestedButtons = [
                    "EGX30 حالته إيه؟",
                    "في أخبار مؤثرة النهارده؟",
                    "الدولار عامل إيه؟",
                    "أقوى 5 أسهم اليوم"
                ];
            } else {
                // Default general buttons
                dynamicSuggestedButtons = [
                    "حلل لي ABUK",
                    "أقوى الأسهم النهارده",
                    "البنوك حالتها إيه؟",
                    "مقارنة أسهم البورصة"
                ];
            }
            // 4.5 Fetch General Market Status (market_cache) & Top Market News (stock_news_sentiment)
            // Skip fetching market/news context if Intent is purely Portfolio or Compare
            if (userIntent !== "Portfolio" && userIntent !== "Compare") {
                const [marketCacheRes, topNewsRes] = await Promise.all([
                    supabase.from("market_cache").select("payload, computed_at").eq("cache_key", "market_status_Egypt").maybeSingle(),
                    supabase.from("stock_news_sentiment").select("*").gt("news_count", 0).order("date", { ascending: false }).limit(5)
                ]);

                if (marketCacheRes?.data?.payload && userIntent !== "News") {
                    const mPayload = marketCacheRes.data.payload;
                    systemPrompt += `\n\n=== 🌐 REAL-TIME EGX MARKET STATUS & MACRO ECONOMY DATA ===\n`;
                    systemPrompt += `- Market Status/Regime: ${JSON.stringify(mPayload.market_status || mPayload.regime || mPayload.status || "مستقر/متوازن")}\n`;
                    if (mPayload.egx30_summary || mPayload.summary || mPayload.market_summary) {
                        systemPrompt += `- EGX30 & Market Overview: ${JSON.stringify(mPayload.egx30_summary || mPayload.summary || mPayload.market_summary)}\n`;
                    }
                    if (mPayload.sectors || mPayload.sector_summary) {
                        systemPrompt += `- Sector Performance: ${JSON.stringify(mPayload.sectors || mPayload.sector_summary)}\n`;
                    }
                    systemPrompt += `=== END OF MARKET STATUS ===\n`;
                }

                if (topNewsRes?.data && topNewsRes.data.length > 0 && (userIntent === "News" || userIntent === "Count" || userIntent === "Analyze" || userIntent === "General")) {
                    systemPrompt += `\n=== 📰 LATEST TOP EGX MARKET NEWS & HEADLINES ===\n`;
                    topNewsRes.data.forEach((n: any) => {
                        const score = n.sentiment_score || 0;
                        const sentimentText = score > 0.1 ? "إيجابي 🟢" : score < -0.1 ? "سلبي 🔴" : "حيادي ⚪";
                        const headlineStr = Array.isArray(n.headlines) ? (n.headlines[0] || n.symbol) : (n.headlines || n.symbol);
                        systemPrompt += `- [${n.symbol}] (${n.date}): ${headlineStr} (مؤشر التفاؤل: ${sentimentText})\n`;
                    });
                    systemPrompt += `=== END OF TOP MARKET NEWS ===\n`;
                }
            }
        } catch (stockErr) {
            console.error("Failed to query stock DB data for prompt:", stockErr);
        }



        // 5. Build Messages Array & Pre-process Vision OCR
        let userContent: any;
        if (hasImages) {
            // Point 3: Tesseract.js Ultra-Fast Node.js OCR Pre-Processing (Local only, bypassed on Vercel serverless to prevent worker-script 129 exit crash)
            let ocrExtractedText = "";
            if (!process.env.VERCEL) {
                try {
                    const ocrPromise = (async () => {
                        const tesseract = await import("tesseract.js");
                        const firstImg = imageList[0];
                        if (firstImg && typeof firstImg === "string") {
                            const result = await tesseract.recognize(firstImg, "eng");
                            return result?.data?.text?.trim() || "";
                        }
                        return "";
                    })();

                    const timeoutCap = new Promise<string>((resolve) => setTimeout(() => resolve(""), 3000));
                    ocrExtractedText = await Promise.race([ocrPromise, timeoutCap]);
                    if (ocrExtractedText) {
                        console.log("Ultra-fast Tesseract OCR text length:", ocrExtractedText.length);
                    }
                } catch (tessErr: any) {
                    console.warn("Tesseract.js OCR pre-processing skipped:", tessErr.message || tessErr);
                }
            }

            // Point 4: Red-Flag Detection for Duplicate Portfolio Totals across images in session
            let duplicateTotalWarning = "";
            try {
                const userTotals = portfolioTotalsByUser.get(userId) || new Set<string>();

                // Check text matches in history or OCR
                const numberMatches = (formattedHistory.map((h: any) => h.content).join(" ") + " " + ocrExtractedText)
                    .match(/(?:إجمالي|إجمالي المحفظة|القيمة الكلية|total)[:\s]*([0-9.,]+)/gi);

                if (numberMatches) {
                    for (const match of numberMatches) {
                        const cleanNum = match.replace(/[^0-9.]/g, "");
                        if (cleanNum && cleanNum.length >= 3) {
                            if (userTotals.has(cleanNum)) {
                                duplicateTotalWarning = "\n⚠️ تنبيه داخلي: تم اكتشاف تكرار لـ إجمالي المحفظة من صور سابقة، تأكد من استخراج البيانات بدقة من الصورة الحالية فقط دون نسخ الصورة السابقة.";
                                break;
                            }
                            userTotals.add(cleanNum);
                        }
                    }
                    portfolioTotalsByUser.set(userId, userTotals);
                }
            } catch (dupErr) {
                console.warn("Duplicate total check skipped:", dupErr);
            }

            systemPrompt = `أنت المساعد المالي الخبير والمحلل الفني الأول للبورصة المصرية على منصة EGX Bots.
مهمتك هي قراءة شاشة المحفظة المرفقة، استخراج الأسهم بدقة، وتقديم **تقييم مالي وفني ذكي ومبسط للمحفظة**.

📋 **قواعد التحليل والعرض الإلزامية:**
1. **استخراج البيانات:** استخرج رموز الأسهم (Symbols) ونسب الربح/الخسارة أو الأسعار المكتوبة من الصورة بدقة دون اختراع أسهم غير موجودة.
2. **تقييم أداء المحفظة:**
   - حدد الأسهم الأكثر ربحية والأسهم التي تشهد ضغطاً أو تراجعاً.
   - قيم مدى تنوع المحفظة وتوازن المخاطر بها بأسلوب البورصجية الذكي.
3. **نصيحة المحلل:** قدم ملخصاً تنفيذياً كودياً يقترح التعامل مع المحفظة (مثل: تفعيل وقف الخسارة للأسهم الهابطة، أو جني أرباح جزئي، أو متابعة السيولة).
4. **التنسيق:** استخدم التنسيق المنظم ذو الأيقونات والأسطر الواضحة بدون جداول معقدة.
5. **اللغة:** الإجابة باللغة العربية الاحترافية البسيطة.`;

            const promptText = `اقرأ المحفظة المرفقة وحللها ذكياً: استخرج الأسهم، وقدم تقييماً كاملاً للأداء والمخاطر.
${ocrExtractedText ? `\n[بيانات قراءة الحروف التلقائية]:\n${ocrExtractedText.substring(0, 1000)}\n` : ""}
${duplicateTotalWarning}
${textMessage.trim() ? `ملاحظة المستخدم: ${textMessage}` : ""}`;

            // NVIDIA NIM vision models accept at most 1 image per request payload
            userContent = [
                { type: "text", text: promptText },
                {
                    type: "image_url",
                    image_url: { url: imageList[0] }
                }
            ];
        } else {
            userContent = textMessage;
        }

        const aiMessages = [
            { role: "system", content: systemPrompt },
            ...(hasImages ? [] : formattedHistory),
            { role: "user", content: userContent }
        ];

        // 6. Call API using keys from environment only
        let rawText = "";
        let success = false;

        for (let k = 0; k < keysToTry.length && !success; k++) {
            const currentApiKey = keysToTry[k];
            
            // For images: Try 11B vision model first for high speed and availability, fallback to 90B
            // For text: Try requested model first, fallback to 8B for speed
            let modelsToTryForThisKey: string[];
            if (hasImages) {
                modelsToTryForThisKey = NVIDIA_VISION_MODELS; // Try 11B vision model first for speed, then 90B
            } else {
                modelsToTryForThisKey = (modelToUse !== "meta/llama-3.1-8b-instruct")
                    ? [modelToUse, "meta/llama-3.1-8b-instruct"]
                    : [modelToUse];
            }

            for (let m = 0; m < modelsToTryForThisKey.length && !success; m++) {
                const currentModelName = modelsToTryForThisKey[m];
                try {
                    const response = await fetch(`${apiUrl}/chat/completions`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${currentApiKey}`,
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                            "Accept": "application/json",
                            "HTTP-Referer": "https://agentrouter.org",
                            "Origin": "https://agentrouter.org",
                            "X-Title": "EGX Bots"
                        },
                        body: JSON.stringify({
                            model: currentModelName,
                            messages: aiMessages,
                            temperature: hasImages ? 0.01 : 0.7,  // Very low for deterministic image analysis
                            max_tokens: hasImages ? 1024 : 512,
                            stream: false,
                        }),
                        signal: AbortSignal.timeout(hasImages ? 35000 : (m === 0 ? 22000 : 8000)),  // 22s for first attempt, 8s for fallback

                    });

                    if (response.ok) {
                        rawText = await response.text();
                        success = true;
                        console.log(`✅ Success with model: ${currentModelName}`);
                    } else {
                        const errText = await response.text();
                        console.warn(`AI API (Key #${k + 1}, Model: ${currentModelName}) status ${response.status}:`, errText.substring(0, 100));
                    }
                } catch (fetchErr: any) {
                    console.error(`AI API (Key #${k + 1}, Model: ${currentModelName}) timeout/error:`, fetchErr.message || fetchErr);
                }
            }
        }


        if (!success || !rawText.trim()) {
            const fallbackText = hasImages
                ? `⚠️ **صعوبة قراءة الصورة حالياً**\n\nالطريقتان الأسرع:\n1. 📝 اكتب رموز الأسهم يدوياً — مثلاً: "حلل ABUK و COMI"\n2. 📸 أرسل صورة أوضح لشاشة المحفظة\n\nأو افتح الماسح الذكي 📊 لعرض البيانات مباشرة.`
                : "تتوفر إشارات الذكاء الاصطناعي المباشرة للأسهم عبر قسم الماسح الذكي 📊. يمكنك استعراض أسعار الإغلاق ومؤشرات RSI والتوقعات بفتح صفحة الماسح الفني.";

            return NextResponse.json({
                reply: fallbackText,
                remaining_quota: isUnlimited ? 999 : Math.max(0, 15 - (limitData?.chat_count || 0)),
                suggested_buttons: [] // Hide smart buttons on fallback error
            });
        }


        let data;
        try {
            data = JSON.parse(rawText);
        } catch (parseError) {
            console.error("Failed to parse JSON from provider. Raw response:", rawText);
            return NextResponse.json({ detail: "AI provider returned an invalid format. Please check your BASE URL." }, { status: 502 });
        }
        
        let replyText = data.choices?.[0]?.message?.content || "عذراً، لم أتمكن من معالجة طلبك.";
        console.log("NVIDIA RAW RESPONSE:", replyText);

        // DB-First Vision Enforcer: Match extracted symbols from Vision reply with Supabase real data
        if (hasImages && replyText) {
            try {
                const extractedSymbols = Array.from(new Set([
                    ...(replyText.match(/\b[A-Za-z]{4}\b/g) || []).map((s: any) => s.toUpperCase())
                ])).slice(0, 5);

                if (extractedSymbols.length > 0) {
                    const [pricesRes, stocksRes, techRes] = await Promise.all([
                        supabase.from("stock_prices").select("symbol, date, close, volume").in("symbol", extractedSymbols).order("date", { ascending: false }).limit(extractedSymbols.length),
                        supabase.from("stocks").select("symbol, name").in("symbol", extractedSymbols),
                        supabase.from("stock_technical_indicators").select("symbol, change_pct").in("symbol", extractedSymbols).order("date", { ascending: false }).limit(extractedSymbols.length)
                    ]);

                    const prices = pricesRes.data || [];
                    const stocks = stocksRes.data || [];
                    const techs = techRes.data || [];

                    if (prices.length > 0) {
                        const verifiedData = prices.map((p: any) => {
                            const sInfo = stocks.find((s: any) => s.symbol === p.symbol);
                            const tInfo = techs.find((t: any) => t.symbol === p.symbol);
                            const cleanName = (sInfo && sInfo.name && sInfo.name !== "null") ? ` (${sInfo.name})` : "";
                            const changeVal = tInfo && typeof tInfo.change_pct === "number" ? tInfo.change_pct : null;
                            const changeStr = changeVal !== null ? `, التغير اليومي: ${changeVal >= 0 ? "+" : ""}${changeVal.toFixed(2)}%` : "";
                            const priceStr = typeof p.close === "number" ? p.close.toFixed(2) : p.close;
                            return `• **${p.symbol}**${cleanName}: السعر الأخير = ${priceStr} ج.م${changeStr}`;
                        }).join("\n");
                        replyText += `\n\n🟢 **بيانات البورصة اللحظية للأسهم المكتشفة:**\n${verifiedData}`;
                    }
                }
            } catch (dbErr) {
                console.warn("DB Vision Symbol Lookup error:", dbErr);
            }
        }

        if (hasImages && replyText) {
            // Clean up OCR/Vision artifacts and English captions
            replyText = replyText
                .replace(/\[Caption:[^\]]+\]/gi, "")  // Remove [Caption: ...]
                .replace(/\[Image:[^\]]+\]/gi, "")   // Remove [Image: ...]
                .replace(/The image (shows|depicts|displays|contains)/gi, "")  // Remove English descriptions
                .replace(/This screenshot (shows|displays|contains)/gi, "")
                .replace(/This is a screenshot of/gi, "")
                .trim();

            // Advanced validation: Check if response is mostly English or nonsensical
            const arabicCharCount = (replyText.match(/[\u0600-\u06FF]/g) || []).length;
            const totalCharCount = replyText.replace(/\s/g, "").length;
            const arabicRatio = totalCharCount > 0 ? arabicCharCount / totalCharCount : 0;

            // If response is < 20% Arabic or too short, provide fallback
            if (arabicRatio < 0.2 || replyText.length < 30 || /^([a-zA-Z0-9\s.,\-\[\]:_"']+)$/.test(replyText)) {
                replyText = `⚠️ **تنبيه:** نموذج Vision واجه صعوبة في قراءة الصورة بدقة.

📋 **ما يمكنني مساعدتك به:**
1. أرسل الصورة مرة أخرى بجودة أعلى
2. أو اكتب رموز الأسهم الظاهرة في الصورة يدوياً، وسأحللها لك بدقة
3. أو استخدم الماسح الذكي 📊 للحصول على تحليل فوري للأسهم

💡 **نصيحة:** تأكد من وضوح النصوص في الصورة قبل الإرسال.`;
            }

            // Remove any remaining long English sentences (>30 consecutive Latin chars)
            replyText = replyText.replace(/[a-zA-Z]{30,}/g, "[نص غير مقروء]");
        }

        // Apply Output Filtering Layer
        replyText = filterOutput(replyText);

        // 7. Update Limits
        if (limitData) {
            await supabase
                .from("ai_chatbot_limits")
                .update({ chat_count: limitData.chat_count + 1 })
                .eq("user_id", userId)
                .eq("date", today);
        } else {
            await supabase
                .from("ai_chatbot_limits")
                .insert({ user_id: userId, date: today, chat_count: 1 });
        }

        const newCount = (limitData?.chat_count || 0) + 1;

        // 8. Log Interaction & Manage Multi-Session Threads
        let activeSessionId = inputSessionId;
        try {
            if (!activeSessionId) {
                const sessionTitle = textMessage.trim() 
                    ? textMessage.trim().substring(0, 32) + (textMessage.length > 32 ? "..." : "")
                    : (hasImages ? "تحليل صورة محفظة" : "محادثة جديدة");

                const { data: newSession } = await supabase
                    .from("ai_chat_sessions")
                    .insert({
                        user_id: userId,
                        title: sessionTitle,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .select("id")
                    .single();

                if (newSession) {
                    activeSessionId = newSession.id;
                }
            } else {
                await supabase
                    .from("ai_chat_sessions")
                    .update({ updated_at: new Date().toISOString() })
                    .eq("id", activeSessionId)
                    .eq("user_id", userId);
            }

            if (activeSessionId) {
                await supabase.from("ai_chat_messages").insert([
                    {
                        session_id: activeSessionId,
                        user_id: userId,
                        role: "user",
                        content: textMessage || (hasImages ? "📷 [تحليل صورة محفظة]" : ""),
                        image_url: imageList[0] || null
                    },
                    {
                        session_id: activeSessionId,
                        user_id: userId,
                        role: "assistant",
                        content: replyText
                    }
                ]);
            }

            // Also log to legacy logs
            await supabase
                .from("ai_chatbot_logs")
                .insert({
                    user_id: userId,
                    user_name: userName,
                    message: hasImages ? `[📷 ${imageList.length} Images] ${textMessage}` : textMessage,
                    reply: replyText
                });
        } catch (logErr) {
            console.error("Failed to save multi-session chat message:", logErr);
        }

        // 9. Forward to Telegram Support
        const botToken = process.env.SUPPORT_BOT_TOKEN || process.env.ARTORO_AI_BOT || process.env.TELEGRAM_BOT_TOKEN;
        const telegramChatId = process.env.TELEGRAM_CHAT_ID || "-1002083067817_153"; // Fallback to central topic
        const adminTelegramId = process.env.ADMIN_TELEGRAM_CHAT_ID || "5149631436";
        const forwardFullChat = process.env.FORWARD_AI_CHAT_TEXT === "true";
        
        if (botToken) {
            let chatIdStr = telegramChatId;
            let threadId: string | undefined = undefined;
            if (chatIdStr.includes("_")) {
                [chatIdStr, threadId] = chatIdStr.split("_");
            }

            const telegramMessage = forwardFullChat
                ? `🤖 *AI Chatbot Interaction*\n\n` +
                  `👤 *User:* ${userName}\n` +
                  `${hasImages ? `📷 *[${imageList.length} Images Attached]*\n` : ''}` +
                  `✉️ *Message:* ${textMessage}\n\n` +
                  `💬 *Bot Reply:* ${replyText.substring(0, 1000)}${replyText.length > 1000 ? '...' : ''}\n\n` +
                  `📊 *Daily Quota:* ${isUnlimited ? 'Unlimited' : `${newCount}/15`}`
                : `🤖 *AI Chatbot Interaction*\n\n` +
                  `👤 *User:* ${userName}\n` +
                  `${hasImages ? `📷 *[${imageList.length} Images Attached]*\n` : ''}` +
                  `📊 *Daily Quota:* ${isUnlimited ? 'Unlimited' : `${newCount}/15`}\n` +
                  `🔒 *Content:* ${hasImages ? 'Image analysis completed' : 'Text analysis completed'}`;

            const sendTelegram = (targetChatId: string, targetThreadId?: string) => {
                const payload: any = {
                    chat_id: targetChatId,
                    text: telegramMessage,
                    parse_mode: "Markdown"
                };
                if (targetThreadId) {
                    payload.message_thread_id = parseInt(targetThreadId, 10);
                }
                fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                }).catch(e => console.error("Telegram Forwarding Failed:", e));
            };

            // Send to supergroup topic and direct admin chat
            sendTelegram(chatIdStr, threadId);
            if (chatIdStr !== adminTelegramId) {
                sendTelegram(adminTelegramId);
            }
        }

        return NextResponse.json({
            reply: replyText,
            session_id: activeSessionId,
            remaining_quota: isUnlimited ? 999 : Math.max(0, 15 - newCount),
            suggested_buttons: dynamicSuggestedButtons
        });


    } catch (e: any) {
        console.error("AI Chat Error:", e);
        return NextResponse.json({ detail: "Internal Server Error", error: e.message || String(e) }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const authClient = createSupabaseServerClient(req);
        const supabase = getSupabaseClient();

        const { data: { user } } = await authClient.auth.getUser();
        if (!user) {
            return NextResponse.json({ history: [], sessions: [], remaining_quota: 4 });
        }

        const userId = user.id;
        const userEmail = user.email || "";
        const isUnlimited = ["weeessd57@gmail.com", "user@gmail.com", "weeasd57@gmail.com"].includes(userEmail.toLowerCase());

        const url = new URL(req.url);
        const action = url.searchParams.get("action");
        const sessionId = url.searchParams.get("session_id");

        // Fetch user's limit for today
        const today = new Date().toISOString().split("T")[0];
        const { data: limitData } = await supabase
            .from("ai_chatbot_limits")
            .select("chat_count")
            .eq("user_id", userId)
            .eq("date", today)
            .maybeSingle();

        const used = limitData?.chat_count || 0;
        const remaining_quota = isUnlimited ? 999 : Math.max(0, 15 - used);

        // Fetch list of sessions
        if (action === "sessions") {
            const { data: sessions } = await supabase
                .from("ai_chat_sessions")
                .select("id, title, created_at, updated_at")
                .eq("user_id", userId)
                .order("updated_at", { ascending: false });

            return NextResponse.json({ sessions: sessions || [], remaining_quota });
        }

        // Fetch messages for a specific session
        if (sessionId) {
            const { data: messages } = await supabase
                .from("ai_chat_messages")
                .select("id, role, content, image_url, created_at")
                .eq("session_id", sessionId)
                .eq("user_id", userId)
                .order("created_at", { ascending: true });

            const formatted = (messages || []).map((m: any) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                imageUrl: m.image_url || undefined,
                timestamp: new Date(m.created_at).getTime()
            }));

            return NextResponse.json({ history: formatted, remaining_quota });
        }

        // Default fallback to past logs
        const { data: logs } = await supabase
            .from("ai_chatbot_logs")
            .select("id, message, reply, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: true })
            .limit(50);

        const history: any[] = [];
        if (logs && logs.length > 0) {
            logs.forEach((log: any) => {
                const ts = new Date(log.created_at).getTime();
                if (log.message) {
                    history.push({ role: "user", content: log.message, timestamp: ts });
                }
                if (log.reply) {
                    history.push({ role: "assistant", content: log.reply, timestamp: ts + 100 });
                }
            });
        }

        return NextResponse.json({ history, remaining_quota });
    } catch (e: any) {
        return NextResponse.json({ history: [], sessions: [], remaining_quota: 4 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const authClient = createSupabaseServerClient(req);
        const supabase = getSupabaseClient();

        const { data: { user } } = await authClient.auth.getUser();
        if (!user) {
            return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(req.url);
        const sessionId = url.searchParams.get("session_id");

        if (!sessionId) {
            return NextResponse.json({ detail: "Session ID required" }, { status: 400 });
        }

        await supabase
            .from("ai_chat_sessions")
            .delete()
            .eq("id", sessionId)
            .eq("user_id", user.id);

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ detail: e.message }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    try {
        const authClient = createSupabaseServerClient(req);
        const supabase = getSupabaseClient();

        const { data: { user } } = await authClient.auth.getUser();
        if (!user) {
            return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
        }

        const { session_id, title } = await req.json();
        if (!session_id || !title) {
            return NextResponse.json({ detail: "session_id and title required" }, { status: 400 });
        }

        await supabase
            .from("ai_chat_sessions")
            .update({ title, updated_at: new Date().toISOString() })
            .eq("id", session_id)
            .eq("user_id", user.id);

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ detail: e.message }, { status: 500 });
    }
}
