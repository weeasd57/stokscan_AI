"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useWatchlist, type SavedSymbol } from "@/contexts/WatchlistContext";
import { Loader2, Send, Globe, Star, Trash2, Edit3, X, Check, ExternalLink, User, Wallet, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import MyPortfolioSection from "./components/MyPortfolioSection";

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { t, language } = useLanguage();
  const { watchlist, updateSymbol, removeSymbol } = useWatchlist();
  const isAr = language === "ar";
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [username, setUsername] = useState<string | null>(null);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [editingSymbolId, setEditingSymbolId] = useState<string | null>(null);
  const [watchlistDraft, setWatchlistDraft] = useState({ name: "" });
  const [portfolioVersion, setPortfolioVersion] = useState(0);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  const reloadProfile = useCallback(async () => {
    if (!user) return;
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("username, display_name, telegram_chat_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profileRow) {
      setUsername((profileRow as any).username || (profileRow as any).display_name || null);
      setTelegramLinked(Boolean((profileRow as any).telegram_chat_id));
    }
  }, [supabase, user]);

  useEffect(() => {
    if (!user) return;
    void reloadProfile();
  }, [reloadProfile, user]);

  function beginEditWatchlistItem(item: SavedSymbol) {
    setEditingSymbolId(item.id);
    setWatchlistDraft({ name: item.name || item.symbol });
  }

  async function saveWatchlistItem(item: SavedSymbol) {
    const ok = await updateSymbol(item.id, {
      name: watchlistDraft.name.trim() || item.symbol,
    });
    if (ok) setEditingSymbolId(null);
  }

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="neobrutal-layout flex flex-col gap-10 pb-20 max-w-[1600px] mx-auto mt-2 px-4 neobrutal-grid-bg min-h-screen">
      {/* ── Header ── */}
      <header className="flex flex-col gap-3 relative z-10 pt-4">
        <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-black dark:text-white uppercase italic drop-shadow-[3px_3px_0px_rgba(0,0,0,1)]">
          {t("nav.profile")}
        </h1>
        <p className="text-sm text-zinc-700 dark:text-zinc-400 font-bold max-w-lg">
          {isAr
            ? "أدر محفظتك، وتابع قناة التليجرام، واضبط قائمة المراقبة من مكان واحد."
            : "Manage your portfolio, follow our Telegram channel and keep your watchlist in one place."}
        </p>
      </header>

      {/* ── My Portfolio (محفظتى) ── */}
      <MyPortfolioSection
        key={portfolioVersion}
        onPortfolioUpdated={() => setPortfolioVersion((v) => v + 1)}
      />

      {/* ── Account + Telegram ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10">
        {/* Account info */}
        <div className="neobrutal-card p-6 bg-white dark:bg-zinc-900 border-4 border-black dark:border-white shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 border-4 border-black dark:border-white bg-zinc-700 text-white flex items-center justify-center shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)]">
              <User className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-black text-black dark:text-white uppercase tracking-tight">
              {isAr ? "معلومات الحساب" : "Account"}
            </h2>
          </div>
          <div className="space-y-4 text-sm font-bold text-zinc-700 dark:text-zinc-300">
            {username && (
              <div>
                <span className="text-zinc-500 uppercase text-[10px] tracking-wider block">{isAr ? "اسم المستخدم" : "Name"}</span>
                <span className="text-black dark:text-white font-black">{username}</span>
              </div>
            )}
            <div>
              <span className="text-zinc-500 uppercase text-[10px] tracking-wider block">{isAr ? "البريد الإلكتروني" : "Email"}</span>
              <span className="text-black dark:text-white font-black break-all">{user.email}</span>
            </div>
            <div>
              <span className="text-zinc-500 uppercase text-[10px] tracking-wider block">{isAr ? "حالة الحساب" : "Status"}</span>
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-black">
                <CheckCircle2 className="w-4 h-4" />
                {isAr ? "نشط" : "Active"}
              </span>
            </div>
            {telegramLinked && (
              <div>
                <span className="text-zinc-500 uppercase text-[10px] tracking-wider block">{isAr ? "بوت التليجرام" : "Telegram Bot"}</span>
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-black">
                  <Send className="w-3.5 h-3.5" />
                  {isAr ? "متصل" : "Linked"}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Telegram channel subscribe (simple) */}
        <section className="neobrutal-card p-6 sm:p-8 space-y-5 bg-white dark:bg-zinc-900 border-4 border-black dark:border-white shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] md:col-span-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 border-4 border-black dark:border-white bg-sky-500 text-white flex items-center justify-center shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)]">
              <Send className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-black dark:text-white uppercase tracking-tight">
                {isAr ? "قناة التليجرام" : "Telegram Channel"}
              </h2>
              {telegramLinked && (
                <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" />
                  {isAr ? "بوت التليجرام متصل بحسابك" : "Bot linked to your account"}
                </span>
              )}
            </div>
          </div>

          <p className="text-sm font-bold text-zinc-700 dark:text-zinc-300 leading-relaxed">
            {isAr
              ? "اشترك في قناة التليجرام لمتابعة التوصيات والتقارير اليومية فور صدورها."
              : "Subscribe to our Telegram channel to receive daily recommendations and reports the moment they are published."}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <a
              href="https://t.me/egxbots/153"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 border-4 border-black dark:border-white bg-amber-300 dark:bg-amber-400 text-black font-black text-xs uppercase tracking-[0.1em] shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
            >
              <Send className="w-4 h-4 shrink-0" />
              {isAr ? "الانضمام للقناة" : "Join Channel"}
            </a>
            <a
              href="https://t.me/egxbots/153"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 border-4 border-black dark:border-white bg-white dark:bg-zinc-800 text-black dark:text-white font-black text-xs uppercase tracking-[0.1em] shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
            >
              <Globe className="w-4 h-4 shrink-0" />
              {isAr ? "افتح تليجرام ويب" : "Telegram Web"}
            </a>
          </div>
        </section>
      </div>

      {/* ── Watchlist ── */}
      <section className="relative z-10 neobrutal-card p-6 sm:p-8 space-y-6 bg-white dark:bg-zinc-900 border-4 border-black dark:border-white shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b-4 border-black dark:border-zinc-800 pb-5">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 border-4 border-black dark:border-white bg-indigo-500 text-white flex items-center justify-center shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)]">
                <Star className="h-5 w-5 fill-white" />
              </div>
              <h2 className="text-2xl font-black text-black dark:text-white uppercase tracking-tight">
                {isAr ? "قائمة المراقبة" : "Watchlist"}
              </h2>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 font-black uppercase tracking-widest leading-relaxed">
              {isAr ? "أسهمك المحفوظة — افتح الشارت أو عدّل أو احذف من هنا" : "Your saved symbols — open chart, edit or remove from here"}
            </p>
          </div>
          <div className="inline-flex items-center justify-center gap-2 h-10 px-4 border-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-950 text-black dark:text-white font-black text-xs uppercase tracking-widest shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]">
            {watchlist.length} {isAr ? "سهم" : "Symbols"}
          </div>
        </div>

        {watchlist.length === 0 ? (
          <div className="min-h-[180px] border-4 border-dashed border-black/40 dark:border-white/30 bg-zinc-50 dark:bg-zinc-950/30 flex flex-col items-center justify-center gap-4 text-center p-8">
            <Star className="h-8 w-8 text-zinc-400" />
            <p className="max-w-md text-sm font-bold text-zinc-600 dark:text-zinc-400">
              {isAr ? "لا توجد أسهم محفوظة حتى الآن. افتح صفحة الشارت واضغط النجمة لإضافة سهم لقائمتك." : "No saved symbols yet. Open the chart page and press the star to add a symbol."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {watchlist.map((item) => {
              const isEditing = editingSymbolId === item.id;
              const exchange = item.metadata?.exchange || "EGX";

              return (
                <article key={item.id} className="border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950/35 p-4 sm:p-5 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xl font-black text-black dark:text-white uppercase tracking-tight">{item.symbol}</span>
                        <span className="border-2 border-black dark:border-white bg-indigo-100 dark:bg-indigo-500/20 px-2 py-0.5 text-[10px] font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-widest">{exchange}</span>
                      </div>

                      {isEditing ? (
                        <input
                          value={watchlistDraft.name}
                          onChange={(e) => setWatchlistDraft((prev) => ({ ...prev, name: e.target.value }))}
                          className="mt-3 h-10 w-full border-4 border-black dark:border-white bg-white dark:bg-zinc-900 px-3 text-sm font-black text-black dark:text-white outline-none shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]"
                        />
                      ) : (
                        <p className="mt-1 truncate text-sm font-bold text-zinc-700 dark:text-zinc-300">{item.name || item.symbol}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => saveWatchlistItem(item)}
                            className="h-9 w-9 border-4 border-black dark:border-white bg-emerald-400 text-black flex items-center justify-center shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                            title={isAr ? "حفظ" : "Save"}
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditingSymbolId(null)}
                            className="h-9 w-9 border-4 border-black dark:border-white bg-white dark:bg-zinc-800 text-black dark:text-white flex items-center justify-center shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                            title={isAr ? "إلغاء" : "Cancel"}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => router.push(`/chart?symbol=${encodeURIComponent(item.symbol)}&exchange=${encodeURIComponent(exchange)}`)}
                            className="h-9 w-9 border-4 border-black dark:border-white bg-white dark:bg-zinc-800 text-black dark:text-white flex items-center justify-center shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                            title={isAr ? "فتح الشارت" : "Open chart"}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => beginEditWatchlistItem(item)}
                            className="h-9 w-9 border-4 border-black dark:border-white bg-amber-300 text-black flex items-center justify-center shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                            title={isAr ? "تعديل" : "Edit"}
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => removeSymbol(item.id)}
                            className="h-9 w-9 border-4 border-black dark:border-white bg-red-400 text-black flex items-center justify-center shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                            title={isAr ? "حذف" : "Delete"}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
