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

// Vision model for image analysis (free on NVIDIA)
const VISION_MODEL = "meta/llama-3.2-11b-vision-instruct";

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

        let systemPrompt = settings.system_prompt || "";
        const defaultTextModel = settings.model || "meta/llama-3.1-8b-instruct";
        let chosenModel = userRequestedModel || defaultTextModel;
        const apiUrl = settings.api_url || "https://integrate.api.nvidia.com/v1";

        // Validate and sanitize model for NVIDIA NIM API to avoid 404 model errors
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



        // Use vision model when image is present, otherwise user chosen model
        const modelToUse = hasImages ? VISION_MODEL : chosenModel;

        // 4.5 Search Database for Stock Data if mentioned in message or history
        const textMessage = message || "";
        try {
            const combinedText = (textMessage + " " + formattedHistory.map((h: any) => h.content).join(" ")).toLowerCase();
            const promptWords = textMessage.trim().split(/[\s,.-]+/).map((w: string) => w.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()).filter((w: string) => w.length >= 2);


            let targetSymbol = "";
            let targetStockName = "";

            // 1. Direct Supabase exact symbol lookup for any word in user prompt (e.g. ABUK, COMI, FWRY)
            if (promptWords.length > 0) {
                const { data: exactMatches } = await supabase
                    .from("stocks")
                    .select("symbol, name")
                    .in("symbol", promptWords)
                    .limit(1);

                if (exactMatches && exactMatches.length > 0) {
                    targetSymbol = exactMatches[0].symbol;
                    targetStockName = exactMatches[0].name;
                }
            }

            // 2. Arabic & English Common Stock Alias Mapping
            if (!targetSymbol) {
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

                for (const [alias, info] of Object.entries(stockAliases)) {
                    if (combinedText.includes(alias)) {
                        targetSymbol = info.sym;
                        targetStockName = info.name;
                        break;
                    }
                }
            }

            // 3. Regex Word Boundary Search across all Supabase stocks (prevents 'ab' matching 'abuk')
            if (!targetSymbol) {
                const { data: matchedStocks } = await supabase
                    .from("stocks")
                    .select("symbol, name")
                    .limit(150);

                if (matchedStocks && matchedStocks.length > 0) {
                    for (const s of matchedStocks) {
                        const sym = (s.symbol || "").trim();
                        if (sym.length >= 3) {
                            const wordRegex = new RegExp(`\\b${sym}\\b`, "i");
                            if (wordRegex.test(combinedText)) {
                                targetSymbol = s.symbol;
                                targetStockName = s.name;
                                break;
                            }
                        }
                    }
                }
            }

            // 4. Fetch Exact Real-Time Database Data for targetSymbol from Supabase
            if (targetSymbol) {
                const [priceRes, techRes, scanRes] = await Promise.all([
                    supabase.from("stock_prices").select("*").eq("symbol", targetSymbol).order("date", { ascending: false }).limit(1).maybeSingle(),
                    supabase.from("stock_technical_indicators").select("*").eq("symbol", targetSymbol).order("date", { ascending: false }).limit(1).maybeSingle(),
                    supabase.from("scan_results").select("*").eq("symbol", targetSymbol).order("created_at", { ascending: false }).limit(1).maybeSingle()
                ]);

                const priceData = priceRes.data;
                const techData = techRes.data;
                const scanData = scanRes.data;

                if (priceData || techData || scanData) {
                    systemPrompt += `\n\n=== 🔴 REAL-TIME SUPABASE DATABASE DATA FOR STOCK: ${targetSymbol} (${targetStockName}) ===\n`;
                    systemPrompt += `CRITICAL INSTRUCTION: You MUST use the exact real-time live numbers and current year 2026 provided below. Do NOT output old dates like 2024 or incorrect stock names.\n`;
                    systemPrompt += `- Stock Symbol: ${targetSymbol}\n`;
                    systemPrompt += `- Official Stock Name: ${targetStockName}\n`;
                    if (priceData) {
                        systemPrompt += `- Current Live Date: ${priceData.date} (Year 2026)\n`;
                        systemPrompt += `- Latest Close Price: EGP ${priceData.close} (Open: EGP ${priceData.open}, High: EGP ${priceData.high}, Low: EGP ${priceData.low})\n`;
                        systemPrompt += `- Trading Volume: ${priceData.volume}\n`;
                    }
                    if (techData) {
                        systemPrompt += `- Daily Change %: ${techData.change_pct}%\n`;
                        systemPrompt += `- RSI (14): ${techData.rsi_14}\n`;
                        systemPrompt += `- MACD: ${techData.macd} (Signal: ${techData.macd_signal}, Histogram: ${techData.macd_histogram})\n`;
                        systemPrompt += `- Moving Averages: SMA20=EGP ${techData.sma_20}, SMA50=EGP ${techData.sma_50}, SMA200=EGP ${techData.sma_200}\n`;
                        systemPrompt += `- Bollinger Bands: Upper=EGP ${techData.bb_upper}, Middle=EGP ${techData.bb_middle}, Lower=EGP ${techData.bb_lower}\n`;
                    }
                    if (scanData) {
                        systemPrompt += `- AI Model Recommendation: ${scanData.signal} (Precision: ${scanData.precision}%)\n`;
                        if (scanData.target_price) systemPrompt += `- AI Target Price: EGP ${scanData.target_price}\n`;
                        if (scanData.stop_loss) systemPrompt += `- AI Stop Loss: EGP ${scanData.stop_loss}\n`;
                    }
                    systemPrompt += `=== END OF DATABASE DATA ===\n`;
                }
            }
        } catch (stockErr) {
            console.error("Failed to query stock DB data for prompt:", stockErr);
        }


        // 5. Build Messages Array
        let userContent: any;
        if (hasImages) {
            // Fetch latest EGX stock prices reference from Supabase to provide real-time market context
            let stockPricesContext = "";
            try {
                const { data: stockList } = await supabase
                    .from("stock_fundamentals")
                    .select("symbol, close_price, name_ar")
                    .not("close_price", "is", null)
                    .limit(250);

                if (stockList && stockList.length > 0) {
                    stockPricesContext = "أسعار أسهم البورصة المصرية الحالية بالسوق المتاحة في قاعدة البيانات:\n" +
                        stockList.map((s: any) => `${s.symbol} (${s.name_ar || ''}): ${s.close_price} EGP`).join(", ");
                }
            } catch (pricesErr) {
                console.error("Failed to query stock prices reference:", pricesErr);
            }

            systemPrompt = `أنت خبير محترف ومحلل مالي متقدم لشاشات ومحافظ البورصة المصرية (OCR Financial Analyst).

قواعد هامة جداً وإلزامية للتحليل:
1. اقرأ واستخرج رموز وأسماء الأسهم المكتوبة داخل الصورة فقط بدون أي زيادة أو اختلاق أي سهم غير موجود في الصورة.
2. تنبيه حاسم: الأرقام المكتوبة بخط عريض أمام كل سهم (مثل 134,263.10 أو 129,165.00 أو 106,743.00) تمثل إجمالي "قيمة المركز/المبلغ المستثمر في السهم" (ج.م) في المحفظة، وليست سعر السهم الفردي!
3. يمكنك الاستعانة بأسعار السوق الحالية للأسهم لحساب عدد الأسهم التقديري (مثال: قيمة مركز HBCO هي 134,263.10 وسعر السهم بالسوق نحو 25 ج.م، فهذا يعني امتلاك نحو 5,300 سهم).
4. أجب دائماً باللغة العربية الفصحى الواضحة والمنظمة بأسلوب مالي راقٍ ودقيق.

${stockPricesContext}`;

            const promptText = `قم بقراءة وتحليل صورة محفظة الأسهم المرفقة بدقة عالية:
1. اذكر عدد ورموز الأسهم المكتوبة داخل الصورة فقط (بدون أي زيادة أو اختلاق أسهم غير موجودة).
2. لكل سهم، اذكر إجمالي قيمة المركز بالجنيه المصري (المبلغ المكتوب بخط عريض)، ومقدار الربح/الخسارة ونسبة التغير المئوية المكتوبة باللون الأخضر أو الأحمر.
3. اقرأ إجمالي قيمة المحفظة وإجمالي التغير المكتوب في أعلى الشاشة.
4. قدم تحليلاً مالياً ذكياً يشرح توزيع المحفظة والأسهم الأكثر ربحية والأعلى وزناً في المحفظة باللغة العربية.

${textMessage.trim() ? `استفسار المستخدم الخاص حول الصورة: ${textMessage}` : ""}`;

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
            ...formattedHistory,
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
            // Try requested model first, fall back to meta/llama-3.1-8b-instruct on retry for 1-2s response
            const modelsToTryForThisKey = (modelToUse !== "meta/llama-3.1-8b-instruct" && !hasImages)
                ? [modelToUse, "meta/llama-3.1-8b-instruct"]
                : [modelToUse];

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
                            temperature: hasImages ? 0.1 : 0.7,
                            max_tokens: 512,
                            stream: false,
                        }),
                        signal: AbortSignal.timeout(hasImages ? 20000 : (m === 0 ? 5000 : 7000)),

                    });

                    if (response.ok) {
                        rawText = await response.text();
                        success = true;
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
        
        let replyText = data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";

        if (hasImages && replyText) {
            // Strip English image caption patterns if returned by Llama vision model
            replyText = replyText.replace(/\[Caption:[^\]]+\]/gi, "").trim();
            if (!replyText || replyText.length < 15 || /^([a-zA-Z0-9\s.,\-\[\]:_]+)$/.test(replyText)) {
                replyText = "بناءً على تحليل الصورة المرفقة، تعرض الشاشة بيانات وأسهم البورصة المصرية والمؤشرات الفنية الموضحة بالشاشة. يمكنك الاستفسار عن سهم محدد من القائمة باللغة العربية وسأقوم بتحليله لك فوراً.";
            }
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
            remaining_quota: isUnlimited ? 999 : Math.max(0, 15 - newCount)
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

