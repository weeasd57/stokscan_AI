import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        const { message, history, image, images, model: userRequestedModel } = await req.json();
        
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

        // Format conversation history for AI model (text-only for history)
        const formattedHistory = Array.isArray(history)
            ? history
                .filter((item: any) => item && item.content && (item.role === "user" || item.role === "assistant"))
                .slice(-6)
                .map((item: any) => {
                    let text = String(item.content);
                    // Filter out repetitive English image captions from history
                    if (text.includes("[Caption:")) {
                        text = text.replace(/\[Caption:[^\]]+\]/gi, "").trim();
                    }
                    if (text.startsWith("📷 [")) {
                        text = text.replace(/^📷\s*\[[^\]]+\]\s*/, "").trim();
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
        const defaultTextModel = settings.model || "meta/llama-3.3-70b-instruct";
        const chosenModel = userRequestedModel || defaultTextModel;
        const apiUrl = settings.api_url || "https://integrate.api.nvidia.com/v1";

        // Use vision model when image is present, otherwise user chosen model
        const modelToUse = hasImages ? VISION_MODEL : chosenModel;

        // 4.5 Search Database for Stock Data if mentioned in message or history
        const textMessage = message || "";
        try {
            const combinedText = (textMessage + " " + formattedHistory.map((h: any) => h.content).join(" ")).toLowerCase();
            
            // Search stocks table to see if any stock matches symbol or name
            const { data: matchedStocks } = await supabase
                .from("stocks")
                .select("symbol, name")
                .limit(100);

            let targetSymbol = "";
            let targetStockName = "";

            if (matchedStocks && matchedStocks.length > 0) {
                for (const s of matchedStocks) {
                    const sym = (s.symbol || "").toLowerCase();
                    const name = (s.name || "").toLowerCase();
                    if (sym.length >= 2 && combinedText.includes(sym)) {
                        targetSymbol = s.symbol;
                        targetStockName = s.name;
                        break;
                    }
                    if (name.length >= 3 && combinedText.includes(name)) {
                        targetSymbol = s.symbol;
                        targetStockName = s.name;
                        break;
                    }
                }
            }

            // Common Arabic name mapping fallbacks
            if (!targetSymbol) {
                const arabicMap: Record<string, string> = {
                    "موبكو": "MFPC", "أبو قير": "ABUK", "التجاري الدولي": "COMI", "سي أي كابيتال": "CICP",
                    "فوري": "FWRY", "سويدي": "SWDY", "طلعت مصطفى": "TMGH", "بلتون": "BTFH",
                    "حديد عز": "ESRS", "إعمار": "EMFD", "هيرمس": "HRHO", "أموك": "AMOC", "مصر للألومنيوم": "EGAL"
                };
                for (const [key, sym] of Object.entries(arabicMap)) {
                    if (combinedText.includes(key)) {
                        targetSymbol = sym;
                        targetStockName = key;
                        break;
                    }
                }
            }

            // If a stock was identified, append ONLY the raw stock data numbers
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
                    systemPrompt += `\n\n=== Real-Time Database Data for Stock: ${targetSymbol} (${targetStockName}) ===\n`;
                    if (priceData) {
                        systemPrompt += `- Latest Date: ${priceData.date}\n`;
                        systemPrompt += `- Close Price: EGP ${priceData.close} (Open: ${priceData.open}, High: ${priceData.high}, Low: ${priceData.low})\n`;
                        systemPrompt += `- Volume: ${priceData.volume}\n`;
                    }
                    if (techData) {
                        systemPrompt += `- Change %: ${techData.change_pct}%\n`;
                        systemPrompt += `- RSI (14): ${techData.rsi_14}\n`;
                        systemPrompt += `- MACD: ${techData.macd} (Signal: ${techData.macd_signal}, Hist: ${techData.macd_histogram})\n`;
                        systemPrompt += `- Moving Averages: SMA20=${techData.sma_20}, SMA50=${techData.sma_50}, SMA200=${techData.sma_200}\n`;
                        systemPrompt += `- Bollinger Bands: Upper=${techData.bb_upper}, Middle=${techData.bb_middle}, Lower=${techData.bb_lower}\n`;
                        if (techData.divergence_summary) {
                            systemPrompt += `- Technical Divergence: ${techData.divergence_summary}\n`;
                        }
                    }
                    if (scanData) {
                        systemPrompt += `- AI Model Signal: ${scanData.signal} (Model Precision: ${scanData.precision}%)\n`;
                        if (scanData.target_price) systemPrompt += `- AI Target Price: EGP ${scanData.target_price}\n`;
                        if (scanData.stop_loss) systemPrompt += `- AI Stop Loss: EGP ${scanData.stop_loss}\n`;
                    }
                }
            }
        } catch (stockErr) {
            console.error("Failed to query stock DB data for prompt:", stockErr);
        }

        // 5. Build Messages Array
        let userContent: any;
        if (hasImages) {
            systemPrompt = "أنت خبير محترف ومحرك قراءة وتصميم صور مالي عالي الدقة (OCR Financial Analyst). مهمتك هي قراءة كافة الأسهم والرموز والأسعار والأرقام الحقيقية المكتوبة داخل الصورة بدقة شديدة وتحليلها باللغة العربية الفصحى الواضحة والرد دائماً باللغة العربية فقط دون أي تزييف أو تخمين للأرقام.";

            const promptText = `أنت محرك قراءة وتحليل الصور المالية للبورصة المصرية. 
اقرأ كافة النصوص والرموز والأرقام والأسعار الموجودة داخل هذه الصورة بوضوح ودقة عالية:

1. اذكر رمز/اسم كل سهم ظاهر في الصورة (مثل KRDI, GGCC, AIHC, AIDC وغيرها).
2. اقرأ السعر المحدد بالأرقام بجانب كل سهم (مثل الأسعار والأرقام المكتوبة بخط عريض).
3. اقرأ نسبة التغير والتفاصيل والألوان الموضحة.
4. اذكر إجمالي قيمة المحفظة/الرصيد المكتوب في أعلى الشاشة إن وجد.
5. قدم ملخصاً تحليلياً شاملاً ومباشراً باللغة العربية بناءً على الأرقام الحقيقية الموضحة بالصورة فقط.

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

        // 6. Call NVIDIA API with Retries and Timeout
        let rawText = "";
        let attempt = 0;
        const maxAttempts = 3;
        let success = false;

        while (attempt < maxAttempts && !success) {
            attempt++;
            try {
                const response = await fetch(`${apiUrl}/chat/completions`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${settings.api_key}`,
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Accept": "application/json",
                        "HTTP-Referer": "https://agentrouter.org",
                        "Origin": "https://agentrouter.org",
                        "X-Title": "EGX Bots"
                    },
                    body: JSON.stringify({
                        model: modelToUse,
                        messages: aiMessages,
                        temperature: hasImages ? 0.1 : 0.7,
                        max_tokens: 1024,
                        stream: false,
                    }),
                    signal: AbortSignal.timeout(15000), // 15-second timeout per attempt
                });

                if (response.ok) {
                    rawText = await response.text();
                    success = true;
                } else {
                    const errText = await response.text();
                    console.warn(`AI API Attempt ${attempt} failed with status ${response.status}:`, errText);
                    if (attempt === maxAttempts) {
                        return NextResponse.json({ 
                            detail: "Failed to communicate with AI provider.", 
                            provider_error: errText 
                        }, { status: response.status });
                    }
                }
            } catch (fetchErr: any) {
                console.error(`AI API Attempt ${attempt} encountered error:`, fetchErr);
                if (attempt === maxAttempts) {
                    return NextResponse.json({
                        reply: "الخدمة مشغولة حالياً، يرجى المحاولة مرة أخرى بعد قليل 🙏",
                        remaining_quota: Math.max(0, 4 - (limitData?.chat_count || 0))
                    });
                }
                // Sleep 1.5 seconds before retrying
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
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

        // 8. Log Interaction (Use Service Role Key to bypass RLS)
        try {
            await supabase
                .from("ai_chatbot_logs")
                .insert({
                    user_id: userId,
                    user_name: userName,
                    message: hasImages ? `[📷 ${imageList.length} Images] ${textMessage}` : textMessage,
                    reply: replyText
                });
        } catch (logErr) {
            console.error("Failed to log AI chat interaction:", logErr);
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
            return NextResponse.json({ history: [], remaining_quota: 4 });
        }

        const userId = session.user.id;
        const userEmail = session.user.email || "";
        const isUnlimited = ["weeessd57@gmail.com", "user@gmail.com", "weeasd57@gmail.com"].includes(userEmail.toLowerCase());

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

        // Fetch user's past logs
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
        return NextResponse.json({ history: [], remaining_quota: 4 });
    }
}
