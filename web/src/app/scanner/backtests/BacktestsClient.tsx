"use client";

import React from "react";
import { Sparkles } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import Image from "next/image";
import RecommendationsTable from "@/components/RecommendationsTable";

export default function AIScannerPage() {
    const { t, language } = useLanguage();
    const isAr = language === "ar";

    return (
        <div className="backtests-shell app-page-shell mx-auto max-w-[1400px] w-full px-4 py-8 md:px-6 md:py-12 mt-2 min-h-[calc(100vh-200px)]">
            {/* Header Banner */}
            <div className="backtests-hero app-hero-panel relative overflow-hidden rounded-[2.5rem] p-8 md:p-12 mb-10">
                <div className="absolute top-1/2 -translate-y-1/2 right-12 opacity-10 pointer-events-none hidden md:block">
                    <Image
                        src="/favicon_io/apple-touch-icon.png?v=2"
                        alt="EGX Bots logo"
                        width={200}
                        height={200}
                        className="object-contain"
                    />
                </div>
                <div className="relative z-10 max-w-2xl space-y-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/25 text-indigo-400 text-xs font-black uppercase tracking-wider">
                        <Sparkles className="w-3.5 h-3.5" /> {isAr ? "أفضل الأسهم" : "TOP STOCKS"}
                    </div>
                    <h1 className="text-3xl md:text-5xl font-black app-text-primary tracking-tight leading-none uppercase">
                        {isAr ? (
                            <>
                                أفضل <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">الأسهم</span>
                            </>
                        ) : (
                            <>
                                Top <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">Stocks</span>
                            </>
                        )}
                    </h1>
                    <p className="app-text-muted font-medium text-sm md:text-base leading-relaxed">
                        {t("bots.banner_desc")}
                    </p>
                </div>
            </div>

            {/* Recommendations Table */}
            <div className="space-y-6">
                <div className="pt-6">
                    <RecommendationsTable isLandingPage={false} />
                </div>
            </div>
        </div>
    );
}
