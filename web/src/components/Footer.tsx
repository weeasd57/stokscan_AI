"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { ShieldCheck, Lock, Smartphone, ExternalLink } from "lucide-react";

export default function Footer() {
  const { t, language } = useLanguage();
  const isAr = language === "ar";
  const pathname = usePathname();

  if (pathname === "/antigrafity" || pathname?.startsWith("/antigrafity")) {
    return null;
  }

  return (
    <footer className="app-footer-surface w-full py-12 mt-20">
      <div className="mx-auto max-w-5xl px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-10">
          <div className="col-span-1 md:col-span-2 space-y-4">
            <h3 className="text-xl font-black dark:text-white light:text-gray-900 italic tracking-tighter uppercase">
              {t("app.title")}
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 max-w-xs leading-relaxed">
              {t("footer.tagline")}
            </p>
            <div className="pt-1 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold rounded">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>{isAr ? "مدفوعات مشفرة ومعتمدة عبر EasyKash" : "Secured by EasyKash Payment Gateway"}</span>
              </span>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-[10px] font-black dark:text-white light:text-gray-900 uppercase tracking-[0.3em]">
              {t("footer.platform")}
            </h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/stocks"
                  className="text-sm font-bold text-yellow-600 dark:text-yellow-400 hover:underline transition-colors"
                >
                  {t("nav.stocks")}
                </Link>
              </li>
              <li>
                <Link
                  href="/scanner/ai"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors font-bold text-indigo-400/80 dark:text-indigo-400/80 light:text-indigo-600/80"
                >
                  {t("nav.scanner.ai")}
                </Link>
              </li>
              <li>
                <Link
                  href="/news"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors font-bold text-indigo-400/80 dark:text-indigo-400/80 light:text-indigo-600/80"
                >
                  {t("nav.scanner.news")}
                </Link>
              </li>
              <li>
                <Link
                  href="/scanner/technical"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors"
                >
                  {t("nav.scanner.tech")}
                </Link>
              </li>
              <li>
                <Link
                  href="/scanner/market"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors"
                >
                  {t("nav.scanner.market")}
                </Link>
              </li>
              <li>
                <Link
                  href="/scanner/backtests"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors"
                >
                  {t("nav.scanner.backtests")}
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-4">
            <h4 className="text-[10px] font-black dark:text-white light:text-gray-900 uppercase tracking-[0.3em]">
              {t("footer.resources")}
            </h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/blogs"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors"
                >
                  {t("footer.blogs")}
                </Link>
              </li>
              <li><Link href="/reports" className="text-sm text-zinc-500 hover:text-amber-500">تقارير السوق والتجميع · Daily reports</Link></li>
              <li>
                <Link
                  href="/faq"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors"
                >
                  {t("footer.faq")}
                </Link>
              </li>
              <li>
                <Link
                  href="/disclaimer"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors"
                >
                  {t("footer.disclaimer")}
                </Link>
              </li>
              <li>
                <Link
                  href="/legal-status"
                  className="text-sm text-amber-500/90 dark:text-amber-400/90 light:text-amber-600 hover:text-amber-500 dark:hover:text-amber-300 transition-colors font-bold"
                >
                  {t("footer.legal_status")}
                </Link>
              </li>
              <li>
                <Link
                  href="/pricing"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors"
                >
                  {t("footer.pricing")}
                </Link>
              </li>
              <li>
                <Link
                  href="/refund"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors"
                >
                  {t("footer.refund")}
                </Link>
              </li>
              <li>
                <a
                  href="https://www.facebook.com/egxbots"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors"
                >
                  {t("footer.facebook")}
                </a>
              </li>
              <li>
                <a
                  href="https://web.telegram.org/a/#-1002083067817_153"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors"
                >
                  {t("footer.telegram")}
                </a>
              </li>
              <li>
                <a
                  href="https://wa.me/201024359109"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-bold text-emerald-500 hover:text-emerald-400 transition-colors"
                >
                  {isAr ? "الدعم عبر واتساب" : "WhatsApp Support"}
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* ── Official EasyKash Payment Gateway Integration ── */}
        <div className="border-2 border-black/10 dark:border-white/10 bg-zinc-50/80 dark:bg-zinc-900/60 p-5 sm:p-6 mb-10 shadow-sm transition-all hover:border-emerald-500/40">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
            {/* Identity & Legal Trust */}
            <div className="space-y-2 text-center lg:text-start max-w-xl">
              <div className="flex items-center justify-center lg:justify-start gap-2.5 flex-wrap">
                {/* EasyKash Badge */}
                <a
                  href="https://easykash.net"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-2 px-3 py-1 bg-white dark:bg-zinc-950 border-2 border-black/20 dark:border-white/20 hover:border-emerald-500 transition-all shadow-[2px_2px_0px_rgba(0,0,0,0.1)]"
                  title="EasyKash Payment Gateway"
                >
                  {/* Stylized EasyKash Fintech Emblem */}
                  <div className="w-5 h-5 rounded bg-emerald-500 flex items-center justify-center text-white font-black text-xs shadow-xs">
                    E
                  </div>
                  <div className="flex items-baseline font-black font-mono tracking-tight text-sm">
                    <span className="text-zinc-900 dark:text-white">Easy</span>
                    <span className="text-emerald-500 font-extrabold">Kash</span>
                  </div>
                  <ExternalLink className="w-3 h-3 text-zinc-400 group-hover:text-emerald-500 transition-colors" />
                </a>

                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[11px] font-black">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{isAr ? "شريك الدفع الإلكتروني الرسمي" : "Official Payment Partner"}</span>
                </span>

                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-[11px] font-black">
                  <Lock className="w-3 h-3 text-amber-500" />
                  <span>{isAr ? "مرخص بضوابط البنك المركزي المصري" : "Central Bank of Egypt Compliant"}</span>
                </span>
              </div>

              <p className="text-xs text-zinc-600 dark:text-zinc-400 font-medium leading-relaxed">
                {isAr
                  ? "تتم جميع عمليات تحصيل الاشتراكات حصراً بالجنيه المصري من خلال بوابة EasyKash المشفرة برخصة البنك المركزي المصري بتشفير بنكي 256-bit SSL. المنصة لا تحفظ ولا تطلع على أي أرقام بطاقات أو بيانات سرية للمشتركين."
                  : "All subscription transactions are conducted exclusively in EGP via EasyKash, an authorized payment processor compliant with Central Bank of Egypt regulations with 256-bit SSL encryption. We never store sensitive card data."}
              </p>
            </div>

            {/* Supported Payment Channels in Egypt */}
            <div className="flex flex-col items-center lg:items-end gap-2 shrink-0">
              <span className="text-[10px] font-black tracking-widest text-zinc-500 dark:text-zinc-400 uppercase">
                {isAr ? "وسائل الدفع المعتمدة عبر EasyKash" : "Accepted Payment Methods"}
              </span>

              <div className="flex items-center gap-1.5 flex-wrap justify-center">
                {/* Meeza */}
                <div
                  className="px-2.5 py-1 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 text-[11px] font-black text-emerald-700 dark:text-emerald-400 flex items-center gap-1 shadow-2xs"
                  title="كروت ميزة الوطنية المصرية"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                  <span>ميزة Meeza</span>
                </div>

                {/* Visa */}
                <div
                  className="px-2.5 py-1 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 text-[11px] font-black text-blue-600 dark:text-blue-400 shadow-2xs"
                  title="Visa"
                >
                  VISA
                </div>

                {/* Mastercard */}
                <div
                  className="px-2.5 py-1 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 text-[11px] font-black text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 shadow-2xs"
                  title="Mastercard"
                >
                  <div className="flex -space-x-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 opacity-80 inline-block"></span>
                  </div>
                  <span>Mastercard</span>
                </div>

                {/* Smart Wallets */}
                <div
                  className="px-2.5 py-1 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 text-[11px] font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1 shadow-2xs"
                  title="المحافظ الذكية: فودافون كاش، أورنج كاش، اتصالات كاش، وي باي"
                >
                  <Smartphone className="w-3 h-3 text-indigo-500" />
                  <span>{isAr ? "المحافظ الذكية" : "Smart Wallets"}</span>
                </div>

                {/* InstaPay */}
                <div
                  className="px-2.5 py-1 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 text-[11px] font-black text-violet-600 dark:text-violet-400 shadow-2xs"
                  title="شبكة المدفوعات اللحظية انستاباي"
                >
                  <span>InstaPay</span>
                </div>

                {/* Cash & Aman */}
                <div
                  className="px-2.5 py-1 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 text-[11px] font-bold text-amber-600 dark:text-amber-400 shadow-2xs"
                  title="أمان وفوري ومنافذ الدفع النقدي"
                >
                  <span>{isAr ? "منافذ التحصيل" : "Cash Outlets"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-white/5 dark:border-white/5 light:border-gray-300 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-center md:text-left">
          <p className="text-[10px] font-black text-zinc-700 dark:text-zinc-700 light:text-gray-600 uppercase tracking-widest">
            {t("footer.copyright")}
          </p>

          <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 dark:text-zinc-500">
            <Lock className="w-3 h-3 text-emerald-500" />
            <span>
              {isAr
                ? "بوابة الدفع مؤمنة ومشفرة بواسطة EasyKash"
                : "Payments securely powered & encrypted by EasyKash"}
            </span>
          </div>
        </div>

        <p className="mt-8 text-[9px] font-bold text-zinc-800 dark:text-zinc-800 light:text-gray-700 text-center uppercase tracking-widest leading-relaxed">
          {t("home.footer.disclaimer")}
        </p>
      </div>
    </footer>
  );
}

