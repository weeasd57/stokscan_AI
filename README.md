---
title: AI BOT
emoji: 🤖
colorFrom: blue
colorTo: green
sdk: docker
pinned: false
---

# Artoro

Advanced AI-driven stock analysis platform. Combining RandomForest models with multi-source fundamentals to give you the edge.

![Dashboard Preview](docs/dashboard.png)

## 🚀 Key Features

### 🧠 AI Scanner
- **Market-wide Analysis**: Scans thousands of stocks across multiple exchanges (US, EGX, UK, etc.).
- **Machine Learning**: Uses Random Forest classification to predict next-day price movement.
- **Backtesting Precision**: Displays historical precision for each stock (~60-80% accuracy).
- **Customizable Models**: Advanced users can tweak Random Forest parameters (trees, depth, split).

### 📈 Technical Scanner
- **Real-time Filters**: Filter by RSI, MACD, EMA Crossovers, Bollinger Bands, and more.
- **Smart Screener**: Find stocks in "oversold" or "overbought" conditions with momentum confirmation.
- **Visual Analysis**: Built-in interactive charts (Candlestick/Area) with overlay indicators.

### ⚖️ Comparison Tool
- **Side-by-Side Analysis**: Compare multiple stocks on key performance indicators.
- **Win Rate Statistics**: See historical win rates for individual indicators (e.g., "How often does RSI < 30 lead to profit for Apple?").

### 💼 Portfolio & Watchlist
- **Track Positions**: Save interesting stocks to your watchlist.
- **Performance Tracking**: Monitor the "AI Signal" vs "Actual Price" for your saved symbols.

## 🛠️ Technology Stack

- **Frontend**: Next.js 14 (App Router), React, TailwindCSS, Lucide Icons.
- **Backend API**: Python (FastAPI), Pandas, Scikit-Learn.
- **Database**: Supabase (PostgreSQL).
- **Data Source**: EODHD API / TradingView (via custom scrapers).

## 📊 Code Statistics (إحصائيات الكود)

```
Extension          Files                Lines
=======================================================
.py                   82               44,386
.tsx                  83               35,306
.json               2635               21,557
.md                   19                9,216
.ts                   31                3,336
.css                   1                  784
.sql                   1                  357
.js                    4                  187
.yml                   3                  115
.html                  2                   76
.txt                   3                   45
=======================================================
TOTAL               2864              115,365
```

## ⚡ Getting Started (تشغيل المشروع محلياً)

### Prerequisites (المتطلبات الأساسية)
- Node.js 18+
- Python 3.10+
- Supabase Account

---

### 💻 Local Run Commands (أوامر تشغيل السيرفرات محلياً)

يمكنك تشغيل المشروع من المجلد الرئيسي للمستودع (Root Directory) مباشرة كالتالي:

#### 1️⃣ تشغيل السيرفر الخلفي (Python Backend Server)
لتفعيل البيئة الافتراضية وتشغيل سيرفر FastAPI:
```powershell

# تشغيل سيرفر الـ FastAPI
.\venv\Scripts\python -m uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
```

#### 2️⃣ تشغيل واجهة المستخدم (Next.js Frontend)
في نافذة تيرمينال منفصلة، قم بتشغيل خادم التطوير لواجهة المستخدم:
```bash
# من المجلد الرئيسي مباشرة (Root Directory)
npm run web:dev
```
*(أو بالدخول لمجلد الويب):*
```bash
cd web
npm run dev
```

---

### 🏋️‍♂️ Model Training (تدريب موديل الذكاء الاصطناعي محلياً)
لتشغيل سكربت التدريب يدوياً لسوق معين (مثل السوق المصري EGX):
```powershell
.\venv\Scripts\python -u -m api.train_exchange_model --exchange EGX
```

## 🚀 Deployment Architecture

This project uses a **Split Deployment Strategy** to optimize performance and overcome platform limitations:

### 1. Frontend (Vercel)
- **Hosted on**: [Vercel](https://vercel.com)
- **Reason**: Best-in-class performance for Next.js, Edge Network, and SEO.
- **Configuration**: Uses standard Vercel auto-detection for Next.js in the `web/` directory.

## 🌍 Supported Markets
- **US** (NYSE, NASDAQ, AMEX)
- **Egypt** (EGX)
- **UK** (LSE)
- **France** (Euronext)
- And 50+ other global exchanges.

## 🏛️ Council Validator (Meta-Model)

This repo also supports training a lightweight validator that learns when a base model’s BUY candidates tend to fail, then blocks those trades.

- Train: `py train_council.py --primary-model "api/models/KING 👑.pkl"`
- Use in backtest: `py api/backtest_radar.py --exchange EGX --model "collector 🎁.pkl" --validator "The_Council_Validator.pkl"`


## 🚀 Deployment Commands (أوامر الرفع للسيرفرات)

تنقسم عملية رفع ونشر المشروع إلى قسمين رئيسيين (الواجهة الأمامية والخلفية):

### 1️⃣ الواجهة الأمامية - Frontend (Vercel)
يتم رفع الفرونت إند المكتوب بـ Next.js إلى منصة Vercel:
```powershell
# 1. الدخول إلى مجلد الويب
cd web

# 2. تسجيل الدخول إلى Vercel (لأول مرة فقط)
npx vercel login

# 3. رفع نسخة التطوير للتجربة
npx vercel

# 4. رفع النسخة النهائية للموقع (Production)
npx vercel --prod
```

### 2️⃣ التشغيل اليومي - Daily Automation (Hugging Face + Supabase)

> ⚠️ **ملاحظة مهمة:** Hugging Face مستخدم كـ worker يومي فقط لحساب البيانات ورفع النتائج إلى Supabase. المستخدمون لا يتصلون بـ Hugging Face مباشرة، وكل طلبات الموقع تمر عبر Vercel وتقرأ من Supabase.

#### Vercel + Supabase
```powershell
# الواجهة والـ API routes العامة تعمل على Vercel فقط
# لا تضف أي متغير backend خارجي في Vercel Environment Variables
# تأكد من وجود NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY
```

#### Hugging Face Daily Worker
```powershell
# يستخدم لتشغيل run_daily_bot_job.py مرة يومياً فقط
# الهدف: حساب المؤشرات والـ AI scores ثم تخزين النتائج في Supabase
# لا يتم استخدامه كـ user-facing backend
```


## 🤝 Contributing
Contributions are welcome! Please create a Pull Request for any bug fixes or new features.

## 📄 License
MIT License.
الإعداد	🛡️ الدفاعي (Defensive)	🔄 الهجين (Hybrid)	⚔️ الهجومي (Aggressive)
صعوبة دخول KING	أصعب بـ +0.10	طبيعي (0.0)	أسهل بـ -0.10
صعوبة دخول COUNCIL	أصعب بـ +0.05	طبيعي (0.0)	أسهل بـ -0.05
فلتر السيولة (Volume)	صارم جداً (1.5x)	مرن (0.7x)	مرن جداً (0.3x)
فلتر الاتجاه (SMA20)	مفعل دائماً	مفعل	معطل (يخترق الترند)
أدنى جودة للإشارة	75% فأعلى	55% فأعلى	50% فأعلى
حجم الصفقة (Sideways)	مُخفض جداً (30%)	مُخفض (70%)	كامل (100%)
حجم الصفقة (BEAR)	صفر (لا يتداول)	مُخفض جداً (30%)	نصف حجم (50%)
