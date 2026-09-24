import Image from "next/image";
import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";

interface BrandedPageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
  badgeIcon?: ReactNode;
  dir?: "rtl" | "ltr";
}

export default function BrandedPageHeader({
  eyebrow,
  title,
  description,
  action,
  compact = false,
  badgeIcon,
  dir,
}: BrandedPageHeaderProps) {
  return (
    <header
      dir={dir}
      className={`relative isolate mb-6 overflow-hidden border border-zinc-200 bg-white p-5 text-zinc-950 shadow-[0_16px_44px_rgba(15,23,42,0.10)] dark:border-slate-700/80 dark:bg-gradient-to-br dark:from-[#080d1e] dark:via-[#111827] dark:to-[#0b1733] dark:text-white dark:shadow-[0_16px_44px_rgba(2,6,23,0.28)] sm:mb-8 sm:p-7 md:p-9 ${compact ? "md:flex md:items-center md:justify-between md:gap-8" : ""}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-25 dark:opacity-25"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.12) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "linear-gradient(to right, black, transparent 90%)",
        }}
      />
      <div className="pointer-events-none absolute -right-5 top-1/2 -z-10 hidden -translate-y-1/2 opacity-[0.12] sm:block md:right-7">
        <Image
          src="/favicon_io/apple-touch-icon.png"
          alt=""
          width={176}
          height={176}
          className="h-28 w-28 object-contain md:h-40 md:w-40"
          aria-hidden="true"
        />
      </div>
      <div className="relative flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="hidden h-14 w-14 shrink-0 items-center justify-center border border-amber-300/60 bg-amber-50 p-2 dark:border-amber-300/40 dark:bg-slate-950/60 sm:flex">
          <Image
            src="/favicon_io/apple-touch-icon.png"
            alt="EGX Bots"
            width={40}
            height={40}
            className="h-10 w-10 object-contain"
          />
        </div>
        <div className="min-w-0 flex-1">
          <span className="mb-3 inline-flex max-w-full items-center gap-2 border border-amber-300/50 bg-amber-300 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-950 sm:text-xs">
            {badgeIcon ?? <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span className="truncate">{eyebrow}</span>
          </span>
          <h1 className="break-words text-2xl font-black leading-tight tracking-tight text-zinc-950 dark:text-white sm:text-3xl md:text-4xl">
            {title}
          </h1>
          <p className="mt-2 max-w-4xl text-xs font-medium leading-6 text-zinc-600 dark:text-slate-300 sm:text-sm sm:leading-7">
            {description}
          </p>
        </div>
      </div>
      {action ? <div className="relative mt-5 shrink-0 md:mt-0">{action}</div> : null}
    </header>
  );
}
