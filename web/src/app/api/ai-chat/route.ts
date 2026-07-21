import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;


// Input security filters to prevent jailbreaks, extraction of system prompt, or unauthorized access
const BLOCKED_INPUT_PATTERNS = [
    "system prompt", "ignore previous", "your instructions",
    "developer mode", "jailbreak", "ignore all",
    "admin_secret_key", "api_key", "database", "supabase", "postgres",
    "بينات مستخدم", "كلمة السر", "بيانات سرية", "اختراق", "باسورد",
    "ignore previous instructions", "system instructions", "you must ignore"
];

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

// Vision model configuration - Use NVIDIA free models
const NVIDIA_VISION_MODELS = [
    "meta/llama-3.2-90b-vision-instruct",
    "meta/llama-3.2-11b-vision-instruct",
];

const VISION_MODEL = NVIDIA_VISION_MODELS[0];

export async function POST(req: NextRequest) {
    try {
        const authClient = createSupabaseServerClient(req);
        const supabase = getSupabaseClient(); // Service role client for DB

        // 1. Authenticate user
        const { data: { session }, error: authError } = await authClient.auth.getSession();
        if (authError || !session?.user) {
            return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
        }
        
        const userId = session.user.id;
        const { message, history, image, images, model: userRequestedModel, session_id: inputSessionId } = await req.json();

        
        // Normalize images into array
        const rawImages: string[] = Array.isArray(images) && images.length > 0 
            ? images 
            : (typeof image === "string" && image.startsWith("data:image/") ? [image] : []);
        
        const imageList = rawImages.filter(img => typeof img === "string" && img.startsWith("data:image/"));
        const hasImages = imageList.length > 0;

        // Pre-process image with OCR hints (detect stock symbols via regex)
        let ocrHints = "";
        let ocrExtractedText = "";
        
        if (hasImages) {
            try {
                // Attempt basic pattern matching on common EGX symbols visible in base64 images
                // This helps guide the Vision model to focus on correct data extraction
                const sampleSymbols = ["ABUK", "COMI", "HBCO", "FWRY", "SWDY", "TMGH", "ESRS", "EMFD", "MFPC", "ATQA", "BTFH", "MILS", "CPCI", "TYCN", "UTOP"];
                const mentionedSymbols = sampleSymbols.filter(sym => 
                    (message && message.toUpperCase().includes(sym)) || 
                    imageList.some(img => img.includes(sym))
                );
                if (mentionedSymbols.length > 0) {
                    ocrHints = `\n🔍 **رموز محتملة في الصورة:** ${mentionedSymbols.join(", ")}`;
                }
                
                // Try Tesseract OCR preprocessing (if available)
                try {
                    const { execSync } = require('child_process');
                    const firstImage = imageList[0];
                    
                    // Call Python OCR helper
                    const ocrResult = execSync(
                        `python web/ocr_helper.py "${firstImage}"`,
                        { encoding: 'utf-8', timeout: 10000 }
                    );
                    
                    const ocrData = JSON.parse(ocrResult);
                    if (ocrData.success && ocrData.text) {
                        ocrExtractedText = ocrData.text;
                        console.log("✅ OCR preprocessing successful:", ocrExtractedText.substring(0, 100));
                    }
                } catch (ocrErr) {
                    console.warn("⚠️ OCR preprocessing failed (Tesseract not installed?):", ocrErr.message);
                    // Continue without OCR - Vision model will try alone
                }
            } catch (ocrErr) {
                console.error("OCR hint extraction failed:", ocrErr);
            }
        }

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

        const userName = profile?.display_name || profile?.username || session.user.email || "Unknown User";

        const userEmail = session.user.email || "";
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

        // 4. Fetch Chatbot Settings
        const { data: settings, error: settingsError } = await supabase
            .from("ai_chatbot_settings")
            .select("*")
            .eq("id", 1)
            .single();

        if (settingsError || !settings || !settings.api_key) {
            return NextResponse.json({ detail: "Chatbot is not configured properly." }, { status: 500 });
        }

        let systemPrompt = `أنت المساعد الذكي المالي والمحلل الفني الأول للبورصة المصرية على منصة EGX Bots.

المبادئ والشخصية التي يجب أن تتحدث وتلتزم بها دائماً:

1. 🗣️ **التحدث بلغة البورصة المصرية الحقيقية (لغة البورصجية):**
   - "طالع بقوة" ❌ لا تقل "في اتجاه صعودي"
   - "في تجميع" ❌ لا تقل "زيادة في حجم الشراء"
   - "قافل على قد نفسه" ❌ لا تقل "تداول جانبي"
   - "بياع مسيطر" ❌ لا تقل "ضغط بيعي"
   - "السهم ماشي كويس" ❌ لا تقل "الأداء جيد"
   - "واخد ريحته" ❌ لا تقل "في استراحة"
   - "كاسر المقاومة" ❌ لا تقل "اخترق مستوى المقاومة"

2. 🏷️ **مصطلحات منصة EGX Bots بالعربي (إلزامي):**
   - "ماسح EGX الفني" ❌ لا تقل "Technical Scanner"
   - "شبه ده" ❌ لا تقل "Historical Similarity"
   - "رادار القطاع" ❌ لا تقل "Sector Comparison"
   - "كاشف الحد اليومي" ❌ لا تقل "Circuit Breaker Check"

3. 📊 **عوامل التحليل الإلزامية (أدرجها دائماً بأسلوب حي):**
   
   🔗 **علاقة القطاع ورادار القطاع:**
   مثال: "البنوك كلها بتتحرك مع بعض، وACIB طالع معاهم بـ 1.7%" أو "قطاع الأسمدة تحت الضغط، وABUK نازل معاه"
   
   ⚠️ **القرب من الحد اليومي (كاشف الحد اليومي):**
   مثال: "السهم بعيد 3% بس عن الحد الأعلى، يعني لسه فيه مساحة" أو "قرب من الحد السفلي، حاله حاله"
   
   💧 **السيولة والفوليوم:**
   مثال: "السهم ده من الأسهم قليلة التداول، احذر من الدخول بكمية كبيرة" أو "سيولة عالية، بتدخل وتخرج براحتك"
   
   💵 **حساسية الدولار والغاز:**
   مثال: "القطاع ده مرتبط بسعر الغاز، تابع نشرة البنك المركزي" أو "البنوك بتستفيد من ارتفاع الفايدة"
   
   🏛️ **النمط التاريخي المشابه (شبه ده):**
   مثال: "شبه ده حصل 7 مرات، نجح 5 منهم بمتوسط +8%" أو "النمط ده نادر، آخر مرة كان في مارس 2025"

4. 🎯 **أزرار الاقتراحات الذكية (بناءً على السياق):**
   بدل الأزرار العامة، حط أزرار تعكس أسئلة المتداولين الحقيقية:
   - للأسهم الفردية: [قارن بـ COMI] [هل في تجميع مؤسسي؟] [شبه ده حصل امتى؟] [قد إيه بعيد عن الحد؟]
   - للقطاعات: [البنوك ماشية إزاي؟] [مين الأقوى في القطاع؟] [القطاع طالع ولا نازل؟]
   - للسوق: [EGX30 حالته إيه؟] [في أخبار مؤثرة؟] [الدولار عامل إيه؟]

5. ✅ **التنصل والخاتمة الموحدة (إلزامي):**
   اختم كل رد بالسطر التالي **بالضبط** بدون أي تغيير:
   
   "✅ تحليل EGX Bots مبني على [242 سهم مصري + بيانات تاريخية من 2019] — مش نصيحة استثمار، القرار ليك."
   
   ❌ **ممنوع منعاً باتاً** كتابة جمل روتينية زي:
   - "يرجى ملاحظة أن هذه التحليلات هي قراءة رقمية استرشادية"
   - "هذا التحليل لا يعتبر نصيحة مالية"
   - "استشر مستشارك المالي قبل اتخاذ القرار"

6. 📋 **نموذج رد تحليل سهم محدد (استخدمه فقط عند طلب تحليل سهم):**

📌 [رمز السهم] — [اسم السهم]
────────────────────
🔹 الوضع الفني: [طالع بقوة / قافل على قد نفسه / بياع مسيطر]
🔹 مقارنة بالقطاع (رادار القطاع): [القطاع +X% — السهم بيتحرك معاه / ضد القطاع]
🔹 قرب من الحد اليومي (كاشف الحد اليومي): [X%]
🔹 السيولة: [عالية / متوسطة / ضعيفة] — [تعليق]
🔹 حالة مشابهة (شبه ده): [نجح X من Y مرة، متوسط الربح +Z%]
🔹 توصية الـ AI: [صعودي / متحفظ / سلبي] — ثقة X%

7. 🛠️ **الاستجابة للأوامر المباشرة (إلزامي):**
إذا طلب المستخدم تنسيق بيانات سابقة (مثل: "طلعهم اكسيل"، "جدول"، "ملخص")، يجب عليك تنفيذ طلبه الحرفي وتنسيق البيانات المطلوبة مباشرة في جدول (Markdown Table) بدون استخدام قالب التحليل المذكور أعلاه، وبدون إضافة أي معلومات خارجية.

✅ تحليل EGX Bots مبني على [242 سهم مصري + بيانات تاريخية من 2019] — مش نصيحة استثمار، القرار ليك.
`;

        const defaultTextModel = settings.model || "meta/llama-3.1-8b-instruct";
        let chosenModel = userRequestedModel || defaultTextModel;
        const apiUrl = settings.api_url || "https://integrate.api.nvidia.com/v1";

        if (apiUrl.includes("nvidia.com")) {
            const validNvidiaModels = [
                "meta/llama-3.1-8b-instruct",
                "meta/llama-3.2-11b-vision-instruct",
                "deepseek-ai/deepseek-v4-flash",
                "deepseek-ai/deepseek-v4-pro"
            ];
            if (!validNvidiaModels.includes(chosenModel)) {
                chosenModel = "meta/llama-3.1-8b-instruct";
            }
        }

        const modelToUse = hasImages ? VISION_MODEL : chosenModel;

        // 4.5 Search Database for Stock Data if mentioned in message or history
        const textMessage = message || "";
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

            const { data: matchedStocks } = await supabase.from("stocks").select("symbol, name").limit(150);
            const allStocks = matchedStocks || [];

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

                // 3. Regex Word Boundary Search across all Supabase stocks
                for (const s of allStocks) {
                    const sym = (s.symbol || "").trim();
                    if (sym.length >= 3) {
                        const wordRegex = new RegExp(`\\b${sym}\\b`, "i");
                        if (wordRegex.test(msgLower)) return { sym: s.symbol, name: s.name };
                    }
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

            const combinedText = (textMessage + " " + formattedHistory.map((h: any) => h.content).join(" ")).toLowerCase();


            // Dynamic Smart Buttons based on context
            if (targetSymbol) {
                // Stock-specific buttons (real trader questions)
                const compareSymbol = targetSymbol === "COMI" ? "ABUK" : "COMI";
                dynamicSuggestedButtons = [
                    `قارن بـ ${compareSymbol}`,
                    `هل في تجميع مؤسسي على ${targetSymbol}؟`,
                    `شبه ده حصل امتى في ${targetSymbol}؟`,
                    `قد إيه بعيد عن الحد اليومي؟`
                ];

                // 4. Fetch Exact Real-Time Database Data for targetSymbol from Supabase
                // Determine if user wants historical data
                const wantsHistory = combinedText.includes("شهر") || combinedText.includes("تاريخ") || combinedText.includes("اكسيل") || combinedText.includes("جدول") || combinedText.includes("ايام") || combinedText.includes("اسبوع") || combinedText.includes("سابق");
                const limitCount = wantsHistory ? 30 : 1;

                const [priceRes, techRes, scanRes] = await Promise.all([
                    supabase.from("stock_prices").select("*").eq("symbol", targetSymbol).order("date", { ascending: false }).limit(limitCount),
                    supabase.from("stock_technical_indicators").select("*").eq("symbol", targetSymbol).order("date", { ascending: false }).limit(limitCount),
                    supabase.from("scan_results").select("*").eq("symbol", targetSymbol).order("created_at", { ascending: false }).limit(1).maybeSingle()
                ]);

                const priceDataArray = priceRes.data || [];
                const techDataArray = techRes.data || [];
                const scanData = scanRes.data;

                const latestPrice = priceDataArray[0];
                const latestTech = techDataArray[0];

                if (latestPrice || latestTech || scanData) {
                    systemPrompt += `\n\n=== 🔴 REAL-TIME SUPABASE DATABASE DATA FOR STOCK: ${targetSymbol} (${targetStockName}) ===\n`;
                    systemPrompt += `CRITICAL INSTRUCTION: You MUST use the exact real-time live numbers and current year 2026 provided below. Do NOT output old dates like 2024 or incorrect stock names.\n`;
                    systemPrompt += `- Stock Symbol: ${targetSymbol}\n`;
                    systemPrompt += `- Official Stock Name: ${targetStockName}\n`;
                    
                    if (limitCount > 1 && priceDataArray.length > 0) {
                        systemPrompt += `\n[HISTORICAL DATA FOR LAST ${priceDataArray.length} TRADING DAYS]\n`;
                        systemPrompt += `Date | Close | Volume | Change% | RSI | MACD\n`;
                        for (let i = 0; i < priceDataArray.length; i++) {
                            const p = priceDataArray[i];
                            const t = techDataArray.find((tech: any) => tech.date === p.date) || {};
                            systemPrompt += `${p.date} | ${p.close} | ${p.volume} | ${t.change_pct || 0}% | ${t.rsi_14 || 'N/A'} | ${t.macd || 'N/A'}\n`;
                        }
                        systemPrompt += `[END HISTORICAL DATA]\n\n`;
                    } else if (latestPrice) {
                        systemPrompt += `- Current Live Date: ${latestPrice.date} (Year 2026)\n`;
                        systemPrompt += `- Latest Close Price: EGP ${latestPrice.close} (Open: EGP ${latestPrice.open}, High: EGP ${latestPrice.high}, Low: EGP ${latestPrice.low})\n`;
                        systemPrompt += `- Trading Volume: ${latestPrice.volume}\n`;
                    }
                    
                    if (latestTech && limitCount === 1) {
                        systemPrompt += `- Daily Change %: ${latestTech.change_pct}%\n`;
                        systemPrompt += `- RSI (14): ${latestTech.rsi_14}\n`;
                        systemPrompt += `- MACD: ${latestTech.macd} (Signal: ${latestTech.macd_signal}, Histogram: ${latestTech.macd_histogram})\n`;
                        systemPrompt += `- Moving Averages: SMA20=EGP ${latestTech.sma_20}, SMA50=EGP ${latestTech.sma_50}, SMA200=EGP ${latestTech.sma_200}\n`;
                        systemPrompt += `- Bollinger Bands: Upper=EGP ${latestTech.bb_upper}, Middle=EGP ${latestTech.bb_middle}, Lower=EGP ${latestTech.bb_lower}\n`;
                    }

                    if (scanData) {
                        systemPrompt += `- AI Model Recommendation: ${scanData.signal} (Precision: ${scanData.precision}%)\n`;
                        if (scanData.target_price) systemPrompt += `- AI Target Price: EGP ${scanData.target_price}\n`;
                        if (scanData.stop_loss) systemPrompt += `- AI Stop Loss: EGP ${scanData.stop_loss}\n`;
                    }
                    systemPrompt += `=== END OF DATABASE DATA ===\n`;
                }
            } else if (combinedText.includes("قطاع") || combinedText.includes("sector") || combinedText.includes("بنوك") || combinedText.includes("أسمدة")) {
                // Sector-related buttons
                dynamicSuggestedButtons = [
                    "البنوك ماشية إزاي؟",
                    "مين الأقوى في القطاع؟",
                    "القطاع طالع ولا نازل؟",
                    "رادار القطاع دلوقتي"
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
                    "رادار القطاع"
                ];
            }
        } catch (stockErr) {
            console.error("Failed to query stock DB data for prompt:", stockErr);
        }



        // 5. Build Messages Array
        let userContent: any;
        if (hasImages) {
            systemPrompt = `أنت أداة استخراج نصوص متطورة (OCR) متخصصة في تحليل صور شاشات محافظ الأسهم وتطبيقات التداول.
مهمتك هي قراءة واستخراج الأسهم والمحفظة والأسعار من الصورة المرفقة بدقة بالغة وبدون أي تأليف أو اختراع رموز غير موجودة.

${ocrExtractedText ? `نص مبدئي مستخرج عبر OCR:
${ocrExtractedText}

استخدم هذا النص للتحقق من الأرقام، لكن الأولوية لما تراه في الصورة.` : ""}

القواعد الصارمة:
1. يمنع منعاً باتاً كتابة أو ذكر أي سهم غير موجود صراحةً في الصورة.
2. استخرج كافة الأرقام المقابلة أو المرتبطة بهذا السهم (مثل: سعر السهم الحالي، التغير، عدد الأسهم، متوسط التكلفة، القيمة السوقية، الربح/الخسارة).
3. لا تقم بأي تحليل أو إعطاء نصائح، فقط اقرأ واكتب ما تراه.
4. اعرض البيانات المستخرجة في قائمة نقطية عمودية (Bulleted List) بصيغة (الاسم: القيمة). يمنع تماماً استخدام الجداول (Tables) لمنع أخطاء التنسيق.
5. الإجابة يجب أن تكون باللغة العربية فقط وبشكل مباشر.`;

            const promptText = `استخرج كافة رموز الأسهم وأرقامها من هذه الصورة. اكتب قائمة بكل ما يمكنك قراءته بوضوح باللغة العربية.

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

        // 6. Call NVIDIA API with Smart Multi-Key Failover (Rotation across all available keys)
        const keysToTry = Array.from(new Set([
            settings.api_key,
            process.env.NVIDIA_API_KEY,
            process.env.NVIDIA_SECONDARY_API_KEY,
            "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",
            "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"
        ].filter(Boolean)));

        let rawText = "";
        let success = false;

        for (let k = 0; k < keysToTry.length && !success; k++) {
            const currentApiKey = keysToTry[k];
            
            // For images: Try vision models in priority order (90B -> 11B)
            // For text: Try requested model first, fallback to 8B for speed
            let modelsToTryForThisKey: string[];
            if (hasImages) {
                modelsToTryForThisKey = NVIDIA_VISION_MODELS; // Try 90B first, then 11B
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
                        signal: AbortSignal.timeout(hasImages ? 30000 : (m === 0 ? 5000 : 7000)),  // Longer timeout for 90B model

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
            return NextResponse.json({
                reply: "تتوفر إشارات الذكاء الاصطناعي المباشرة للأسهم عبر قسم الماسح الذكي 📊. يمكنك استعراض أسعار الإغلاق ومؤشرات RSI والتوقعات بفتح صفحة الماسح الفني.",
                remaining_quota: isUnlimited ? 999 : Math.max(0, 15 - (limitData?.chat_count || 0))
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
        
        if (botToken) {
            let chatIdStr = telegramChatId;
            let threadId: string | undefined = undefined;
            if (chatIdStr.includes("_")) {
                [chatIdStr, threadId] = chatIdStr.split("_");
            }

            const telegramMessage = `🤖 *AI Chatbot Interaction*\n\n` +
                                    `👤 *User:* ${userName}\n` +
                                    `${hasImages ? `📷 *[${imageList.length} Images Attached]*\n` : ''}` +
                                    `✉️ *Message:* ${textMessage}\n\n` +
                                    `💬 *Bot Reply:* ${replyText.substring(0, 1000)}${replyText.length > 1000 ? '...' : ''}\n\n` +
                                    `📊 *Daily Quota:* ${isUnlimited ? 'Unlimited' : `${newCount}/15`}`;

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

        const { data: { session } } = await authClient.auth.getSession();
        if (!session?.user) {
            return NextResponse.json({ history: [], sessions: [], remaining_quota: 4 });
        }

        const userId = session.user.id;
        const userEmail = session.user.email || "";
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

        const { data: { session } } = await authClient.auth.getSession();
        if (!session?.user) {
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
            .eq("user_id", session.user.id);

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ detail: e.message }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    try {
        const authClient = createSupabaseServerClient(req);
        const supabase = getSupabaseClient();

        const { data: { session } } = await authClient.auth.getSession();
        if (!session?.user) {
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
            .eq("user_id", session.user.id);

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ detail: e.message }, { status: 500 });
    }
}

