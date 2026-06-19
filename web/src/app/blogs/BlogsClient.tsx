"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import {
  BookOpen,
  Calendar,
  User,
  ArrowRight,
  X,
  Sparkles,
  Send,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Language = "en" | "ar";

interface LocalizedText {
  en: string;
  ar: string;
}

interface Post {
  title: LocalizedText;
  excerpt: LocalizedText;
  date: string;
  author: string;
  category: LocalizedText;
  content: Record<Language, React.ReactNode>;
}

export default function BlogsPage() {
  const { t, language } = useLanguage();
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const isAr = language === "ar";
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [dbPosts, setDbPosts] = useState<Post[]>([]);
  const [dbLoading, setDbLoading] = useState(true);

  useEffect(() => {
    async function fetchArticles() {
      try {
        const { data, error } = await supabase
          .from("articles")
          .select("*")
          .eq("is_published", true)
          .order("created_at", { ascending: false });
        
        if (error) throw error;
        
        if (data) {
          const mapped: Post[] = data.map((art: any) => ({
            title: {
              en: art.title_en,
              ar: art.title_ar,
            },
            excerpt: {
              en: art.excerpt_en,
              ar: art.excerpt_ar,
            },
            date: new Date(art.created_at).toLocaleDateString(language === "ar" ? "ar-EG" : "en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            }),
            author: art.author || "EGX Bots Team",
            category: {
              en: art.category_en,
              ar: art.category_ar,
            },
            content: {
              en: <div className="space-y-6 text-zinc-850 dark:text-zinc-200 text-sm sm:text-base leading-relaxed" dangerouslySetInnerHTML={{ __html: art.content_en }} />,
              ar: <div className="space-y-6 text-zinc-850 dark:text-zinc-200 text-sm sm:text-base leading-relaxed" dangerouslySetInnerHTML={{ __html: art.content_ar }} />,
            }
          }));
          setDbPosts(mapped);
        }
      } catch (err) {
        console.error("Error fetching articles:", err);
      } finally {
        setDbLoading(false);
      }
    }
    fetchArticles();
  }, [supabase, language]);

  const posts: Post[] = [
    {
      title: {
        en: "Algorithmic Integrity: Preventing Look-Ahead Bias & Cheating in AI Backtesting",
        ar: "النزاهة الخوارزمية: منع تحيز النظر للأمام والغش في اختبارات الذكاء الاصطناعي",
      },
      excerpt: {
        en: "A comprehensive audit of our backtesting engine to guarantee zero look-ahead bias, future data leaks, or performance inflation.",
        ar: "تدقيق شامل في محرك الاختبار العكسي لدينا لضمان عدم وجود تحيز للنظر للأمام أو تسرب بيانات مستقبلية أو تضخيم في الأداء.",
      },
      date: "May 29, 2026",
      author: "Security & QA Team",
      category: {
        en: "Core Engineering",
        ar: "الهندسة الأساسية",
      },
      content: {
        en: (
          <div className="space-y-6 text-zinc-850 dark:text-zinc-200 text-sm sm:text-base leading-relaxed">
            <p>
              In algorithmic trading, <strong>&quot;cheating&quot;</strong>{" "}
              (look-ahead bias or future data leakage) is the most common reason
              why strategies perform exceptionally well in simulations but fail
              in live trading. We have conducted a rigorous audit of the{" "}
              <strong>Stokscan AI</strong> backtesting and model training
              systems to guarantee absolute integrity.
            </p>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              1. Predictors & Feature Engineering
            </h3>
            <p>
              All technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands,
              ATR, etc.) and historical memory features (Lags) are computed
              strictly using historical or current close prices. Positive shifts
              (e.g., <code>shift(1)</code>) ensure that today&apos;s model
              predictions only have access to information available up to
              today&apos;s market close. No future data is referenced in feature
              generation.
            </p>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              2. StandardScaler & PCA Pipelines
            </h3>
            <p>
              Data scaling and dimensionality reduction (PCA) are wrapped in our
              custom <code>QuantitativeModelPipeline</code>. The scaler and PCA
              models are fitted <em>only</em> on the training subset. During
              backtest simulations and live scanner operations, they use{" "}
              <code>.transform()</code>, preventing any validation/testing data
              from leaking into the model&apos;s mathematical transforms.
            </p>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              3. Target Labeling & Embargo Purging
            </h3>
            <p>
              We use the <strong>Triple Barrier Method</strong> for training
              labels. While it utilizes a future shift (<code>shift(-1)</code>)
              to determine if a trade will hit its Target Profit (TP) before its
              Stop Loss (SL), this shift is used <em>solely</em> to construct
              target labels (Y) for supervised training.
            </p>
            <p>
              Furthermore, we apply{" "}
              <strong>Purged/Embargo K-Fold Validation</strong>. The training
              sequence is split chronologically, and a gap equal to the trade
              holding period (e.g., 20 days) is deleted at the split boundaries
              to eliminate any overlap or information leakage between train and
              test datasets.
            </p>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              4. Realistic Trade Simulation Loop
            </h3>
            <ul className="list-disc pl-6 space-y-3">
              <li>
                <strong className="text-black dark:text-white">
                  Execution Timing
                </strong>
                : Trades are triggered based on close prices of day{" "}
                <code>i</code> and evaluated starting on day <code>i+1</code>.
                No same-day entry and exit are allowed, reflecting real-world
                execution.
              </li>
              <li>
                <strong className="text-black dark:text-white">
                  Conservative Same-Bar Evaluation
                </strong>
                : If both the Target Profit and Stop Loss levels are breached on
                the same day, the backtester prioritizes the stop-loss first
                (exiting as a loss rather than a win).
              </li>
              <li>
                <strong className="text-black dark:text-white">
                  Trailing Stop Logic
                </strong>
                : Trailing stop updates are calculated at the end of each bar
                and apply only starting on the <em>next</em> bar, eliminating
                same-bar exit bias.
              </li>
            </ul>
          </div>
        ),
        ar: (
          <div className="space-y-6 text-zinc-850 dark:text-zinc-200 text-sm sm:text-base leading-relaxed">
            <p>
              في التداول الخوارزمي، يعد <strong>الاحتيال</strong> (تحيز النظر
              للأمام أو تسرب بيانات مستقبلية) السبب الأكثر شيوعاً لنجاح
              الاستراتيجيات بشكل استثنائي في المحاكاة ثم فشلها في التداول الحي.
              لقد أجرينا تدقيقاً صارماً على أنظمة <strong>Stokscan AI</strong>{" "}
              للاختبار العكسي وتدريب النموذج لضمان سلامة كاملة.
            </p>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              1. المتنبئات وهندسة الميزات
            </h3>
            <p>
              يتم حساب جميع المؤشرات الفنية (SMA، EMA، RSI، MACD، بولينجر باند،
              ATR، إلخ) وميزات الذاكرة التاريخية (Lags) بدقة باستخدام أسعار
              الإغلاق التاريخية أو الحالية فقط. تتحقق التحولات الإيجابية (مثل{" "}
              <code>shift(1)</code>) من أن توقعات النموذج اليوم تحتوي فقط على
              المعلومات المتاحة حتى إغلاق السوق اليوم. لا يتم الرجوع إلى أي
              بيانات مستقبلية عند إنشاء الميزات.
            </p>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              2. مدخلات StandardScaler و PCA
            </h3>
            <p>
              يتم تضمين موازنة البيانات وتقليل الأبعاد (PCA) في خط أنابيبنا
              المخصص <code>QuantitativeModelPipeline</code>. يتم ملاءمة النموذج
              الموازن ونموذج PCA <em>فقط</em> على مجموعة التدريب. أثناء محاكاة
              الاختبار العكسي وتشغيل الماسح المباشر، يستخدمان{" "}
              <code>.transform()</code> فقط، مما يمنع تسرب بيانات
              التحقق/الاختبار إلى التحولات الرياضية للنموذج.
            </p>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              3. تصنيف الأهداف وتنقية الحظر
            </h3>
            <p>
              نستخدم <strong>طريقة الحاجز الثلاثي</strong> لتصنيف الأهداف. بينما
              تستخدم تحولاً مستقبلياً (<code>shift(-1)</code>) لتحديد ما إذا
              كانت الصفقة ستصل إلى هدف الربح (TP) قبل وقف الخسارة (SL)، يستخدم
              هذا التحول <em>فقط</em> لبناء التسميات المستهدفة (Y) للتدريب
              الموجه.
            </p>
            <p>
              علاوة على ذلك، نطبق{" "}
              <strong>التحقق المتقاطع Purged/Embargo</strong>. يتم تقسيم التسلسل
              الزمني للتدريب ترتيبياً، ويتم حذف فجوة مساوية لفترة الاحتفاظ
              بالصفقة (مثلاً 20 يوماً) عند حدود الانقسام لمنع أي تداخل أو تسرب
              للمعلومات بين مجموعات التدريب والاختبار.
            </p>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              4. دورة محاكاة تداول واقعية
            </h3>
            <ul className="list-disc pl-6 space-y-3">
              <li>
                <strong className="text-black dark:text-white">
                  توقيت التنفيذ
                </strong>
                : يتم تفعيل الصفقات اعتماداً على أسعار الإغلاق لليوم{" "}
                <code>i</code> وتقييمها بداية من اليوم <code>i+1</code>. لا
                يُسمح بالدخول والخروج في نفس اليوم، مما يعكس التنفيذ الواقعي.
              </li>
              <li>
                <strong className="text-black dark:text-white">
                  تقييم متحفظ لنفس الشمعة
                </strong>
                : إذا تم كسر هدف الربح ووقف الخسارة في نفس اليوم، يفضل الاختبار
                العكسي وقف الخسارة أولاً (الخروج كخسارة بدلاً من ربح).
              </li>
              <li>
                <strong className="text-black dark:text-white">
                  منطق وقف الخسارة المتحرك
                </strong>
                : يتم حساب تحديثات وقف الخسارة المتحرك في نهاية كل شريط وتطبيقها
                فقط بدءاً من الشريط <em>التالي</em>، مما يلغي تحيز الخروج في نفس
                الشمعة.
              </li>
            </ul>
          </div>
        ),
      },
    },
    {
      title: {
        en: "How AI is Revolutionizing Stock Market Predictions",
        ar: "كيف يغير الذكاء الاصطناعي توقعات سوق الأسهم",
      },
      excerpt: {
        en: "Explore the internal workings of RandomForest models and how they identify non-linear patterns in market data...",
        ar: "استكشف الآليات الداخلية لنماذج RandomForest وكيف تكتشف الأنماط غير الخطية في بيانات السوق...",
      },
      date: "May 15, 2026",
      author: "Dr. Analyst",
      category: {
        en: "AI & Tech",
        ar: "الذكاء الاصطناعي والتقنية",
      },
      content: {
        en: (
          <div className="space-y-6 text-zinc-850 dark:text-zinc-200 text-sm sm:text-base leading-relaxed">
            <p>
              For decades, quantitative traders relied on simple linear
              regressions and moving averages. Today, machine learning
              algorithms like <strong>Random Forest Classifiers</strong> and
              Gradient Boosted Trees (XGBoost, LightGBM) are changing the
              landscape by identifying complex, non-linear relationships in
              multi-dimensional market data.
            </p>
            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              Why Random Forests?
            </h3>
            <p>
              Random Forests work by training hundreds of decision trees on
              random subsets of features and data. Unlike deep neural networks,
              they are highly robust to overfitting, require minimal
              hyperparameter tuning, and provide clear{" "}
              <em>feature importance</em> metrics. This allows analysts to
              understand exactly which indicators (like RSI divergence or volume
              spikes) are driving the model&apos;s predictions.
            </p>
            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              The Multidimensional Advantage
            </h3>
            <p>
              Instead of looking at RSI in isolation, the AI model combines
              fundamentals (P/E ratio, market cap) with technicals and market
              regimes. For example, a model might learn that a 14-day RSI of 25
              is a strong buy signal <em>only</em> if the stock is a mid-cap,
              trading above its 200-day moving average, and market volatility is
              low.
            </p>
          </div>
        ),
        ar: (
          <div className="space-y-6 text-zinc-850 dark:text-zinc-200 text-sm sm:text-base leading-relaxed">
            <p>
              لسنوات، اعتمد المتداولون الكميون على الانحدار الخطي البسيط
              والمتوسطات المتحركة. اليوم، تغير خوارزميات التعلم الآلي مثل{" "}
              <strong>مصنفات الغابة العشوائية</strong> وشجرات التعزيز المتدرج
              (XGBoost، LightGBM) المشهد من خلال اكتشاف العلاقات المعقدة وغير
              الخطية في بيانات السوق متعددة الأبعاد.
            </p>
            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              لماذا الغابات العشوائية؟
            </h3>
            <p>
              تعمل الغابات العشوائية عن طريق تدريب مئات الأشجار القرار على
              مجموعات عشوائية من الميزات والبيانات. بخلاف الشبكات العصبية
              العميقة، فإنها مرنة للغاية في مواجهة الإفراط في التكيف، وتتطلب
              ضبطاً بسيطاً للمعاملات الفائقة، وتوفر مقاييس واضحة لأهمية الميزة.
              هذا يمكّن المحللين من فهم المؤشرات التي تدفع توقعات النموذج
              بالضبط.
            </p>
            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              الميزة متعددة الأبعاد
            </h3>
            <p>
              بدلاً من النظر إلى مؤشر RSI بمعزل عن السياق، يجمع النموذج الذكي
              بين الأساسيات (نسبة السعر إلى الأرباح، القيمة السوقية) والمؤشرات
              الفنية وأنماط السوق. على سبيل المثال، قد يتعلم النموذج أن RSI لمدة
              14 يوماً عند 25 هو إشارة شراء قوية <em>فقط</em> إذا كان السهم من
              الفئة المتوسطة، ويتداول فوق المتوسط المتحرك لمدة 200 يوم، وكان
              تقلب السوق منخفضاً.
            </p>
          </div>
        ),
      },
    },
    {
      title: {
        en: "Understanding Technical Indicators in the Modern Era",
        ar: "فهم المؤشرات الفنية في العصر الحديث",
      },
      excerpt: {
        en: "RSI, MACD, and Bollinger Bands are classic, but are they still relevant when combined with neural networks?",
        ar: "RSI و MACD و Bollinger Bands كلاسيكية، لكن هل لا تزال ذات صلة عند دمجها مع الشبكات العصبية؟",
      },
      date: "May 10, 2026",
      author: "Market Guru",
      category: {
        en: "Analysis",
        ar: "التحليل",
      },
      content: {
        en: (
          <div className="space-y-6 text-zinc-850 dark:text-zinc-200 text-sm sm:text-base leading-relaxed">
            <p>
              RSI, MACD, and Bollinger Bands were created in the era of paper
              charting and manual calculations. While they are still valuable,
              their predictive power increases exponentially when processed by
              modern machine learning models.
            </p>
            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              From Fixed Thresholds to Dynamic Learning
            </h3>
            <p>
              Traditional strategy dictates buying when RSI falls below 30 and
              selling above 70. However, in strong trends, RSI can remain
              overbought or oversold for weeks. AI models do not rely on static
              thresholds. They analyze the rate of change, standard deviations,
              and correlations across multiple timeframes to dynamically adapt
              these indicators to current market regimes.
            </p>
            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              Stacked Indicator Classifiers
            </h3>
            <p>
              By stacking technical indicators, models can identify hidden
              combinations that human traders miss. For instance, the
              convergence of a squeeze in Bollinger Bands (representing low
              volatility) with a MACD histogram crossing zero can signal a
              massive impending breakout. Machine learning classifiers excel at
              mapping these joint probability distributions.
            </p>
          </div>
        ),
        ar: (
          <div className="space-y-6 text-zinc-850 dark:text-zinc-200 text-sm sm:text-base leading-relaxed">
            <p>
              تم إنشاء مؤشرات RSI و MACD و Bollinger Bands في عصر الرسم الورقي
              والحسابات اليدوية. بينما لا تزال ذات قيمة، تزداد قوتها التنبؤية
              بشكل كبير عند معالجتها بواسطة نماذج التعلم الآلي الحديثة.
            </p>
            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              من العتبات الثابتة إلى التعلم الديناميكي
            </h3>
            <p>
              تعتمد الاستراتيجية التقليدية على الشراء عندما ينخفض RSI تحت 30
              والبيع عند تجاوزه 70. ومع ذلك، في الاتجاهات القوية، يمكن أن يبقى
              RSI في منطقة الشراء أو البيع المفرط لأسبوعين. لا تعتمد نماذج
              الذكاء الاصطناعي على العتبات الثابتة. بل تحلل معدل التغير
              والانحراف المعياري والارتباطات عبر أطر زمنية متعددة لتكييف هذه
              المؤشرات ديناميكياً مع ظروف السوق الحالية.
            </p>
            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              مصنفات المؤشرات المكدسة
            </h3>
            <p>
              من خلال تكديس المؤشرات الفنية، يمكن للنماذج اكتشاف تركيبات خفية
              يفوتها المتداولون البشر. على سبيل المثال، قد يشير التقارب بين ضغط
              Bollinger Bands (الذي يمثل تقلباً منخفضاً) وعبور MACD من سعر صفري
              إلى انفجار وشيك كبير. تتفوق مصنفات التعلم الآلي في رسم خرائط هذه
              التوزيعات الاحتمالية المشتركة.
            </p>
          </div>
        ),
      },
    },

    {
      title: {
        en: "🔥 The Real Test: How Our AI Models Survived Egypt's Hardest Market Year (2022)",
        ar: "الاختبار الحقيقي: كيف نجا ذكاؤنا الاصطناعي من أصعب سنة في السوق المصري (2022) 🔥",
      },
      excerpt: {
        en: "When the Egyptian pound collapsed and EGX30 bled, did our AI models preserve capital? We ran the stress test — and the results are surprising.",
        ar: "عندما انهار الجنيه المصري وتراجع مؤشر EGX30، هل حافظت نماذجنا على رأس المال؟ أجرينا اختبار الضغط — والنتائج مفاجئة.",
      },
      date: "June 13, 2026",
      author: "Quant Research Team",
      category: {
        en: "Stress Test",
        ar: "اختبار الضغط",
      },
      content: {
        en: (
          <div className="space-y-6 text-zinc-850 dark:text-zinc-200 text-sm sm:text-base leading-relaxed">
            <p>
              In 2022, Egypt faced one of its most challenging economic periods.
              The Egyptian pound lost nearly <strong>50% of its value</strong>{" "}
              against the dollar, inflation surged above 30%, and the EGX30
              index experienced violent volatility throughout the year. This is
              the environment where most trading strategies quietly fail.
            </p>
            <p>
              We ran a full stress test — a dedicated backtest covering{" "}
              <strong>January 1 to December 31, 2022</strong> — using both of
              our production AI models with adaptive, regime-based exits
              enabled. The question was simple:{" "}
              <em>did our models lose money or preserve capital?</em>
            </p>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              The Results
            </h3>

            <div className="border-4 border-black dark:border-white overflow-hidden my-6">
              <div className="bg-black dark:bg-zinc-800 px-4 py-2 flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#FF605C]" />
                <span className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
                <span className="w-3 h-3 rounded-full bg-[#27C93F]" />
              </div>
              <table className="w-full text-sm font-mono">
                <thead>
                  <tr className="border-b-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900">
                    <th className="px-4 py-3 text-left font-black text-black dark:text-white uppercase text-xs">
                      Model
                    </th>
                    <th className="px-4 py-3 text-center font-black text-black dark:text-white uppercase text-xs">
                      Trades
                    </th>
                    <th className="px-4 py-3 text-center font-black text-black dark:text-white uppercase text-xs">
                      Win Rate
                    </th>
                    <th className="px-4 py-3 text-center font-black text-black dark:text-white uppercase text-xs">
                      Profit %
                    </th>
                    <th className="px-4 py-3 text-center font-black text-black dark:text-white uppercase text-xs">
                      EGX30
                    </th>
                    <th className="px-4 py-3 text-center font-black text-black dark:text-white uppercase text-xs">
                      Capital Safe?
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-zinc-200 dark:border-zinc-700">
                    <td className="px-4 py-3 font-black text-black dark:text-white">
                      model_EGX
                    </td>
                    <td className="px-4 py-3 text-center text-zinc-600 dark:text-zinc-400">
                      20
                    </td>
                    <td className="px-4 py-3 text-center text-emerald-600 dark:text-emerald-400 font-black">
                      50.0%
                    </td>
                    <td className="px-4 py-3 text-center text-emerald-600 dark:text-emerald-400 font-black">
                      +8.1%
                    </td>
                    <td className="px-4 py-3 text-center text-zinc-600 dark:text-zinc-400">
                      +22.6%
                    </td>
                    <td className="px-4 py-3 text-center font-black text-emerald-600 dark:text-emerald-400">
                      ✅ YES
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-black text-black dark:text-white">
                      KING
                    </td>
                    <td className="px-4 py-3 text-center text-zinc-600 dark:text-zinc-400">
                      176
                    </td>
                    <td className="px-4 py-3 text-center text-emerald-600 dark:text-emerald-400 font-black">
                      34.1%
                    </td>
                    <td className="px-4 py-3 text-center text-emerald-600 dark:text-emerald-400 font-black">
                      +28.1%
                    </td>
                    <td className="px-4 py-3 text-center text-zinc-600 dark:text-zinc-400">
                      +22.6%
                    </td>
                    <td className="px-4 py-3 text-center font-black text-emerald-600 dark:text-emerald-400">
                      ✅ YES
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              What This Means
            </h3>
            <p>
              Both models not only preserved capital in 2022 — they{" "}
              <strong>grew it</strong>. The KING model returned{" "}
              <strong>+28.1%</strong>, <em>outperforming</em> the EGX30
              benchmark (+22.6%) by <strong>+5.5 percentage points</strong>. The
              model_EGX model returned <strong>+8.1%</strong> with an
              exceptionally high win rate of 50%, using only 20 carefully
              selected trades.
            </p>
            <p>
              This is the key distinction: in a bull market, almost any strategy
              works. The real test is whether a model can{" "}
              <strong>
                navigate uncertainty, currency devaluation, and volatile
                sentiment
              </strong>{" "}
              without destroying capital. Ours did.
            </p>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              Why the models held up
            </h3>
            <ul className="list-disc pl-6 space-y-3">
              <li>
                <strong className="text-black dark:text-white">
                  Regime Detection:
                </strong>{" "}
                Our adaptive exit system identifies whether the market is in
                BULL, SIDEWAYS, or BEAR mode and adjusts take-profit and
                stop-loss levels accordingly. In 2022's turbulence, this
                prevented chasing large moves that reversed violently.
              </li>
              <li>
                <strong className="text-black dark:text-white">
                  High-confidence signals only:
                </strong>{" "}
                The model_EGX model uses a confidence threshold of 0.60 — it
                only enters a trade when the AI is strongly certain. This
                resulted in just 20 trades in a full year, but 50% of them were
                winners.
              </li>
              <li>
                <strong className="text-black dark:text-white">
                  Trained on EGX-specific patterns:
                </strong>{" "}
                Unlike generic models trained on global indices, our models are
                trained exclusively on Egyptian Exchange data, including the
                behavioral patterns of local retail investors and institutional
                flows.
              </li>
            </ul>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              Conclusion
            </h3>
            <p>
              The 2022 stress test provides the most honest evidence of our
              models' robustness. When the going got tough, the AI didn't panic.
              It selected high-quality opportunities, protected capital with
              calibrated exits, and delivered real returns in a year when most
              retail investors were deep in the red. That's not luck — that's
              engineering.
            </p>
          </div>
        ),
        ar: (
          <div className="space-y-6 text-zinc-850 dark:text-zinc-200 text-sm sm:text-base leading-relaxed">
            <p>
              في عام 2022، واجهت مصر واحدة من أصعب فتراتها الاقتصادية. فقد
              الجنيه المصري ما يقارب <strong>50% من قيمته</strong> أمام الدولار،
              وتجاوز التضخم 30%، وشهد مؤشر EGX30 تقلبات عنيفة طوال العام. هذه هي
              البيئة التي تفشل فيها معظم استراتيجيات التداول بصمت.
            </p>
            <p>
              أجرينا اختبار ضغط كامل — backtest مخصص يغطي{" "}
              <strong>من 1 يناير إلى 31 ديسمبر 2022</strong> — باستخدام كلا
              نموذجينا الإنتاجيين مع تفعيل الخروج التكيفي القائم على حالة السوق.
              السؤال كان بسيطاً:{" "}
              <em>هل خسرت نماذجنا أموالاً أم حافظت على رأس المال؟</em>
            </p>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              النتائج
            </h3>

            <div className="border-4 border-black dark:border-white overflow-hidden my-6">
              <div className="bg-black dark:bg-zinc-800 px-4 py-2 flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#FF605C]" />
                <span className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
                <span className="w-3 h-3 rounded-full bg-[#27C93F]" />
              </div>
              <table className="w-full text-sm font-mono">
                <thead>
                  <tr className="border-b-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900">
                    <th className="px-4 py-3 text-left font-black text-black dark:text-white uppercase text-xs">
                      الموديل
                    </th>
                    <th className="px-4 py-3 text-center font-black text-black dark:text-white uppercase text-xs">
                      الصفقات
                    </th>
                    <th className="px-4 py-3 text-center font-black text-black dark:text-white uppercase text-xs">
                      نسبة النجاح
                    </th>
                    <th className="px-4 py-3 text-center font-black text-black dark:text-white uppercase text-xs">
                      الربح %
                    </th>
                    <th className="px-4 py-3 text-center font-black text-black dark:text-white uppercase text-xs">
                      EGX30
                    </th>
                    <th className="px-4 py-3 text-center font-black text-black dark:text-white uppercase text-xs">
                      رأس المال آمن؟
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-zinc-200 dark:border-zinc-700">
                    <td className="px-4 py-3 font-black text-black dark:text-white">
                      model_EGX
                    </td>
                    <td className="px-4 py-3 text-center text-zinc-600 dark:text-zinc-400">
                      20
                    </td>
                    <td className="px-4 py-3 text-center text-emerald-600 dark:text-emerald-400 font-black">
                      50.0%
                    </td>
                    <td className="px-4 py-3 text-center text-emerald-600 dark:text-emerald-400 font-black">
                      +8.1%
                    </td>
                    <td className="px-4 py-3 text-center text-zinc-600 dark:text-zinc-400">
                      +22.6%
                    </td>
                    <td className="px-4 py-3 text-center font-black text-emerald-600 dark:text-emerald-400">
                      ✅ نعم
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-black text-black dark:text-white">
                      KING
                    </td>
                    <td className="px-4 py-3 text-center text-zinc-600 dark:text-zinc-400">
                      176
                    </td>
                    <td className="px-4 py-3 text-center text-emerald-600 dark:text-emerald-400 font-black">
                      34.1%
                    </td>
                    <td className="px-4 py-3 text-center text-emerald-600 dark:text-emerald-400 font-black">
                      +28.1%
                    </td>
                    <td className="px-4 py-3 text-center text-zinc-600 dark:text-zinc-400">
                      +22.6%
                    </td>
                    <td className="px-4 py-3 text-center font-black text-emerald-600 dark:text-emerald-400">
                      ✅ نعم
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              ماذا تعني هذه النتائج؟
            </h3>
            <p>
              لم يكتفِ الموديلان بالحفاظ على رأس المال في 2022 — بل{" "}
              <strong>نمّياه</strong>. حقق موديل KING عائداً بلغ{" "}
              <strong>+28.1%</strong>، متجاوزاً مؤشر EGX30 (+22.6%) بفارق{" "}
              <strong>+5.5 نقطة مئوية</strong>. بينما حقق model_EGX عائداً بلغ{" "}
              <strong>+8.1%</strong> مع نسبة نجاح استثنائية 50%، مستخدماً 20
              صفقة مختارة بعناية فقط.
            </p>
            <p>
              هذا هو الفرق الجوهري: في سوق الثيران، تنجح أي استراتيجية تقريباً.
              الاختبار الحقيقي هو ما إذا كان الموديل قادراً على{" "}
              <strong>
                التعامل مع حالة عدم اليقين، وانهيار العملة، والمشاعر المتقلبة
              </strong>{" "}
              دون تدمير رأس المال. نماذجنا نجحت في ذلك.
            </p>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              لماذا صمدت النماذج؟
            </h3>
            <ul className="list-disc pl-6 space-y-3">
              <li>
                <strong className="text-black dark:text-white">
                  الكشف عن حالة السوق (Regime Detection):
                </strong>{" "}
                يحدد نظام الخروج التكيفي لدينا ما إذا كان السوق في وضع ثور أو
                تذبذب أو دب، ويضبط مستويات جني الأرباح ووقف الخسارة وفقاً لذلك.
                في اضطرابات 2022، أدى ذلك إلى تجنب ملاحقة التحركات الكبيرة التي
                انعكست بعنف.
              </li>
              <li>
                <strong className="text-black dark:text-white">
                  إشارات الثقة العالية فقط:
                </strong>{" "}
                يستخدم موديل model_EGX عتبة ثقة تبلغ 0.60 — لا يدخل صفقة إلا
                عندما يكون الذكاء الاصطناعي واثقاً بشكل كبير. أسفر ذلك عن 20
                صفقة فقط في عام كامل، لكن 50% منها كانت رابحة.
              </li>
              <li>
                <strong className="text-black dark:text-white">
                  تدريب خاص ببورصة EGX:
                </strong>{" "}
                على عكس النماذج العامة المدربة على المؤشرات العالمية، تم تدريب
                نماذجنا حصرياً على بيانات البورصة المصرية، بما في ذلك الأنماط
                السلوكية للمستثمرين الأفراد والمؤسسيين.
              </li>
            </ul>

            <h3 className="text-lg font-black text-black dark:text-white uppercase italic mt-6 border-b-2 border-black dark:border-white pb-1 inline-block">
              الخلاصة
            </h3>
            <p>
              يقدم اختبار ضغط 2022 أصدق دليل على متانة نماذجنا. عندما اشتدت
              الأمور، لم يتذعر الذكاء الاصطناعي. بل اختار الفرص عالية الجودة،
              وحمى رأس المال بخروج مُعيَّر، وحقق عوائد حقيقية في سنة كان فيها
              معظم المستثمرين الأفراد في خسارة عميقة. هذا ليس حظاً — إنه هندسة.
            </p>
          </div>
        ),
      },
    },
  ];

  const openPost = (post: Post) => {
    setSelectedPost(post);
  };

  const allPosts = [...dbPosts, ...posts];

  return (
    <div className="neobrutal-layout flex flex-col gap-12 pb-20 pt-2 relative -mx-3 sm:-mx-6 md:-mx-8 px-4 md:px-8 min-h-screen neobrutal-grid-bg">
      {/* Header section */}
      <header className="space-y-4 max-w-3xl pt-8">
        <div className="inline-flex items-center gap-2 border-4 border-black dark:border-white px-4 py-2 neobrutal-bg-yellow font-black text-xs sm:text-sm uppercase tracking-widest rotate-[-1deg] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] hover:rotate-0 transition-transform duration-200 cursor-pointer">
          <BookOpen className="w-4 h-4 text-black" />
          <span className="text-black">{t("blogs.label")}</span>
        </div>
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tighter text-black dark:text-white uppercase drop-shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:drop-shadow-[4px_4px_0px_rgba(255,255,255,0.15)] pt-2">
          {t("blogs.heading")}
        </h1>
        <p className="text-zinc-800 dark:text-zinc-300 text-base sm:text-lg max-w-2xl font-bold leading-relaxed">
          {t("blogs.description")}
        </p>
      </header>

      {/* Blogs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {dbLoading && dbPosts.length === 0 && (
          <div className="lg:col-span-3 flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-black dark:border-white border-t-transparent dark:border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
        {allPosts.map((post, i) => (
          <div
            key={i}
            onClick={() => openPost(post)}
            className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 flex flex-col overflow-hidden shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all duration-200 cursor-pointer group"
          >
            {/* OS Window header */}
            <div className="border-b-4 border-black dark:border-white px-4 py-3 bg-black dark:bg-zinc-800 flex justify-between items-center text-white select-none">
              <span className="font-mono text-[10px] font-black uppercase tracking-widest text-white">
                {post.category[language]}
              </span>
              <div className="flex gap-1.5">
                <span className="w-3.5 h-3.5 rounded-full bg-[#FF605C] border-2 border-black dark:border-white"></span>
                <span className="w-3.5 h-3.5 rounded-full bg-[#FFBD2E] border-2 border-black dark:border-white"></span>
                <span className="w-3.5 h-3.5 rounded-full bg-[#27C93F] border-2 border-black dark:border-white"></span>
              </div>
            </div>

            {/* Card Content Body */}
            <div className="p-6 flex-1 flex flex-col bg-white dark:bg-zinc-950 text-black dark:text-zinc-100">
              <div className="flex items-center gap-2 text-[10px] text-zinc-600 dark:text-zinc-400 font-bold uppercase tracking-widest mb-4">
                <Calendar className="w-3.5 h-3.5" />
                <span>{post.date}</span>
              </div>

              <h2 className="text-xl font-black mb-3 leading-snug tracking-tight text-black dark:text-white group-hover:underline">
                {post.title[language]}
              </h2>

              <p className="text-sm text-zinc-750 dark:text-zinc-350 mb-6 flex-1 leading-relaxed font-semibold">
                {post.excerpt[language]}
              </p>

              <div className="mt-auto pt-4 border-t-4 border-black dark:border-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 border-2 border-black dark:border-white neobrutal-bg-yellow flex items-center justify-center text-[11px] font-black text-black">
                    {post.author[0]}
                  </div>
                  <span className="text-[10px] font-black text-black dark:text-white uppercase tracking-widest">
                    {post.author}
                  </span>
                </div>

                <span className="p-2 border-2 border-black dark:border-white bg-black dark:bg-zinc-800 text-white flex items-center justify-center hover:translate-x-0.5 hover:translate-y-0.5 transition-transform">
                  <ArrowRight
                    className={`w-4 h-4 ${isAr ? "rotate-180" : ""}`}
                  />
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal for viewing the full post */}
      {selectedPost && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 md:p-8 z-[9999] animate-in fade-in duration-300"
          onClick={() => setSelectedPost(null)}
        >
          <div
            className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 max-w-4xl w-full max-h-[90vh] flex flex-col relative shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] dark:shadow-[10px_10px_0px_0px_rgba(255,255,255,1)] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* OS Window header */}
            <div className="border-b-4 border-black dark:border-white px-4 py-4 bg-black dark:bg-zinc-800 flex justify-between items-center text-white select-none">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-white">
                {selectedPost.category[language]}
              </span>
              <button
                onClick={() => setSelectedPost(null)}
                className="p-1.5 border-2 border-white bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all cursor-pointer"
                aria-label={t("blogs.close")}
              >
                <X className="w-4 h-4 text-white font-black" />
              </button>
            </div>

            {/* Modal Body Scroll Container */}
            <div className="p-6 md:p-8 overflow-y-auto flex-1 custom-scrollbar bg-white dark:bg-zinc-950 text-black dark:text-zinc-100">
              {/* Meta Info */}
              <div className="flex items-center gap-3 text-[11px] text-zinc-600 dark:text-zinc-400 font-bold uppercase tracking-widest mb-4">
                <Calendar className="w-4 h-4" />
                <span>{selectedPost.date}</span>
              </div>

              {/* Title */}
              <h2 className="text-2xl md:text-4xl font-black text-black dark:text-white tracking-tight leading-tight mb-6">
                {selectedPost.title[language]}
              </h2>

              {/* Author */}
              <div className="flex items-center gap-3 pb-6 border-b-4 border-black dark:border-white mb-6">
                <div className="w-8 h-8 border-2 border-black dark:border-white neobrutal-bg-yellow flex items-center justify-center text-xs font-black text-black">
                  {selectedPost.author[0]}
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-black dark:text-white uppercase tracking-widest leading-none">
                    {selectedPost.author}
                  </span>
                  <span className="text-[9px] text-zinc-500 dark:text-zinc-400 font-black uppercase tracking-widest mt-1">
                    {t("blogs.author")}
                  </span>
                </div>
              </div>

              {/* Full Content */}
              <div className="prose dark:prose-invert max-w-none">
                {selectedPost.content[language]}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Newsletter Subscription Banner */}
      <section className="mt-12 border-4 border-black dark:border-white bg-[#fb923c] dark:bg-amber-500 p-8 sm:p-12 text-center space-y-6 relative overflow-hidden shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[10px_10px_0px_0px_rgba(255,255,255,1)] transition-all duration-200 cursor-pointer">
        <div className="w-14 h-14 border-4 border-black neobrutal-bg-yellow flex items-center justify-center mx-auto shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
          <Send className="w-7 h-7 text-black" />
        </div>

        <h2 className="text-3xl font-black text-black uppercase tracking-tight">
          Stay Updated
        </h2>
        <p className="text-black max-w-lg mx-auto text-sm sm:text-base font-extrabold leading-relaxed">
          Subscribe to our newsletter to receive the latest market insights and
          algorithmic predictions directly in your inbox.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 max-w-md mx-auto pt-2">
          <input
            type="email"
            placeholder="your@email.com"
            className="flex-1 h-14 border-4 border-black bg-white px-5 text-base font-bold text-black outline-none shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] focus:bg-yellow-50 transition-all placeholder:text-zinc-400"
          />
          <button className="h-14 px-8 border-4 border-black bg-black text-white text-xs font-black uppercase tracking-widest hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100 cursor-pointer flex items-center justify-center">
            Subscribe
          </button>
        </div>
      </section>
    </div>
  );
}
