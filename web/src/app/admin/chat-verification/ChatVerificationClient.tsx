"use client";

import { useCallback, useEffect, useState } from "react";
import { useChat } from "@/contexts/ChatContext";
import { useAuth } from "@/contexts/AuthContext";

const cases = [
    "محفظة افتراضية بـ100 ألف جنيه: COMI بنسبة 60%، وSWDY بنسبة 25%، وTMGH بنسبة 15%. حلل مخاطر التركيز ووضّح أي بيانات ناقصة.",
    "معايا 100 ألف جنيه وعايز أوزعهم بالتساوي على COMI وSWDY وTMGH. دي محفظة افتراضية. احسب مبلغ كل سهم والتركيز القطاعي، والخسارة لو المحفظة نزلت 5% و10%.",
];
export default function ChatVerificationPage() {
    const { user } = useAuth();
    const { sendMessage, setIsOpen, isLoading, activeSessionId, selectedModel, messages, createNewSession } = useChat();
    const [allowed, setAllowed] = useState(false);
    const [revision, setRevision] = useState<string | null>(null);
    const [traces, setTraces] = useState<any[]>([]);
    const [status, setStatus] = useState("التحقق من صلاحية الأدمن...");
    useEffect(() => {
        let active = true;
        setAllowed(false);
        fetch("/api/admin/ai-chatbot/trace?action=access").then(async response => {
            if (!active) return;
            if (!response.ok) { setStatus("سجّل الدخول بحساب الأدمن لتشغيل نفس مسار الشات."); return; }
            const data = await response.json();
            if (active) { setAllowed(true); setRevision(data.deployment_sha); setStatus("جاهز؛ الموديل والبيانات ومراجعة الرد حقيقية."); }
        }).catch(() => { if (active) setStatus("تعذر التحقق من صلاحية الأدمن."); });
        return () => { active = false; };
    }, [user?.id]);
    const refresh = useCallback(async () => {
        if (!allowed || !activeSessionId) return;
        try {
            const response = await fetch(`/api/admin/ai-chatbot/trace?session_id=${encodeURIComponent(activeSessionId)}`);
            if (!response.ok) throw new Error("trace unavailable");
            setTraces((await response.json()).messages || []);
        } catch { setStatus("تعذر تحميل دليل المسار؛ لا تعتبر الاختبار ناجحاً."); }
    }, [allowed, activeSessionId]);
    useEffect(() => { if (!isLoading) void refresh(); }, [isLoading, refresh, messages.length]);
    const run = async (prompt: string) => {
        setStatus("جارٍ الإرسال عبر ChatContext وAPI الموقع نفسه...");
        setIsOpen(true);
        await sendMessage(prompt);
        setStatus("انتهى طلب الشات؛ راجع الرد المعروض ودليل المسار قبل اعتماد النتيجة.");
    };
    return <main dir="rtl" className="mx-auto max-w-4xl p-5 space-y-5">
        <h1 className="text-2xl font-bold">اختبار ARTORO في مسار الموقع الحقيقي</h1>
        <p>الأزرار تستخدم نفس ChatContext ونافذة ARTORO، بنفس حسابك والموديل المحدد وسياق الجلسة وSSE. لا توجد ردود جاهزة أو موافقة مراجعة مصطنعة. تُسجّل رسائل الاختبار وتستهلك الاستخدام العادي.</p>
        <p role="status">{status}</p>
        <dl className="text-sm break-all space-y-1"><dt>نسخة الموقع</dt><dd>{revision || "غير موثقة"}</dd><dt>الموديل المحدد</dt><dd>{selectedModel}</dd><dt>الجلسة الحالية</dt><dd>{activeSessionId || "ستُنشأ عند الإرسال"}</dd></dl>
        <div className="flex flex-wrap gap-2">
            <button disabled={!allowed || isLoading} onClick={() => setIsOpen(true)} className="border p-2 rounded">افتح نفس نافذة الشات</button>
            <button disabled={!allowed || isLoading} onClick={() => { createNewSession(); setTraces([]); }} className="border p-2 rounded">جلسة اختبار جديدة</button>
            {cases.map((prompt, i) => <button key={i} disabled={!allowed || isLoading} onClick={() => void run(prompt)} className="border p-2 rounded disabled:opacity-50">اختبار {i + 1}: {i === 0 ? "60 / 25 / 15" : "التوزيع بالتساوي"}</button>)}
            <button disabled={!allowed || isLoading || !activeSessionId} onClick={() => void refresh()} className="border p-2 rounded">تحديث دليل المسار</button>
        </div>
        <p className="text-sm">لإعادة مشكلة سياق جلسة قديمة، اخترها من سجل ARTORO أولاً ثم أرسل نفس السؤال. لحالة نظيفة ابدأ جلسة اختبار جديدة. تكرار نفس النص قد ينتج صياغة مختلفة من الموديل؛ الدليل يسجّل ما حدث فعلياً في كل محاولة.</p>
        {traces.map(row => <section key={row.id} className="border rounded p-3 space-y-2">
            <h2 className="font-bold">{new Date(row.created_at).toLocaleString("ar-EG")}</h2>
            <p>{row.trace?.complete && row.review?.final_passed && row.origin === "llm" ? "المسار مسجّل والمراجعة اجتازت؛ يلزم فحص مضمون الرد" : "التحقق غير مكتمل أو الرد مرفوض / احتياطي"}</p>
            <p>تكلفة تقديرية: {typeof row.usage?.cost_usd === "number" ? `$${row.usage.cost_usd.toFixed(6)}` : "غير متاحة"}</p>
            <details><summary>الطلب الفعلي، ردود الموديل والأدوات والمراجعة</summary><pre dir="ltr" className="text-xs overflow-auto whitespace-pre-wrap break-all max-h-96">{JSON.stringify({message_id: row.id, reply: row.content, review: row.review, usage: row.usage, trace: row.trace}, null, 2)}</pre></details>
        </section>)}
    </main>;
}
