"use client";

const usd = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? `$${value.toFixed(6)}` : "غير متاحة";
export function UserChatCost({ summary, complete }: { summary?: { cost_usd: number; unpriced_messages: number; messages: number; total_tokens: number }; complete: boolean }) {
    if (!summary) return <span className="text-xs text-zinc-500">تكلفة الشات: غير متاحة</span>;
    return <div className="text-xs space-y-1" dir="rtl">
        <div>تكلفة الشات التقديرية: <b dir="ltr">{summary.unpriced_messages === summary.messages && summary.messages > 0 && summary.cost_usd === 0 ? "غير متاحة" : usd(summary.cost_usd)}</b> • {summary.messages} رسالة • {summary.total_tokens.toLocaleString()} توكن</div>
        <div className="text-zinc-500">{complete ? "كل السجل المحفوظ" : "إجمالي جزئي: تم الوصول لحد تحميل السجل"}{summary.unpriced_messages > 0 ? ` • ${summary.unpriced_messages} رسالة بتكلفة ناقصة أو غير متاحة، غير مشمولة بالكامل في الإجمالي` : ""}</div>
    </div>;
}
export function ChatUsageDetails({ log }: { log: any }) {
    const usage = log.usage;
    return <details className="mt-2 border-t border-indigo-200 dark:border-zinc-700 pt-2 text-[11px]" dir="rtl">
        <summary className="cursor-pointer">استهلاك الرسالة • التكلفة {usd(usage?.cost_usd)}{typeof usage?.cost_usd === "number" ? " (تقديرية)" : ""}</summary>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 break-all">
            <dt>الموديل</dt><dd>{usage?.model || "غير مسجل"}</dd>
            <dt>توكن الإدخال / الإخراج</dt><dd>{usage ? `${usage.prompt_tokens ?? "—"} / ${usage.completion_tokens ?? "—"}` : "غير مسجل"}</dd>
            <dt>إجمالي التوكنات</dt><dd>{usage?.total_tokens ?? "غير مسجل"}</dd>
            <dt>استدعاءات الموديل / الأدوات</dt><dd>{usage ? `${usage.provider_calls ?? "—"} / ${usage.tool_calls ?? "—"}` : "غير مسجل"}</dd>
            <dt>وقت الإرسال</dt><dd>{new Date(log.created_at).toLocaleString("ar-EG")}</dd>
            <dt>معرّف الرسالة</dt><dd>{log.id}</dd>
            <dt>معرّف الرد</dt><dd>{log.assistant_message_id || "—"}</dd>
            <dt>الجلسة</dt><dd>{log.session_id || "—"}</dd>
            <dt>مصدر الرد / البيانات</dt><dd>{log.response_origin || "—"} / {log.data_source || "—"}</dd>
            <dt>مراجعة الرد</dt><dd>{log.publication_review ? (log.publication_review.final_passed ? "اجتاز" : "رد محدود / تعذر التحقق") : "غير مسجل"}</dd>
            <dt>معرّف الطلب</dt><dd>{log.correlation_id || "—"}</dd>
        </dl>
        {Array.isArray(usage?.calls) && usage.calls.map((call: any, index: number) => <div key={index} className="mt-2 bg-white/60 dark:bg-black/30 p-2 rounded">
            {index + 1}. {call.stage === "vision" ? "قراءة صورة" : call.stage === "review" ? "مراجعة الرد" : call.stage === "repair" ? "إصلاح الرد" : call.stage === "authorization" ? "التحقق من طلب الحفظ" : "الشات"} • {call.provider} / {call.model}<br />
            إدخال {call.prompt_tokens ?? "—"} • إخراج {call.completion_tokens ?? "—"} • كاش {call.cache_hit_tokens ?? "غير مسجل"} • {usd(call.cost_usd)}<br />
            <span className="text-zinc-500">{call.pricing_version || "سعر غير متاح"}</span>
        </div>)}
        <p className="mt-2 text-zinc-500">التكلفة محسوبة من استهلاك الموديل، وتشمل الاستدعاءات المسجلة للمراجعة والصور. هي تقدير وليست فاتورة؛ غياب تفاصيل الكاش يُحسب بسعر الإدخال الأعلى، وقد تختلف خصومات العطلات. السجلات القديمة لا تتحول لتكلفة صفر.</p>
    </details>;
}
