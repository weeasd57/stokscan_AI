"use client";

import Link from "next/link";
import { useLanguage } from "@/contexts/LanguageContext";

export default function Footer() {
    const { t } = useLanguage();

    return (
        <footer className="app-footer-surface w-full py-12 mt-20">
            <div className="mx-auto max-w-5xl px-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
                    <div className="col-span-1 md:col-span-2 space-y-4">
                        <h3 className="text-xl font-black dark:text-white light:text-gray-900 italic tracking-tighter uppercase">
                            {t("app.title")}
                        </h3>
                        <p className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 max-w-xs leading-relaxed">
                            Advanced AI-driven stock analysis platform. Combining RandomForest models with multi-source fundamentals to give you the edge.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <h4 className="text-[10px] font-black dark:text-white light:text-gray-900 uppercase tracking-[0.3em]">Platform</h4>
                        <ul className="space-y-2">
                            <li><Link href="/scanner/backtests" className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors font-bold text-indigo-400/80 dark:text-indigo-400/80 light:text-indigo-600/80">AI Trading Scanner</Link></li>
                            <li><Link href="/scanner/technical" className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors">Technical Scanner</Link></li>
                        </ul>
                    </div>

                    <div className="space-y-4">
                        <h4 className="text-[10px] font-black dark:text-white light:text-gray-900 uppercase tracking-[0.3em]">Resources</h4>
                        <ul className="space-y-2">
                            <li><Link href="/blogs" className="text-sm text-zinc-500 dark:text-zinc-500 light:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 light:hover:text-indigo-600 transition-colors">Market Blogs</Link></li>
                        </ul>
                    </div>
                </div>

                <div className="border-t border-white/5 dark:border-white/5 light:border-gray-300 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-center md:text-left">
                    <p className="text-[10px] font-black text-zinc-700 dark:text-zinc-700 light:text-gray-600 uppercase tracking-widest">
                        © 2026 EGX Bots. Built for professional analysis.
                    </p>
                </div>

                <p className="mt-8 text-[9px] font-bold text-zinc-800 dark:text-zinc-800 light:text-gray-700 text-center uppercase tracking-widest leading-relaxed">
                    {t("home.footer.disclaimer")}
                </p>
            </div>
        </footer>
    );
}
