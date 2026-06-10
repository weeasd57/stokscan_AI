"use client";

import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import { 
  Brain, 
  BarChart3, 
  Bot, 
  Zap,
  ArrowRight,
  CheckCircle2,
  Smartphone,
  Cpu
} from "lucide-react";

export default function HomePage() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { theme } = useTheme();
  const isAr = language === "ar";
  const isDark = theme === "dark";

  return (
    <div className={`min-h-screen relative overflow-hidden ${isDark ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white' : 'bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 text-slate-900'}`} dir={isAr ? "rtl" : "ltr"}>
      
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className={`absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl opacity-30 animate-pulse ${isDark ? 'bg-blue-500' : 'bg-blue-300'}`} />
        <div className={`absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl opacity-30 animate-pulse delay-1000 ${isDark ? 'bg-purple-500' : 'bg-purple-300'}`} />
        <div className={`absolute top-1/2 left-1/2 w-96 h-96 rounded-full blur-3xl opacity-20 animate-pulse delay-2000 ${isDark ? 'bg-indigo-500' : 'bg-indigo-300'}`} />
      </div>
      
      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-6 py-32 text-center relative z-10">
        <div className="mb-12 flex items-center justify-center gap-4 animate-fade-in-up">
          <div className={`relative ${isDark ? 'bg-slate-800/50' : 'bg-white/70'} backdrop-blur-xl rounded-2xl p-4 shadow-2xl border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
            <Image
              src="/favicon_io/favicon.ico"
              alt="EGX Bots logo"
              width={48}
              height={48}
              className="object-contain rounded-lg"
              priority
            />
          </div>
          <h1 className={`text-4xl md:text-5xl font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>EGX BOTS</h1>
        </div>

        <div className="animate-fade-in-up delay-200">
          <h2 className={`text-5xl md:text-7xl font-black mb-6 leading-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {isAr ? "تداول بذكاء" : "Trade Smart"}
            <br />
            <span className={`bg-gradient-to-r ${isDark ? 'from-blue-400 via-purple-400 to-pink-400' : 'from-blue-600 via-purple-600 to-pink-600'} bg-clip-text text-transparent animate-gradient-x`}>
              {isAr ? "مع الذكاء الاصطناعي" : "With AI"}
            </span>
          </h2>

          <p className={`text-xl mb-12 max-w-2xl mx-auto leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {isAr 
              ? "منصة تحليل أسهم متطورة تستخدم نماذج التعلم الآلي للتنبؤ بحركات السوق وتوليد إشارات شراء دقيقة في الوقت الفعلي"
              : "An advanced stock analysis platform using machine learning models to predict market movements and generate precise buy signals in real-time"
            }
          </p>

          <div className="flex gap-6 justify-center flex-wrap animate-fade-in-up delay-400">
            <Link 
              href={user ? "/scanner/backtests?tab=bots" : "/signup"}
              className={`group px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 rounded-xl font-bold text-lg transition-all duration-300 transform hover:scale-105 hover:shadow-2xl flex items-center gap-2 text-white shadow-lg`}
            >
              {user ? (isAr ? "ابدأ الآن" : "Get Started") : (isAr ? "إنشاء حساب مجاني" : "Create Free Account")}
              <ArrowRight className={`w-5 h-5 transition-transform group-hover:translate-x-1 ${isAr ? "rotate-180 group-hover:-translate-x-1" : ""}`} />
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className={`max-w-6xl mx-auto px-6 py-24 border-t ${isDark ? 'border-white/10' : 'border-slate-200'} relative z-10`}>
        <h2 className={`text-4xl font-black text-center mb-16 ${isDark ? 'text-white' : 'text-slate-900'}`}>
          {isAr ? "كيف يعمل؟" : "How It Works?"}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Step 1 */}
          <div className={`${isDark ? 'bg-slate-800/50 backdrop-blur-xl border-white/10 hover:border-blue-500/50 hover:bg-slate-800/70' : 'bg-white/70 backdrop-blur-xl border-slate-200 hover:border-blue-500/50 hover:bg-white/90 shadow-lg'} border rounded-xl p-8 transition-all duration-300 transform hover:scale-105 hover:shadow-2xl`}>
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center mb-6 text-2xl font-black text-white shadow-lg">1</div>
            <h3 className={`text-xl font-bold mb-4 ${isDark ? 'text-white' : 'text-slate-900'}`}>
              {isAr ? "اختر استراتيجية" : "Choose Strategy"}
            </h3>
            <p className={isDark ? 'text-slate-400' : 'text-slate-600'}>
              {isAr 
                ? "اختر من نماذج AI متقدمة (NANO, KING) أو أنشئ استراتيجية خاصة بك"
                : "Select from advanced AI models (NANO, KING) or create your own strategy"
              }
            </p>
          </div>

          {/* Step 2 */}
          <div className={`${isDark ? 'bg-slate-800/50 backdrop-blur-xl border-white/10 hover:border-blue-500/50 hover:bg-slate-800/70' : 'bg-white/70 backdrop-blur-xl border-slate-200 hover:border-blue-500/50 hover:bg-white/90 shadow-lg'} border rounded-xl p-8 transition-all duration-300 transform hover:scale-105 hover:shadow-2xl`}>
            <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center mb-6 text-2xl font-black text-white shadow-lg">2</div>
            <h3 className={`text-xl font-bold mb-4 ${isDark ? 'text-white' : 'text-slate-900'}`}>
              {isAr ? "اختبر على بيانات تاريخية" : "Backtest History"}
            </h3>
            <p className={isDark ? 'text-slate-400' : 'text-slate-600'}>
              {isAr 
                ? "اختبر أداء استراتيجيتك على سنوات من البيانات التاريخية قبل التداول الفعلي"
                : "Test your strategy on years of historical data before trading live"
              }
            </p>
          </div>

          {/* Step 3 */}
          <div className={`${isDark ? 'bg-slate-800/50 backdrop-blur-xl border-white/10 hover:border-blue-500/50 hover:bg-slate-800/70' : 'bg-white/70 backdrop-blur-xl border-slate-200 hover:border-blue-500/50 hover:bg-white/90 shadow-lg'} border rounded-xl p-8 transition-all duration-300 transform hover:scale-105 hover:shadow-2xl`}>
            <div className="w-16 h-16 bg-gradient-to-br from-pink-500 to-orange-600 rounded-xl flex items-center justify-center mb-6 text-2xl font-black text-white shadow-lg">3</div>
            <h3 className={`text-xl font-bold mb-4 ${isDark ? 'text-white' : 'text-slate-900'}`}>
              {isAr ? "استقبل إشارات فورية" : "Get Alerts"}
            </h3>
            <p className={isDark ? 'text-slate-400' : 'text-slate-600'}>
              {isAr 
                ? "استقبل إشارات شراء/بيع مباشرة على هاتفك عبر تليجرام"
                : "Receive buy/sell signals directly on your phone via Telegram"
              }
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className={`max-w-6xl mx-auto px-6 py-24 border-t ${isDark ? 'border-white/10' : 'border-slate-200'} relative z-10`}>
        <h2 className={`text-4xl font-black text-center mb-16 ${isDark ? 'text-white' : 'text-slate-900'}`}>
          {isAr ? "المميزات الرئيسية" : "Key Features"}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          {/* Feature 1 */}
          <div className={`flex gap-6 p-6 rounded-xl ${isDark ? 'bg-slate-800/30 hover:bg-slate-800/50' : 'bg-white/50 hover:bg-white/70'} backdrop-blur-sm transition-all duration-300 hover:scale-105`}>
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0 text-white shadow-lg">
              <Brain className="w-6 h-6" />
            </div>
            <div>
              <h3 className={`text-xl font-bold mb-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                {isAr ? "نماذج AI متقدمة" : "Advanced AI Models"}
              </h3>
              <p className={isDark ? 'text-slate-400' : 'text-slate-600'}>
                {isAr 
                  ? "نماذج Random Forest وLightGBM تعطيك دقة عالية في التنبؤات"
                  : "Random Forest and LightGBM models for high-precision predictions"
                }
              </p>
            </div>
          </div>

          {/* Feature 2 */}
          <div className={`flex gap-6 p-6 rounded-xl ${isDark ? 'bg-slate-800/30 hover:bg-slate-800/50' : 'bg-white/50 hover:bg-white/70'} backdrop-blur-sm transition-all duration-300 hover:scale-105`}>
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center flex-shrink-0 text-white shadow-lg">
              <BarChart3 className="w-6 h-6" />
            </div>
            <div>
              <h3 className={`text-xl font-bold mb-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                {isAr ? "تحليل تاريخي دقيق" : "Precise Backtesting"}
              </h3>
              <p className={isDark ? 'text-slate-400' : 'text-slate-600'}>
                {isAr 
                  ? "محاكاة واقعية لأداء الاستراتيجيات على سنوات من البيانات"
                  : "Realistic simulation of strategies on years of historical data"
                }
              </p>
            </div>
          </div>

          {/* Feature 3 */}
          <div className={`flex gap-6 p-6 rounded-xl ${isDark ? 'bg-slate-800/30 hover:bg-slate-800/50' : 'bg-white/50 hover:bg-white/70'} backdrop-blur-sm transition-all duration-300 hover:scale-105`}>
            <div className="w-12 h-12 bg-gradient-to-br from-pink-500 to-orange-600 rounded-xl flex items-center justify-center flex-shrink-0 text-white shadow-lg">
              <Smartphone className="w-6 h-6" />
            </div>
            <div>
              <h3 className={`text-xl font-bold mb-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                {isAr ? "تنبيهات تليجرام" : "Telegram Alerts"}
              </h3>
              <p className={isDark ? 'text-slate-400' : 'text-slate-600'}>
                {isAr 
                  ? "استقبل إشارات الشراء فوراً على هاتفك دون الحاجة للمتابعة المستمرة"
                  : "Get buy signals instantly on your phone without constant monitoring"
                }
              </p>
            </div>
          </div>

          {/* Feature 4 */}
          <div className={`flex gap-6 p-6 rounded-xl ${isDark ? 'bg-slate-800/30 hover:bg-slate-800/50' : 'bg-white/50 hover:bg-white/70'} backdrop-blur-sm transition-all duration-300 hover:scale-105`}>
            <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl flex items-center justify-center flex-shrink-0 text-white shadow-lg">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h3 className={`text-xl font-bold mb-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                {isAr ? "بوتات مؤتمتة" : "Automated Bots"}
              </h3>
              <p className={isDark ? 'text-slate-400' : 'text-slate-600'}>
                {isAr 
                  ? "بوتات ذكية تتداول تلقائياً بناءً على إشاراتك"
                  : "Smart bots that trade automatically based on your signals"
                }
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className={`max-w-6xl mx-auto px-6 py-24 border-t ${isDark ? 'border-white/10' : 'border-slate-200'} text-center relative z-10`}>
        <div className={`${isDark ? 'bg-slate-800/50 backdrop-blur-xl border-white/10' : 'bg-white/70 backdrop-blur-xl border-slate-200 shadow-2xl'} border rounded-3xl p-12 md:p-16 mx-auto max-w-4xl`}>
          <h2 className={`text-4xl font-black mb-6 ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {isAr ? "جاهز للبدء؟" : "Ready to Get Started?"}
          </h2>
          <p className={`text-xl mb-12 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {isAr 
              ? "انضم إلى آلاف المستثمرين الذين يستخدمون EGX BOTS للتداول الذكي"
              : "Join thousands of investors using EGX BOTS for smart trading"
            }
          </p>
          <Link 
            href={user ? "/scanner/backtests?tab=bots" : "/signup"}
            className={`group px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 rounded-xl font-bold text-lg transition-all duration-300 transform hover:scale-105 hover:shadow-2xl inline-flex items-center gap-2 text-white shadow-lg`}
          >
            {isAr ? "ابدأ الآن مجاناً" : "Start For Free"}
            <ArrowRight className={`w-5 h-5 transition-transform group-hover:translate-x-1 ${isAr ? "rotate-180 group-hover:-translate-x-1" : ""}`} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className={`border-t ${isDark ? 'border-white/10' : 'border-slate-200'} py-8 text-center text-sm relative z-10 ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
        <p>© 2026 EGX BOTS. {isAr ? "جميع الحقوق محفوظة" : "All rights reserved"}</p>
      </footer>
    </div>
  );
}
