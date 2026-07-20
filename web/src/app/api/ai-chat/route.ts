import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        const { message, history } = await req.json();
        
        if (!message || typeof message !== "string") {
            return NextResponse.json({ detail: "Message is required" }, { status: 400 });
        }

        // Format conversation history for AI model
        const formattedHistory = Array.isArray(history)
            ? history
                .filter((item: any) => item && item.content && (item.role === "user" || item.role === "assistant"))
                .slice(-8)
                .map((item: any) => ({ role: item.role, content: String(item.content) }))
            : [];

        // 2. Fetch User Profile
        const { data: profile } = await supabase
            .from("profiles")
            .select("display_name, username, telegram_chat_id")
            .eq("id", userId)
            .single();

        const userName = profile?.display_name || profile?.username || "Unknown User";

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

        if (!isUnlimited && limitData && limitData.chat_count >= 4) {
            return NextResponse.json({ 
                detail: "Daily limit reached. You can send up to 4 messages per day." 
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

        let systemPrompt = settings.system_prompt || "أنت محلل فني ومالي خبير لمنصة EGX Bots للبورصة المصرية.";
        const model = settings.model || "meta/llama-3.1-8b-instruct";
        const apiUrl = settings.api_url || "https://integrate.api.nvidia.com/v1";

        // 4.5 Search Database for Stock Data if mentioned in message or history
        try {
            const combinedText = (message + " " + formattedHistory.map((h: any) => h.content).join(" ")).toLowerCase();
            
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
                    // Basic keyword match
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

            // If a stock was identified, fetch real numbers from DB
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
                    systemPrompt += `Instructions: Use these EXACT numbers in your response to give the user a clear, data-driven analysis of ${targetSymbol}.\n`;
                }
            }
        } catch (stockErr) {
            console.error("Failed to query stock DB data for prompt:", stockErr);
        }

        // 5. Call AgentRouter API
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
                model: model,
                messages: [
                    { role: "system", content: systemPrompt },
                    ...formattedHistory,
                    { role: "user", content: message }
                ]
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("AgentRouter API Error:", errText);
            return NextResponse.json({ 
                detail: "Failed to communicate with AI provider.", 
                provider_error: errText 
            }, { status: response.status });
        }

        let data;
        const rawText = await response.text();
        try {
            data = JSON.parse(rawText);
        } catch (parseError) {
            console.error("Failed to parse JSON from provider. Raw response:", rawText);
            return NextResponse.json({ detail: "AI provider returned an invalid format. Please check your BASE URL." }, { status: 502 });
        }
        
        const replyText = data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";

        // 6. Update Limits
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

        // 7. Log Interaction (Use Service Role Key to bypass RLS)
        try {
            await supabase
                .from("ai_chatbot_logs")
                .insert({ user_id: userId, user_name: userName, message, reply: replyText });
        } catch (logErr) {
            console.error("Failed to log AI chat interaction:", logErr);
        }

        // 8. Forward to Telegram Support
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
                                    `✉️ *Message:* ${message}\n\n` +
                                    `💬 *Bot Reply:* ${replyText.substring(0, 1000)}${replyText.length > 1000 ? '...' : ''}\n\n` +
                                    `📊 *Daily Quota:* ${isUnlimited ? 'Unlimited' : `${newCount}/4`}`;

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
            remaining_quota: isUnlimited ? 999 : Math.max(0, 4 - newCount)
        });

    } catch (e: any) {
        console.error("AI Chat Error:", e);
        return NextResponse.json({ detail: "Internal Server Error", error: e.message || String(e) }, { status: 500 });
    }
}
