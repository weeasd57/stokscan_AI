import fs from 'node:fs';
import { createClient } from './web/node_modules/@supabase/supabase-js/dist/index.mjs';

// Load env vars from web/.env.local
const envFile = fs.readFileSync('web/.env.local', 'utf8');
for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

async function runTest() {
    console.log("=== Generating Auth Session ===");
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: 'abdallahsaied912@gmail.com' });
    const v = await anon.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
    const token = v.data.session.access_token;
    console.log("Auth token obtained successfully.");

    const messagesToTest = [
        /*
        "انا شاري سهم راية ب 8.14 وهو قعد ينزل ابيعه بكام؟\nو اية الاسهم اللى عليها تجميع كبير الفترة الحالية وفرصتهم فالصعود عالية خلال فترة قريبه",
        "الاسكندرية والمطاحن والشمس - اشتري مين بكره؟",
        "Bioc مشترية عند 383",
        "مستهدفاته ايه",
        "اعمل مسح فني لسهم CPME واشرح المؤشرات الفنية الحالية فقط بدون توصية شراء أو بيع.\nما هو اتجاه سهم CPME الحالي؟\nهل سهم CPME في مرحلة تجميع أم تصريف؟ ولماذا؟\nاعرض قيم RSI وMACD والمتوسطات المتحركة لسهم CPME.\nما هي مستويات الدعم والمقاومة الحالية لسهم CPME؟",
        "هل سهم elsh الآن في مرحلة تجميع أم تصريف؟ اذكر الأسباب.",
        */
        "هات الاسهم اللى عليها تجميع وتحت القيمه العادله\nوشوف elsh اشتريه بكره ولا اى",
        "فى توصيه على الاسهم دى عندك ؟"
    ];

    let sessionId = null;

    for (let i = 0; i < messagesToTest.length; i++) {
        console.log(`\n----------------------------------------`);
        console.log(`TURN ${i + 1}: ${messagesToTest[i].substring(0, 50)}...`);
        const payload = {
            message: messagesToTest[i],
            stream: true
        };
        if (sessionId) payload.session_id = sessionId;

        const res = await fetch('http://127.0.0.1:3000/api/ai-chat', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        console.log(`Status: ${res.status}`);
        const text = await res.text();
        let fullText = '';
        const lines = text.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const chunkStr = line.slice(6).trim();
                if (chunkStr === '[DONE]') continue;
                try {
                    const parsed = JSON.parse(chunkStr);
                    if (parsed.session_id) sessionId = parsed.session_id;
                    if (parsed.content) fullText += parsed.content;
                    if (parsed.text) fullText += parsed.text;
                } catch {}
            }
        }
        console.log(`Reply:\n${fullText.trim()}`);
        await new Promise(r => setTimeout(r, 1000));
    }
}

runTest().catch(console.error);
