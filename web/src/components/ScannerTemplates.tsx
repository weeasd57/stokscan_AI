"use client";

import React from "react";
import { Shield, Sparkles, Zap, Activity, BarChart3, TrendingUp, DollarSign } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

export type ScannerTemplateId =
  | "macd_cross"
  | "rsi_oversold"
  | "volume_breakout"
  | "sma_200_breakout"
  | "smart_money_flow";

const templates: Array<{
  id: ScannerTemplateId;
  titleKey: string;
  descKey: string;
  riskKey: string;
  gradient: string;
  accent: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "macd_cross",
    titleKey: "scanner.templates.macd_cross.title",
    descKey: "scanner.templates.macd_cross.desc",
    riskKey: "scanner.templates.risk.medium",
    gradient: "from-emerald-500/20 via-teal-500/10 to-transparent",
    accent: "text-emerald-300",
    icon: Zap,
  },
  {
    id: "rsi_oversold",
    titleKey: "scanner.templates.rsi_oversold.title",
    descKey: "scanner.templates.rsi_oversold.desc",
    riskKey: "scanner.templates.risk.high",
    gradient: "from-sky-500/20 via-cyan-500/10 to-transparent",
    accent: "text-sky-300",
    icon: Activity,
  },
  {
    id: "volume_breakout",
    titleKey: "scanner.templates.volume_breakout.title",
    descKey: "scanner.templates.volume_breakout.desc",
    riskKey: "scanner.templates.risk.very_high",
    gradient: "from-orange-500/20 via-rose-500/10 to-transparent",
    accent: "text-orange-300",
    icon: BarChart3,
  },
  {
    id: "sma_200_breakout",
    titleKey: "scanner.templates.sma_200_breakout.title",
    descKey: "scanner.templates.sma_200_breakout.desc",
    riskKey: "scanner.templates.risk.low",
    gradient: "from-slate-500/20 via-teal-500/10 to-transparent",
    accent: "text-teal-300",
    icon: TrendingUp,
  },
  {
    id: "smart_money_flow",
    titleKey: "scanner.templates.smart_money_flow.title",
    descKey: "scanner.templates.smart_money_flow.desc",
    riskKey: "scanner.templates.risk.medium",
    gradient: "from-purple-500/20 via-indigo-500/10 to-transparent",
    accent: "text-purple-300",
    icon: DollarSign,
  },
];

type ScannerTemplatesProps = {
  onSelect?: (id: ScannerTemplateId) => void;
};

export default function ScannerTemplates({ onSelect }: ScannerTemplatesProps) {
  const { t } = useLanguage();

  return (
    <section className="scanner-templates-panel neobrutal-card p-8 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.12),_transparent_55%)] select-none pointer-events-none" />
      <div className="relative z-10 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.35em] text-zinc-500 font-black">
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
            {t("scanner.templates.kicker")}
          </div>
          <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white">
            {t("scanner.templates.title")}
          </h2>
          <p className="text-sm text-zinc-400 max-w-2xl font-bold">
            {t("scanner.templates.subtitle")}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {templates.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect?.(item.id)}
              className="neobrutal-card group relative rounded-3xl p-6 overflow-hidden transition-all text-start"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${item.gradient} opacity-40`} />
              <div className="relative z-10 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className={`text-lg font-black ${item.accent}`}>
                      {t(item.titleKey)}
                    </h3>
                    <p className="mt-2 text-sm text-zinc-300 leading-relaxed font-semibold">
                      {t(item.descKey)}
                    </p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border-2 border-white/20 bg-zinc-900/80 text-zinc-400 group-hover:text-white transition-colors shrink-0 shadow-[1px_1px_0px_0px_rgba(255,255,255,0.1)]">
                    <item.icon className="h-5 w-5" />
                  </div>
                </div>

                <div className="mt-auto flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-zinc-400 font-black pt-4 border-t border-white/5">
                  <div className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 text-zinc-400" />
                    {t(item.riskKey)}
                  </div>
                  <span className="text-zinc-500 font-mono">#{item.id}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
