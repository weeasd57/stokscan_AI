# معمارية الشات بوت الذكية المستقلة (Agentic Chat Architecture)
**تاريخ الاعتماد**: 2026-10-08  
**المحرك الأساسي**: `web/src/lib/ai/agentic-pipeline.ts`  
**الموديل المسؤول**: DeepSeek-V3 (`deepseek-chat`) عبر OpenAI-Compatible Function Calling  

---

## 1. الدوافع وأسباب التحول الجذري
في السابق، اعتمد نظام الشات على مزيج هجين من قواعد الـ Regex وقواطع النيات اليدوية (Deterministic Heuristics) قبل استدعاء الموديل. نتج عن ذلك مشاكل حادة في تجربة المستخدم الواقعية (مثل جلسة المستخدم `shazli767@gmail.com`):
1. **استبدال الرموز الخاطئ (False Symbol Swapping)**: سهم شركة آراب ديري ببورصة النيل `ADRI` تم استبداله تلقائياً بـ `ADCI` (Arab Pharmaceuticals) بسعر 270.94 ج.م بدلاً من 13.69 ج.م بسبب تطابق المسافة الإملائية (Levenshtein distance).
2. **حجب أسهم بورصة النيل والشركات الصغيرة**: منع إطلاق الأدوات لأسهم المشروعات الصغيرة والمتوسطة لاعتبارها غير مغطاة.
3. **حلقة رفض الفالديتور (Validator Rejection Loop)**: رفض الإجابة الصحيحة ("تعذر التحقق من إجابة متسقة") لأسئلة شائعة مثل `عايز توصيات الاسبوع الحالى`.
4. **هشاشة الأخطاء الإملائية والعامية**: تعثر النظام عند كتابة أسئلة بالعامية المصرية أو أخطاء طباعية مثل `من المرجح الجنس القادمه`.
5. **ترويسات الجداول الفارغة**: ظهور عناوين markdown بدون محتوى تحليلي تحتها.

---

## 2. مبادئ المعمارية الجديدة (Pure LLM-Driven Agentic)
1. **الموديل يحدد النية والأدوات ذاتياً 100%**:
   - لا توجد قواعد Regex لتخمين النية مسبقاً.
   - يتلقى الموديل مخطط الأدوات (`tools: [...]`) ويقرر تلقائياً وبدقة متناهية ما إذا كان السؤال يحتاج أداة أو أكثر بالتوازي أو رد مباشر.
2. **تنفيذ الأدوات بالتوازي (Parallel Execution)**:
   - في حال طلب المستخدم مقارنة أو عدة معلومات (مثل السعر والمستويات الفنية)، يستدعي الموديل الأدوات المتعددة في دورة استدعاء واحدة وتنفذ بالتوازي عبر `Promise.all`.
3. **البث اللحظي للتوكنز (Smooth Real-time Streaming)**:
   - بعد جلب بيانات الأدوات، يقوم الموديل بصياغة الرد مع بث التوكنز لحظياً (`type: "token"`) للمستخدم عبر SSE.
4. **تتبع ذكي للسياق والرموز (Multi-Turn Tracking)**:
   - تتبع الرموز المستعلم عنها وتحديث `current_symbol` و `last_symbols` في `SessionState` تلقائياً دون الحاجة لقواعد يدوية.

---

## 3. قائمة الأدوات المعتمدة (The 9 Core Tools)

| اسم الأداة | المسؤولية | المدخلات الرئيسية | مصدر البيانات |
|---|---|---|---|
| `get_stock` | فحص السعر المحدث، التغير، ومؤشرات التحليل الفني (RSI, MACD, Trend) | `symbol: string` | جدول `stock_technical_indicators` وجدول `stocks` |
| `get_stock_levels` | حساب مقاومات ودعوم فيبوناتشي والقمم والقيعان ووقف الخسارة | `symbol: string` | جدول `stock_prices` التاريخي |
| `manage_portfolio` | قراءة، إضافة، تعديل، حذف، أو تصفية مراكز محفظة المستخدم | `action, symbol, quantity, entry_price` | جداول `portfolios` و `portfolio_positions` |
| `get_market` | نظرة عامة على أداء السوق، السيولة الإجمالية، وقوائم الرابحين والخاسرين | `None` | جدول `market_summary` و `stock_technical_indicators` |
| `get_recommendations` | جلب التوصيات الفنية الحية المفتوحة بالمنصة وفلاترها | `status: string, limit: number` | جداول `recommendations` و `trading_signals` |
| `get_technical_scan` | الماسح الفني الذكي لاكتشاف إشارات التباعد (Divergence) والكسر | `preset, direction, limit` | جدول `scan_results` وجدول المؤشرات |
| `get_accumulation_stocks`| رادار التجميع المؤسسي والسيولة الذكية لمنهجية وايكوف (Wyckoff) | `min_acc_score, limit` | مؤشرات التجميع وحركة السيولة |
| `get_news` | آخر الأخبار والإفصاحات الرسمية للشركات المقيدة بالبورصة | `symbol?: string, limit?: number` | جدول `stock_news` |
| `get_comparison` | مقارنة تفصيلية متوازية بين شركتين أو أكثر بالبيانات الفنية والمالية | `symbols: string[]` | بيانات مقارنة متعددة من الجداول الفنية |

---

## 4. مسار الاستدعاء والتوجيه (Pipeline Routing)

```ts
// web/src/lib/ai/pipeline.ts
export async function* runPipelineStream(...) {
    const deepseekKey = getDeepSeekApiKey();
    if (deepseekKey && !options.mockPlannerResult && !options.mockToolsResults) {
        yield* runAgenticPipelineStream(
            userMessage, images, sessionState, sessionSummary, history,
            supabase, apiKeys, userId, sessionId, messageId, requestedModel, options
        );
        return;
    }
    // مسار الاحتياط الحتمي في حال غياب المفتاح أو أثناء الاختبارات المعزولة
    ...
}
```

---

## 5. نتائج الاختبار والتحقق الشامل
1. **محاكاة 23 دورة لمستخدم حقيقي**:
   - تم فحص وتمرير جميع أسئلة المستخدم `shazli767@gmail.com` بنجاح 100% (ملف `scratch/agentic_simulation_results.json`).
2. **اختبارات أوفلاين غير حية**:
   - نجاح 95 مجموعة اختبار تضم 1,028 اختباراً بـ Jest.
3. **التوافق البرمجي**:
   - `npx tsc --noEmit` ينتهي بـ 0 أخطاء برمجية.
4. **حماية الموارد وSupabase**:
   - حظر كامل لاستعلامات سجلات Logflare (`query_logs`).
   - استعلامات دقيقة ومقيدة بحدود صريحة وتحديد للحقول المطلوبة فقط.
