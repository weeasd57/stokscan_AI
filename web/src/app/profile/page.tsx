"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Loader2, Save, Send, MessageSquare, CheckCircle2, AlertCircle, RefreshCw, Globe } from "lucide-react";
import UserBotsSection from "./components/UserBotsSection";

type ProfileRow = {
  default_target_pct: number;
  default_stop_pct: number;
  username: string | null;
  display_name: string | null;
  telegram_chat_id: string | null;
  notification_channel: "telegram" | null;
};

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { t, language } = useLanguage();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [defaultsTarget, setDefaultsTarget] = useState("10");
  const [defaultsStop, setDefaultsStop] = useState("3.5");
  const [defaultTelegramChatId, setDefaultTelegramChatId] = useState("");
  const [notificationChannel, setNotificationChannel] = useState<"telegram" | null>(null);
  const channelLoadedRef = useRef(false); // prevent DB from overriding user's manual tab click
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [botUsername, setBotUsername] = useState("egxbots_bot");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  useEffect(() => {
    fetch("/api/ai_bot/telegram/bot_username")
      .then((res) => res.json())
      .then((data) => {
        if (data.username) setBotUsername(data.username);
      })
      .catch((err) => console.error("Error fetching bot username:", err));
  }, []);

  const reloadAll = useCallback(async () => {
    if (!user) return;

    const { data: profileRow } = await supabase
      .from("profiles")
      .select("default_target_pct, default_stop_pct, username, display_name, telegram_chat_id, notification_channel")
      .eq("id", user.id)
      .maybeSingle();

    if (profileRow) {
      setProfile(profileRow as ProfileRow);
      setDefaultsTarget(String((profileRow as any).default_target_pct ?? 10));
      setDefaultsStop(String((profileRow as any).default_stop_pct ?? 3.5));
      setDefaultTelegramChatId((profileRow as any).telegram_chat_id || "");
      // Only set the channel tab from DB on the FIRST load — after that, the user controls it manually
      if (!channelLoadedRef.current) {
        setNotificationChannel(((profileRow as any).notification_channel as "telegram") || null);
        channelLoadedRef.current = true;
      }
    }
  }, [supabase, user]);

  useEffect(() => {
    if (!user) return;
    void reloadAll();
  }, [reloadAll, user]);

  async function saveDefaults() {
    if (!user) return;
    const target = Number(defaultsTarget);
    const stop = Number(defaultsStop);
    if (!Number.isFinite(target) || target <= 0 || target > 100) return;
    if (!Number.isFinite(stop) || stop <= 0 || stop > 100) return;

    setSavingDefaults(true);
    try {
      await supabase
        .from("profiles")
        .update({ 
          default_target_pct: target, 
          default_stop_pct: stop,
          telegram_chat_id: defaultTelegramChatId.trim() || null,
          notification_channel: notificationChannel
        })
        .eq("id", user.id);
      await reloadAll();
    } finally {
      setSavingDefaults(false);
    }
  }

  if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-indigo-500" /></div>;
  if (!user) return null;

  return (
    <div className="neobrutal-layout flex flex-col gap-10 pb-20 max-w-[1600px] mx-auto mt-2 px-4 neobrutal-grid-bg min-h-screen">
      <header className="flex flex-col gap-3 relative z-10 pt-4">
        <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-black dark:text-white uppercase italic drop-shadow-[3px_3px_0px_var(--brutal-shadow)]">
          {t("nav.profile")}
        </h1>
        <p className="text-sm text-zinc-700 dark:text-zinc-400 font-bold max-w-lg">{t("profile.track")}</p>
      </header>

      <div className="grid grid-cols-1 gap-8 relative z-10">
        {/* Trading Defaults & Notification Settings */}
        <section className="neobrutal-card p-6 sm:p-8 space-y-8 relative overflow-hidden bg-white dark:bg-zinc-900 border-4 border-black dark:border-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_var(--brutal-shadow)]">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/5 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />

          <div className="relative">
            <h2 className="text-2xl font-black text-black dark:text-white uppercase tracking-tight mb-2">
              Profile & Default Settings
            </h2>
            <p className="text-xs text-zinc-655 dark:text-zinc-400 font-black uppercase tracking-widest leading-relaxed">
              Default values used when saving watchlist signals and routing bot notifications
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative border-b-4 border-black dark:border-zinc-800 pb-8">
            <div className="space-y-3">
              <label className="text-[10px] font-black text-black dark:text-white uppercase tracking-[0.2em] ml-1">
                {t("profile.defaults.target")}
              </label>
              <div className="relative group">
                <input
                  type="number"
                  value={defaultsTarget}
                  onChange={(e) => setDefaultsTarget(e.target.value)}
                  className="h-14 w-full border-4 border-black dark:border-white bg-white dark:bg-zinc-950 px-5 text-lg font-black text-indigo-600 dark:text-indigo-400 outline-none transition-all font-mono shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,1)] focus:bg-yellow-50 dark:focus:bg-zinc-800"
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 font-black text-zinc-800 dark:text-zinc-200">%</span>
              </div>
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-black text-black dark:text-white uppercase tracking-[0.2em] ml-1">
                {t("profile.defaults.stop")}
              </label>
              <div className="relative group">
                <input
                  type="number"
                  value={defaultsStop}
                  onChange={(e) => setDefaultsStop(e.target.value)}
                  className="h-14 w-full border-4 border-black dark:border-white bg-white dark:bg-zinc-950 px-5 text-lg font-black text-red-650 dark:text-red-400 outline-none transition-all font-mono shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,1)] focus:bg-yellow-50 dark:focus:bg-zinc-800"
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 font-black text-zinc-800 dark:text-zinc-200">%</span>
              </div>
            </div>
          </div>

          {/* Smart Notifications Settings & Preview */}
          <div className="space-y-6">
            <div className="relative">
              <h3 className="text-xl font-black text-black dark:text-white uppercase tracking-tight mb-1">
                {t("profile.notification.title")}
              </h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 font-bold leading-relaxed">
                {t("profile.notification.subtitle")}
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative">
              {/* Configuration panel */}
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-black dark:text-white uppercase tracking-[0.2em] ml-1">
                    {t("profile.notification.channel.select")}
                  </label>
                  
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setNotificationChannel("telegram"); }}
                      className={`flex-1 h-14 border-4 border-black dark:border-white font-black text-xs uppercase tracking-[0.1em] transition-all flex items-center justify-center gap-2 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
                        notificationChannel === "telegram"
                          ? "neobrutal-bg-purple text-black font-black"
                          : "bg-white dark:bg-zinc-950 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      }`}
                    >
                      <Send className="w-4 h-4" />
                      {t("profile.notification.channel.telegram")}
                    </button>
                    {notificationChannel !== null && (
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setNotificationChannel(null); }}
                        className="h-14 px-4 border-4 border-black dark:border-white font-black text-xs uppercase tracking-[0.1em] transition-all flex items-center justify-center bg-red-400 hover:bg-red-300 text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                        title="Deselect Channel"
                      >
                        {t("backtest.hide")}
                      </button>
                    )}
                  </div>

                  {/* ── Test Channel Button ── */}
                  <div className="flex items-center gap-3 mt-4">
                    {/* Active channel badge */}
                    <div className={`flex items-center gap-1.5 px-3 py-2 border-4 border-black dark:border-white text-[10px] font-black uppercase tracking-widest transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)] ${
                      notificationChannel === "telegram"
                        ? "neobrutal-bg-cyan text-black"
                        : "bg-zinc-200 dark:bg-zinc-800 text-zinc-650 dark:text-zinc-400"
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${
                        notificationChannel === "telegram" ? "bg-black" : "bg-zinc-600"
                      }`} />
                      {notificationChannel === "telegram" ? (language === "ar" ? "Telegram مفعّل" : "Telegram Enabled") : (language === "ar" ? "لا يوجد قناة" : "No Channel")}
                    </div>

                    {/* Test button */}
                    <button
                      type="button"
                      id="test-notification-btn"
                      disabled={notificationChannel === null}
                      onClick={async (e) => {
                        e.preventDefault();
                        const btn = e.currentTarget;
                        btn.disabled = true;
                        btn.textContent = language === "ar" ? "⏳ جاري الإرسال..." : "⏳ Sending...";
                        try {
                          const res = await fetch("/api/ai_bot/telegram/test_notification", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ channel: notificationChannel, user_id: user?.id }),
                          });
                          const data = await res.json();
                          btn.textContent = data.ok ? (language === "ar" ? "✅ تم الإرسال!" : "✅ Sent!") : `❌ ${data.error || "Failed"}`;
                        } catch {
                          btn.textContent = language === "ar" ? "❌ خطأ في الاتصال" : "❌ Connection Error";
                        } finally {
                          setTimeout(() => { btn.disabled = false; btn.textContent = language === "ar" ? "🔔 اختبار الإشعار" : "🔔 Test Notification"; }, 3000);
                        }
                      }}
                      className="flex-1 h-10 neobrutal-btn bg-white dark:bg-zinc-800 text-black dark:text-white font-black text-[10px] uppercase tracking-widest border-4 border-black dark:border-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)] flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      🔔 {language === "ar" ? "اختبار الإشعار" : "Test Notification"}
                    </button>
                  </div>
                </div>

                {/* No channel selected yet */}
                {notificationChannel === null && (
                  <div className="p-6 border-4 border-dashed border-black dark:border-zinc-700 bg-zinc-950/5 dark:bg-zinc-950/20 flex flex-col items-center justify-center gap-3 text-center min-h-[140px]">
                    <MessageSquare className="w-6 h-6 text-zinc-500" />
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 font-bold uppercase tracking-wider">
                      {t("profile.notification.channel.select")}
                    </p>
                  </div>
                )}

                {/* Telegram Config UI */}
                {notificationChannel === "telegram" && notificationChannel !== null && (
                  <div className="space-y-4 transition-all duration-300">
                    <div className="p-5 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950/20 space-y-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,1)]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">{t("profile.notification.telegram.status")}</span>
                          {defaultTelegramChatId ? (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-black bg-emerald-400 px-2.5 py-1 rounded-full border-2 border-black">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {t("profile.notification.telegram.linked")}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-black bg-amber-400 px-2.5 py-1 rounded-full border-2 border-black">
                              <AlertCircle className="w-3.5 h-3.5" />
                              {t("profile.notification.telegram.not_linked")}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={reloadAll}
                          className="neobrutal-btn bg-white dark:bg-zinc-800 p-2 text-black dark:text-white border-2 border-black dark:border-white"
                          title="Refresh connection status"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed font-bold">
                        {t("profile.notification.telegram.desc")}
                      </p>

                      <div className="flex flex-col gap-3 w-full">
                        <a
                          href={`https://t.me/${botUsername}?start=${user.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-12 w-full items-center justify-center gap-2 neobrutal-btn neobrutal-bg-yellow text-xs font-black uppercase tracking-[0.1em] text-black"
                        >
                          <Send className="w-4 h-4" />
                          {t("profile.notification.telegram.btn")}
                        </a>
                        <a
                          href={`https://web.telegram.org/a/#?tgaddr=tg%3A%2F%2Fresolve%3Fdomain%3D${botUsername}%26start%3D${user.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-10 w-full items-center justify-center gap-2 neobrutal-btn bg-white dark:bg-zinc-800 text-black dark:text-white text-[10px] font-black uppercase tracking-[0.1em]"
                        >
                          <Globe className="w-3.5 h-3.5" />
                          Open in Telegram Web
                        </a>
                      </div>
                      
                      <div className="space-y-2 pt-3 border-t-4 border-black dark:border-zinc-800">
                        <label className="text-[10px] font-black text-black dark:text-white uppercase tracking-widest">
                          Manual Telegram Chat ID (Optional)
                        </label>
                        <input
                          type="text"
                          value={defaultTelegramChatId}
                          onChange={(e) => setDefaultTelegramChatId(e.target.value)}
                          placeholder="e.g. 987654321"
                          className="h-10 w-full border-4 border-black dark:border-white bg-white dark:bg-zinc-950 px-4 text-xs font-black text-black dark:text-white outline-none focus:bg-yellow-50 dark:focus:bg-zinc-800 transition-all font-mono shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Preview mockup panel */}
              <div className="p-6 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 text-black dark:text-white flex flex-col justify-between relative overflow-hidden min-h-[300px] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_var(--brutal-shadow)]">
                <div className="absolute top-0 left-0 w-32 h-32 bg-indigo-600/5 blur-[50px] rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
                
                <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1 mb-4 block">Live Alert Preview</span>
                
                <div className="flex-1 flex items-center justify-center w-full">
                  {notificationChannel === "telegram" ? (
                    <div className="w-full max-w-sm border-4 border-black dark:border-white bg-zinc-955 p-4 space-y-2 relative shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]">
                      <div className="flex items-center justify-between pb-2 border-b border-white/5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-indigo-650 flex items-center justify-center text-[10px] font-black text-white">🤖</div>
                          <span className="text-[10px] font-bold text-zinc-300">Artoro Bot</span>
                        </div>
                        <span className="text-[8px] text-zinc-500">now</span>
                      </div>
                      <div className="text-[11px] text-zinc-300 font-mono leading-relaxed space-y-1">
                        <div className="text-emerald-400 font-bold">🟢 NEW BUY SIGNAL</div>
                        <div>💎 Symbol: <span className="text-white">COINS</span></div>
                        <div>💰 Entry Price: <span className="text-white">12.4500</span></div>
                        <div>🎯 Target ({defaultsTarget}%): <span className="text-white">{(12.4500 * (1 + Number(defaultsTarget)/100)).toFixed(4)}</span></div>
                        <div>🛡️ Stop Loss ({defaultsStop}%): <span className="text-white">{(12.4500 * (1 - Number(defaultsStop)/100)).toFixed(4)}</span></div>
                      </div>
                    </div>
                  ) : (
                    // No channel selected → neutral placeholder
                    <div className="flex flex-col items-center justify-center gap-3 text-center opacity-45">
                      <div className="w-12 h-12 border-4 border-black dark:border-zinc-600 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]">
                        <MessageSquare className="w-6 h-6 text-zinc-500" />
                      </div>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                        اختر قناة لمعاينة الإشعارات
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-4 text-[9px] text-zinc-500 text-center font-bold uppercase tracking-wider">
                  Real-time notification templates render dynamically in English & Arabic
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={saveDefaults}
            disabled={savingDefaults}
            className="h-14 w-full neobrutal-btn neobrutal-bg-yellow font-black text-sm uppercase tracking-[0.2em] text-black flex items-center justify-center gap-3 relative overflow-hidden group"
          >
            {savingDefaults ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5 group-hover:scale-110 transition-transform" />}
            Save Settings
          </button>
        </section>
      </div>

      {/* AI Bots Section */}
      <UserBotsSection />

    </div>
  );
}
