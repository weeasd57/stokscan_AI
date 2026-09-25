# خطة: مسح بوابة الاختبار + خصم إداري لفترة محدودة (تم التنفيذ)

## الهدف

1. **حذف خطة الاختبار** (`pro_test`) بالكامل من الباك إند والفرونت إند.
2. **خصم لفترة محدودة** على الباقة الشهرية (200 → 50) بتحكم كامل من **تبويب BILLING في الأدمن**، ويرجع 200 تلقائياً بعد تاريخ الانتهاء.
3. لا يمس باقات 6 شهور (1000) ولا السنة (1800).

## التصميم المنفَّذ

- جدول `local_billing_settings` (صف واحد id=1) في Supabase: أسعار الباقات + حالة الخصم (تفعيل/سعر/تاريخ انتهاء/اسم الشارة عربي وإنجليزي).
- `api/payment_common.py`: `billing_settings()` يقرأ من DB بكاش 15 ثانية، ويسقط لقيم env كأمان لو الجدول مفقود.
- `pro_discount()` يعطي أولوية لإعدادات الأدمن، وenv fallback (`PRO_DISCOUNT_PRICE_EGP` / `PRO_DISCOUNT_ENDS_AT`).
-بوابة الدفع تأخذ السعر الفعّال في لحظة إنشاء الطلب → تحقق الـ callback يتطابق معه.
- `payment_config()` يضيف كائن `discount` لباقة `pro` (label_en/ar + ends_at + original_amount_egp).
- API أدمن: `web/src/app/api/admin/billing/settings/route.ts` (GET/POST محمي بـ requireAdmin + service role).
- تبويب الأدمن: `web/src/app/admin/components/BillingTab.tsx` — تعديل الأسعار، تشغيل/إيقاف العرض، معاينة حية لما يراه العميل.
- الواجهة: كارت الشهري يعرض السعر المشطوب + شارة "عرض محدود" من بيانات الباك إند.

## ما يلزم بعد الدمج

1. **تطبيق الـ migration** `supabase/migrations/20260925163000_billing_admin_settings.sql` (CLI غير موثّق محلياً — شغّله من Supabase dashboard أو بعد `supabase login`): ينشئ الجدول **ويفعّل عرض 50 ج.م لمدة 14 يوماً**.
2. بعد التنفيذ، التحكم الكامل من الأدمن → BILLING (بدون env).

## التحقق المنجَز

- `python -m unittest api.tests.test_easykash_payload` → 9/9 OK (شاملة اختبارات الخصم: env، DB، الانتهاء، والإيقاف).
- `npx tsc --noEmit` بدون أخطاء، و`npm run build` للنجاح.
- إصلاح test قديم كان يفشل قبل التغييرات (كان يتوقع 33 خارج الاستبعاد بينما الكود يستبعده عمداً).

## الملفات المتأثرة

- `api/payment_common.py` (خصم + DB settings)
- `api/easykash_payments.py` (حذف pro_test + عرض الخصم)
- `api/plan_limits.py` (سعر فعّال)
- `api/tests/test_easykash_payload.py` (تغطي الخصم)
- `web/src/app/pricing/PricingClient.tsx` (حذف كارت الاختبار + شطوب العرض)
- `web/src/app/admin/{page.tsx, components/AdminHeader.tsx, components/BillingTab.tsx}`
- `web/src/app/api/admin/billing/settings/route.ts` (جديد)
- `supabase/migrations/20260925163000_billing_admin_settings.sql` (جديد)
- `.env` و `.env.billing.example` (توثيق fallback المتغيرات + إسقاط PRO_PRICE_EGP صريحاً)
