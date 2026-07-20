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
        const { message } = await req.json();
        
        if (!message || typeof message !== "string") {
            return NextResponse.json({ detail: "Message is required" }, { status: 400 });
        }

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

        let systemPrompt = settings.system_prompt || "You are a helpful AI Assistant.";
        const model = settings.model || "meta/llama-3.1-8b-instruct";
        const apiUrl = settings.api_url || "https://integrate.api.nvidia.com/v1";

        // Fetch Live Site Data to Inject into Prompt
        try {
            const adminKey = process.env.ADMIN_SECRET_KEY || "";
            const backendUrl = process.env.PYTHON_BACKEND_URL || process.env.API_BASE_URL || "http://127.0.0.1:8000";
            
            // Fetch stats and models concurrently
            const [statsRes, modelsRes] = await Promise.all([
                fetch(`${backendUrl}/ai_bot/supabase-stats`, { cache: 'no-store' }),
                fetch(`${backendUrl}/admin/train/models`, {
                    headers: { "x-admin-key": adminKey },
                    cache: 'no-store'
                })
            ]);

            // Fetch user count concurrently
            const { count: usersCount } = await supabase.from("profiles").select("*", { count: "exact", head: true });

            if (statsRes.ok && modelsRes.ok) {
                const stats = await statsRes.json();
                const models = await modelsRes.json();
                
                // Inject into prompt
                systemPrompt += `\n\n=== Live Site Data ===\n`;
                systemPrompt += `- Total Registered Users: ${usersCount || 0}\n`;
                systemPrompt += `- Total Daily Price Rows: ${stats.stock_prices?.rows || 0}\n`;
                systemPrompt += `- Last Update Date: ${stats.stock_prices?.last_date || 'N/A'}\n`;
                systemPrompt += `- Total Intraday Rows: ${stats.stock_bars_intraday?.rows || 0}\n`;
                systemPrompt += `- AI Models Available: ${models.length ? models.join(", ") : "None"}\n`;
            }
        } catch (dataErr) {
            console.error("Failed to fetch live site data for prompt injection:", dataErr);
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
        
        if (botToken) {
            // Extract the actual chat_id and message_thread_id
            let chatIdStr = telegramChatId;
            let threadId: string | undefined = undefined;
            if (chatIdStr.includes("_")) {
                [chatIdStr, threadId] = chatIdStr.split("_");
            }

            const telegramMessage = `🤖 *AI Chatbot Interaction*\n\n` +
                                    `👤 *User:* ${userName}\n` +
                                    `✉️ *Message:* ${message}\n\n` +
                                    `💬 *Bot Reply:* ${replyText.substring(0, 1000)}${replyText.length > 1000 ? '...' : ''}\n\n` +
                                    `📊 *Daily Quota:* ${newCount}/4`;

            const payload: any = {
                chat_id: chatIdStr,
                text: telegramMessage,
                parse_mode: "Markdown"
            };
            
            if (threadId) {
                payload.message_thread_id = parseInt(threadId, 10);
            }

            // Send async without blocking
            fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            }).catch(e => console.error("Telegram Forwarding Failed:", e));
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
