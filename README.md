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

---

### 3️⃣ رفع الكود لـ HuggingFace Space (الطريقة الصحيحة)

> ⚠️ **مهم:** `git push hf main` **لا يعمل** بسبب قيود HuggingFace على ملفات الـ binary (`.pkl` models) — المنصة بقت ترفض LFS وتطلب نظام Xet الجديد. لذلك نستخدم **HuggingFace Hub Python API** لرفع ملفات الكود مباشرة بدون أي مشاكل.

#### المتطلبات
```powershell
pip install huggingface_hub
```

#### الخطوات

**0. عيّن الـ HuggingFace Token (مرة واحدة لكل session):**
```powershell
# PowerShell
$env:HF_TOKEN = "hf_your_token_here"
```

**1. عدّل ملف `deploy_to_hf.py`** (موجود في جذر المشروع بعد أول استخدام)، وحدّد الملفات التي تغيرت في `FILES_TO_UPLOAD`:

```python
FILES_TO_UPLOAD = [
    "api/daily_bot_run.py",         # ← ملفات Python الخلفية
    "api/free_data_provider.py",
    "api/main.py",
    "api/stock_ai.py",
    "web/src/app/api/scan/news/route.ts",    # ← Next.js API routes
    "web/src/app/api/admin/support/chats/route.ts",
    # أضف أي ملفات تغيرت...
]
```

**2. شغّل السكريبت:**
```powershell
python deploy_to_hf.py
```

**3. النتيجة المتوقعة:**
```
Uploading 16 files to weeasdwee/AI_BOT...
  OK: api/daily_bot_run.py
  OK: api/free_data_provider.py
  ...
Done: 16 uploaded, 0 failed.
```

#### الـ Workflow الكامل (GitHub + HuggingFace)

```powershell
# 1. Commit وارفع على GitHub كالمعتاد
git add -A
git commit -m "feat: your changes"
git push origin main

# 2. ارفع التغييرات لـ HuggingFace Space عبر Hub API
python deploy_to_hf.py
```

> 💡 **ملاحظة:** ملفات الـ Models (`.pkl`) والـ `symbols_data/` **لا تحتاج رفع** — هي موجودة بالفعل على HuggingFace من الـ deploy السابق وبتتولد تلقائياً وقت التشغيل.


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
