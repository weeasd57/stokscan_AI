"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useWatchlist, type SavedSymbol } from "@/contexts/WatchlistContext";
import { useNotification, type ServiceType } from "@/contexts/NotificationContext";
import { Loader2, Save, Send, MessageSquare, CheckCircle2, AlertCircle, RefreshCw, Globe, Star, Trash2, Edit3, X, Check, ExternalLink, Target, Shield, Bell, BellOff, Brain, Activity, BarChart3, TrendingUp } from "lucide-react";
import { toast } from "sonner";

type ProfileRow = {
  username: string | null;
  display_name: string | null;
  telegram_chat_id: string | null;
  notification_channel: "telegram" | null;
  default_target_pct: number | string | null;
  default_stop_pct: number | string | null;
  gemini_api_key: string | null;
  openrouter_api_key: string | null;
  custom_ai_rules: string | null;
};

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { t, language } = useLanguage();
  const { watchlist, updateSymbol, removeSymbol } = useWatchlist();
  const isAr = language === "ar";
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const {
    telegramChatId,
    notificationChannel,
    subscriptions,
    loading: subsLoading,
    toggling: togglingSubMap,
    botUsername,
    toggleSubscription: contextToggleSubscription,
    updateNotificationChannel,
    reloadAll: reloadNotifications,
  } = useNotification();

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [defaultTelegramChatId, setDefaultTelegramChatId] = useState("");
  const [defaultTargetPct, setDefaultTargetPct] = useState("10.00");
  const [defaultStopPct, setDefaultStopPct] = useState("3.50");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [customAiRules, setCustomAiRules] = useState("");
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [editingSymbolId, setEditingSymbolId] = useState<string | null>(null);
  const [watchlistDraft, setWatchlistDraft] = useState({ name: "" });

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  useEffect(() => {
    if (telegramChatId !== null) {
      setDefaultTelegramChatId(telegramChatId);
    } else {
      setDefaultTelegramChatId("");
    }
  }, [telegramChatId]);

  const reloadAll = useCallback(async () => {
    if (!user) return;

    const { data: profileRow } = await supabase
      .from("profiles")
      .select("username, display_name, telegram_chat_id, notification_channel, default_target_pct, default_stop_pct, gemini_api_key, openrouter_api_key, custom_ai_rules")
      .eq("id", user.id)
      .maybeSingle();

    if (profileRow) {
      setProfile(profileRow as ProfileRow);
      setDefaultTargetPct(String((profileRow as any).default_target_pct ?? "10.00"));
      setDefaultStopPct(String((profileRow as any).default_stop_pct ?? "3.50"));
      setGeminiApiKey((profileRow as any).gemini_api_key || "");
      setOpenrouterApiKey((profileRow as any).openrouter_api_key || "");
      setCustomAiRules((profileRow as any).custom_ai_rules || "");
    }
  }, [supabase, user]);

  useEffect(() => {
    if (!user) return;
    void reloadAll();
  }, [reloadAll, user]);

  async function handleChannelToggle(channel: "telegram" | null) {
    if (!user) return;
    try {
      await updateNotificationChannel(channel);
      toast.success(isAr ? "تم تحديث قناة الإشعارات بنجاح" : "Notification channel updated successfully");
    } catch (err: any) {
      console.error("Error updating notification channel:", err);
      toast.error(isAr ? `فشل تحديث القناة: ${err.message}` : `Failed to update channel: ${err.message}`);
    }
  }

  async function saveProfileSettings() {
    if (!user) return;
    setSavingDefaults(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ 
          telegram_chat_id: defaultTelegramChatId.trim() || null,
          notification_channel: notificationChannel,
          default_target_pct: defaultTargetPct ? parseFloat(defaultTargetPct) : 10.00,
          default_stop_pct: defaultStopPct ? parseFloat(defaultStopPct) : 3.50,
          gemini_api_key: geminiApiKey.trim() || null,
          openrouter_api_key: openrouterApiKey.trim() || null,
          custom_ai_rules: customAiRules.trim() || null,
        })
        .eq("id", user.id);

      if (error) throw error;

      // Sync bot_subscriptions based on notificationChannel
      const isEnabled = notificationChannel === "telegram";
      
      // Update all existing subscriptions for this user
      await supabase
        .from("bot_subscriptions")
        .update({ notifications_enabled: isEnabled })
        .eq("user_id", user.id);

      // Create default entries if turning ON and they don't exist yet
      if (isEnabled) {
        for (const type of ["stock_score", "historical_similarity"]) {
          const { data: existing } = await supabase
            .from("bot_subscriptions")
            .select("id")
            .eq("user_id", user.id)
            .eq("service_type", type)
            .maybeSingle();

          if (!existing) {
            await supabase.from("bot_subscriptions").insert({
              user_id: user.id,
              bot_id: type,
              service_type: type,
              notifications_enabled: true,
              created_at: new Date().toISOString(),
            });
          }
        }
      }

      await reloadAll();
      await reloadNotifications();
      toast.success(isAr ? "تم حفظ الإعدادات بنجاح" : "Settings saved successfully");
    } catch (e: any) {
      console.error(e);
      toast.error(isAr ? `فشل حفظ الإعدادات: ${e.message}` : `Failed to save settings: ${e.message}`);
    } finally {
      setSavingDefaults(false);
    }
  }

  async function toggleSubscription(serviceType: string) {
    if (!user) return;
    try {
      await contextToggleSubscription(serviceType as ServiceType);
    } catch (e) {
      console.error("Toggle subscription error:", e);
    }
  }

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
      <header className="flex flex-col gap-3 relative z-10 pt-4">
        <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-black dark:text-white uppercase italic drop-shadow-[3px_3px_0px_rgba(0,0,0,1)]">
          {t("nav.profile")}
        </h1>
        <p className="text-sm text-zinc-700 dark:text-zinc-400 font-bold max-w-lg">
          {isAr ? "إدارة معلومات حسابك وإعدادات إشعارات تليجرام." : "Manage your account details and Telegram alert settings."}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 relative z-10">
        
        {/* Account Info Card & AI Settings (Column 1) */}
        <div className="lg:col-span-1 space-y-6">
          <div className="neobrutal-card p-6 bg-white dark:bg-zinc-900 border-4 border-black dark:border-white shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] space-y-4">
            <h2 className="text-xl font-black text-black dark:text-white uppercase tracking-tight border-b-4 border-black dark:border-zinc-800 pb-2">
              {isAr ? "معلومات الحساب" : "Account Information"}
            </h2>
            <div className="space-y-4 text-sm font-bold text-zinc-700 dark:text-zinc-300">
              <div>
                <span className="text-zinc-500 uppercase text-[10px] tracking-wider block">{isAr ? "البريد الإلكتروني" : "Email Address"}</span>
                <span className="text-black dark:text-white font-black">{user.email}</span>
              </div>
              <div>
                <span className="text-zinc-500 uppercase text-[10px] tracking-wider block">{isAr ? "حالة الحساب" : "Account Status"}</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-black">{isAr ? "نشط" : "Active"}</span>
              </div>
            </div>
          </div>


        </div>

        {/* Alerts settings (Column 2-3) */}
        <div className="lg:col-span-2">
          <section className="neobrutal-card p-6 sm:p-8 space-y-8 relative overflow-hidden bg-white dark:bg-zinc-900 border-4 border-black dark:border-white shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/5 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />

            <div className="relative">
              <h2 className="text-2xl font-black text-black dark:text-white uppercase tracking-tight mb-2">
                {isAr ? "إعدادات تنبيهات الهاتف" : "Alert Settings"}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-black uppercase tracking-widest leading-relaxed">
                {isAr ? "ربط الحساب وتلقي إشارات التداول الفورية مباشرة على هاتفك" : "Link account and receive real-time trading signals directly on your phone"}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative border-b-4 border-black dark:border-zinc-800 pb-6">
              {/* Configuration panel */}
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-black dark:text-white uppercase tracking-[0.2em] ml-1">
                    {isAr ? "تنبيهات تليجرام" : "Telegram Alerts"}
                  </label>
                  
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleChannelToggle("telegram"); }}
                      className={`flex-1 h-14 border-4 border-black dark:border-white font-black text-xs uppercase tracking-[0.1em] transition-all flex items-center justify-center gap-2 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
                        notificationChannel === "telegram"
                          ? "neobrutal-bg-purple text-black font-black"
                          : "bg-white dark:bg-zinc-950 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      }`}
                    >
                      <Send className="w-4 h-4" />
                      {isAr ? "تفعيل التنبيهات" : "Enable Telegram"}
                    </button>
                    {notificationChannel !== null && (
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleChannelToggle(null); }}
                        className="h-14 px-4 border-4 border-black dark:border-white font-black text-xs uppercase tracking-[0.1em] transition-all flex items-center justify-center bg-red-400 hover:bg-red-300 text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                        title="Deselect Channel"
                      >
                        {isAr ? "إلغاء التفعيل" : "Disable"}
                      </button>
                    )}
                  </div>

                  {/* Test Channel Button */}
                  <div className="flex items-center gap-3 mt-4">
                    <div className={`flex items-center gap-1.5 px-3 py-2 border-4 border-black dark:border-white text-[10px] font-black uppercase tracking-widest transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)] ${
                      notificationChannel === "telegram"
                        ? "neobrutal-bg-cyan text-black"
                        : "bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${
                        notificationChannel === "telegram" ? "bg-black" : "bg-zinc-600"
                      }`} />
                      {notificationChannel === "telegram" ? (language === "ar" ? "Telegram مفعّل" : "Telegram Enabled") : (language === "ar" ? "لا يوجد تنبيهات" : "No Alerts")}
                    </div>

                    <button
                      type="button"
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
                      className="flex-1 h-10 bg-white dark:bg-zinc-800 text-black dark:text-white font-black text-[10px] uppercase tracking-widest border-4 border-black dark:border-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)] flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      🔔 {language === "ar" ? "اختبار الإشعار" : "Test Notification"}
                    </button>
                  </div>
                </div>

                {notificationChannel === null && (
                  <div className="p-6 border-4 border-dashed border-black dark:border-zinc-700 bg-zinc-950/5 dark:bg-zinc-950/20 flex flex-col items-center justify-center gap-3 text-center min-h-[140px]">
                    <MessageSquare className="w-6 h-6 text-zinc-500" />
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 font-bold uppercase tracking-wider">
                      {isAr ? "قم بتفعيل قناة تليجرام لتلقي التنبيهات" : "Enable Telegram to receive alerts"}
                    </p>
                  </div>
                )}

                {notificationChannel === "telegram" && (
                  <div className="space-y-4 transition-all duration-300">
                    <div className="p-5 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950/20 space-y-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,1)]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">{isAr ? "الحالة" : "Status"}</span>
                          {defaultTelegramChatId ? (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-black bg-emerald-400 px-2.5 py-1 rounded-full border-2 border-black">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {isAr ? "متصل" : "Linked"}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-black bg-amber-400 px-2.5 py-1 rounded-full border-2 border-black">
                              <AlertCircle className="w-3.5 h-3.5" />
                              {isAr ? "غير متصل" : "Not Linked"}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={reloadAll}
                          className="bg-white dark:bg-zinc-800 p-2 text-black dark:text-white border-2 border-black dark:border-white shadow-[1px_1px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                          title="Refresh connection status"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed font-bold">
                        {isAr 
                          ? "يرجى تشغيل بوت تليجرام والضغط على START لربط معرف الدردشة تلقائياً بحسابك." 
                          : "Please start our Telegram Bot and press START to automatically link your chat ID to this profile."}
                      </p>

                      <div className="flex flex-col gap-3 w-full">
                        <a
                          href={`https://t.me/${botUsername}?start=${user.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-12 w-full items-center justify-center gap-2 border-4 border-black dark:border-white bg-amber-300 dark:bg-amber-400 text-black font-black text-xs uppercase tracking-[0.1em] shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                        >
                          <Send className="w-4 h-4" />
                          {isAr ? "تشغيل البوت على تليجرام" : "Start Telegram Bot"}
                        </a>
                        <a
                          href={`https://web.telegram.org/a/#?tgaddr=tg%3A%2F%2Fresolve%3Fdomain%3D${botUsername}%26start%3D${user.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-10 w-full items-center justify-center gap-2 border-4 border-black dark:border-white bg-white dark:bg-zinc-800 text-black dark:text-white text-[10px] font-black uppercase tracking-[0.1em] shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[3px_3px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                        >
                          <Globe className="w-3.5 h-3.5" />
                          {isAr ? "افتح تليجرام ويب" : "Open in Telegram Web"}
                        </a>
                      </div>
                      
                      <div className="space-y-2 pt-3 border-t-4 border-black dark:border-zinc-800">
                        <label className="text-[10px] font-black text-black dark:text-white uppercase tracking-widest">
                          {isAr ? "معرف دردشة تليجرام اليدوي (اختياري)" : "Manual Telegram Chat ID (Optional)"}
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
                    <div className="w-full max-w-sm border-4 border-black dark:border-white bg-zinc-950 p-4 space-y-2 relative shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]">
                      <div className="flex items-center justify-between pb-2 border-b border-white/5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] font-black text-white">🤖</div>
                          <span className="text-[10px] font-bold text-zinc-300">EGX Bots AI</span>
                        </div>
                        <span className="text-[8px] text-zinc-500">now</span>
                      </div>
                      <div className="text-[11px] text-zinc-300 font-mono leading-relaxed space-y-1">
                        <div className="text-emerald-400 font-bold">🟢 NEW BUY SIGNAL</div>
                        <div>💎 Symbol: <span className="text-white">COMI</span></div>
                        <div>💰 Entry Price: <span className="text-white">124.50</span></div>
                        <div>🎯 Target ({defaultTargetPct}%): <span className="text-white">{(124.50 * (1 + parseFloat(defaultTargetPct || "10") / 100)).toFixed(2)}</span></div>
                        <div>🛡️ Stop Loss ({defaultStopPct}%): <span className="text-white">{(124.50 * (1 - parseFloat(defaultStopPct || "3.5") / 100)).toFixed(2)}</span></div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-3 text-center opacity-45">
                      <div className="w-12 h-12 border-4 border-black dark:border-zinc-650 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]">
                        <MessageSquare className="w-6 h-6 text-zinc-500" />
                      </div>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                        {isAr ? "قم بتفعيل الإشعارات لمعاينة التنبيهات" : "Enable alerts to preview message"}
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-4 text-[9px] text-zinc-500 text-center font-bold uppercase tracking-wider">
                  Real-time notification templates render dynamically
                </div>
              </div>
            </div>

            <button
              onClick={saveProfileSettings}
              disabled={savingDefaults}
              className="h-14 w-full neobrutal-btn neobrutal-bg-yellow font-black text-sm uppercase tracking-[0.2em] text-black flex items-center justify-center gap-3 relative overflow-hidden group"
            >
              {savingDefaults ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5 group-hover:scale-110 transition-transform" />}
              {isAr ? "حفظ الإعدادات" : "Save Settings"}
            </button>
          </section>
        </div>

      </div>

      {/* ── Per-Service Notification Subscriptions ── */}
      <section className="relative z-10 neobrutal-card p-6 sm:p-8 space-y-6 bg-white dark:bg-zinc-900 border-4 border-black dark:border-white shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b-4 border-black dark:border-zinc-800 pb-5">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 border-4 border-black dark:border-white bg-sky-500 text-white flex items-center justify-center shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)]">
                <Bell className="h-5 w-5" />
              </div>
              <h2 className="text-2xl font-black text-black dark:text-white uppercase tracking-tight">
                {isAr ? "الخدمات والتنبيهات" : "Services & Alerts"}
              </h2>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 font-black uppercase tracking-widest leading-relaxed">
              {isAr ? "تحكم في تفعيل التنبيهات لكل خدمة على حدة" : "Enable or disable Telegram alerts per service"}
            </p>
          </div>
          <div className="inline-flex items-center justify-center gap-2 h-10 px-4 border-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-950 text-black dark:text-white font-black text-xs uppercase tracking-widest shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]">
            {Object.keys(subscriptions).filter(k => subscriptions[k] === true).length} / 4 {isAr ? "مفعلة" : "Active"}
          </div>
        </div>

        {subsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
          </div>
        ) : !defaultTelegramChatId ? (
          <div className="min-h-[120px] border-4 border-dashed border-black/40 dark:border-white/30 bg-zinc-50 dark:bg-zinc-950/30 flex flex-col items-center justify-center gap-4 text-center p-8">
            <MessageSquare className="h-8 w-8 text-zinc-400" />
            <p className="max-w-md text-sm font-bold text-zinc-600 dark:text-zinc-400">
              {isAr ? "يرجى ربط تليجرام أولاً من إعدادات التنبيهات أعلاه" : "Please link Telegram first from the alert settings above"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { key: "technical_scanner", labelEn: "Technical Scanner", labelAr: "الماسح الفني", icon: <Activity className="w-5 h-5" />, color: "border-l-cyan-500" },
              { key: "stock_score", labelEn: "Stocks Score", labelAr: "تقييم الأسهم", icon: <BarChart3 className="w-5 h-5" />, color: "border-l-emerald-500" },
              { key: "historical_similarity", labelEn: "Historical Similarity", labelAr: "التشابه التاريخي", icon: <TrendingUp className="w-5 h-5" />, color: "border-l-purple-500" },
              { key: "ai_bot", labelEn: "AI Bot Signals", labelAr: "إشارات البوت الذكي", icon: <Brain className="w-5 h-5" />, color: "border-l-amber-500" },
            ].map((svc) => {
              const enabled = subscriptions[svc.key] ?? false;
              const toggling = togglingSubMap[svc.key] ?? false;
              return (
                <div
                  key={svc.key}
                  className={`border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-950/35 p-4 sm:p-5 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] flex items-center justify-between gap-4 ${svc.color} border-l-8`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 flex items-center justify-center border-2 ${enabled ? "bg-sky-500/20 border-sky-500/30" : "bg-zinc-800 border-zinc-700"}`}>
                      {svc.icon}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-black text-black dark:text-white uppercase tracking-tight">
                        {isAr ? svc.labelAr : svc.labelEn}
                      </h3>
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">
                        {enabled
                          ? (isAr ? "التنبيهات مفعلة" : "Alerts enabled")
                          : (isAr ? "التنبيهات متوقفة" : "Alerts disabled")}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleSubscription(svc.key)}
                    disabled={toggling}
                    className={`w-10 h-10 flex items-center justify-center border-4 border-black dark:border-white transition-all shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none ${
                      enabled
                        ? "bg-emerald-400 text-black"
                        : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700"
                    }`}
                    title={enabled ? (isAr ? "إيقاف التنبيهات" : "Disable alerts") : (isAr ? "تفعيل التنبيهات" : "Enable alerts")}
                  >
                    {toggling ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : enabled ? (
                      <Bell className="w-5 h-5" />
                    ) : (
                      <BellOff className="w-5 h-5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

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
              {isAr ? "القائمة الحقيقية المحفوظة على حسابك ويمكن تعديلها من هنا" : "Your real saved symbols, synced to your account and editable here"}
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
              {isAr ? "لا توجد أسهم محفوظة حتى الآن. افتح صفحة الشارت واضغط النجمة لإضافة سهم لقائمتك." : "No saved symbols yet. Open the chart page and press the star to add a symbol to your list."}
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
