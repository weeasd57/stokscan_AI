"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";

export default function Footer() {
  const { t } = useLanguage();
  const pathname = usePathname();

  if (pathname === "/antigrafity" || pathname?.startsWith("/antigrafity")) {
    return null;
  }

  return (
    <footer className="app-footer-surface w-full py-12 mt-20">
      <div className="mx-auto max-w-5xl px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          <div className="col-span-1 md:col-span-2 space-y-4">
            <h3 className="text-xl font-black dark:text-white light:text-gray-900 italic tracking-tighter uppercase">
              {t("app.title")}
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 max-w-xs leading-relaxed">
              {t("footer.tagline")}
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-[10px] font-black dark:text-white light:text-gray-900 uppercase tracking-[0.3em]">
              {t("footer.platform")}
            </h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/scanner/backtests"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors font-bold text-indigo-400/80 dark:text-indigo-400/80 light:text-indigo-600/80"
                >
                  {t("nav.scanner.ai_trading")}
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
                  href="/scanner/backtests?tab=backtests"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors"
                >
                  {t("nav.scanner.backtests")}
                </Link>
              </li>
              <li>
                <Link
                  href="/scanner/backtests?tab=similarity"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors"
                >
                  {t("nav.scanner.similarity")}
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
              <li>
                <Link
                  href="/faq"
                  className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors"
                >
                  {t("footer.faq")}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/5 dark:border-white/5 light:border-gray-300 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-center md:text-left">
          <p className="text-[10px] font-black text-zinc-700 dark:text-zinc-700 light:text-gray-600 uppercase tracking-widest">
            {t("footer.copyright")}
          </p>
        </div>

        <p className="mt-8 text-[9px] font-bold text-zinc-800 dark:text-zinc-800 light:text-gray-700 text-center uppercase tracking-widest leading-relaxed">
          {t("home.footer.disclaimer")}
        </p>
      </div>
    </footer>
  );
}
