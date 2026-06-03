"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Loader2, Save, Send, MessageSquare, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import UserBotsSection from "./components/UserBotsSection";

type ProfileRow = {
  default_target_pct: number;
  default_stop_pct: number;
  username: string | null;
  display_name: string | null;
  telegram_chat_id: string | null;
  notification_channel: "telegram" | "whatsapp" | null;
  whatsapp_number: string | null;
};

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [defaultsTarget, setDefaultsTarget] = useState("10");
  const [defaultsStop, setDefaultsStop] = useState("3.5");
  const [defaultTelegramChatId, setDefaultTelegramChatId] = useState("");
  const [notificationChannel, setNotificationChannel] = useState<"telegram" | "whatsapp">("telegram");
  const [whatsappNumber, setWhatsappNumber] = useState("");
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
      .select("default_target_pct, default_stop_pct, username, display_name, telegram_chat_id, notification_channel, whatsapp_number")
      .eq("id", user.id)
      .maybeSingle();

    if (profileRow) {
      setProfile(profileRow as ProfileRow);
      setDefaultsTarget(String((profileRow as any).default_target_pct ?? 10));
      setDefaultsStop(String((profileRow as any).default_stop_pct ?? 3.5));
      setDefaultTelegramChatId((profileRow as any).telegram_chat_id || "");
      setNotificationChannel(((profileRow as any).notification_channel as "telegram" | "whatsapp") || "telegram");
      setWhatsappNumber((profileRow as any).whatsapp_number || "");
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

    if (notificationChannel === "whatsapp") {
      const trimmed = whatsappNumber.trim().replace(/\+/g, "");
      if (trimmed && (!/^\d+$/.test(trimmed) || trimmed.length < 10 || trimmed.length > 15)) {
        alert(t("profile.notification.whatsapp.invalid"));
        return;
      }
    }

    setSavingDefaults(true);
    try {
      await supabase
        .from("profiles")
        .update({ 
          default_target_pct: target, 
          default_stop_pct: stop,
          telegram_chat_id: defaultTelegramChatId.trim() || null,
          notification_channel: notificationChannel,
          whatsapp_number: whatsappNumber.trim() || null
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
    <div className="flex flex-col gap-10 pb-20 max-w-[1600px] mx-auto mt-20 px-4">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-black tracking-tighter text-white uppercase italic">{t("nav.profile")}</h1>
        <p className="text-sm text-zinc-500 font-medium max-w-lg">{t("profile.track")}</p>
      </header>

      <div className="grid grid-cols-1 gap-8">
        {/* Trading Defaults & Notification Settings */}
        <section className="rounded-[2.5rem] border border-white/5 bg-zinc-950/40 p-8 shadow-2xl backdrop-blur-xl space-y-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/5 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/2" />

          <div className="relative">
            <h2 className="text-xl font-black text-white uppercase tracking-tight mb-2">Profile & Default Settings</h2>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest leading-relaxed">Default values used when saving watchlist signals and routing bot notifications</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative border-b border-white/5 pb-8">
            <div className="space-y-3">
              <label className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] ml-1">{t("profile.defaults.target")}</label>
              <div className="relative group">
                <input
                  type="number"
                  value={defaultsTarget}
                  onChange={(e) => setDefaultsTarget(e.target.value)}
                  className="h-14 w-full rounded-2xl border border-white/5 bg-zinc-900/50 px-5 text-lg font-black text-indigo-400 outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all font-mono"
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 font-black text-zinc-700">%</span>
              </div>
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] ml-1">{t("profile.defaults.stop")}</label>
              <div className="relative group">
                <input
                  type="number"
                  value={defaultsStop}
                  onChange={(e) => setDefaultsStop(e.target.value)}
                  className="h-14 w-full rounded-2xl border border-white/5 bg-zinc-900/50 px-5 text-lg font-black text-red-400 outline-none focus:ring-1 focus:ring-red-500/30 transition-all font-mono"
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 font-black text-zinc-700">%</span>
              </div>
            </div>
          </div>

          {/* Smart Notifications Settings & Preview */}
          <div className="space-y-4">
            <div className="relative">
              <h3 className="text-lg font-black text-white uppercase tracking-tight mb-1">{t("profile.notification.title")}</h3>
              <p className="text-xs text-zinc-500 font-medium leading-relaxed">{t("profile.notification.subtitle")}</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative">
              {/* Configuration panel */}
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] ml-1">
                    {t("profile.notification.channel.select")}
                  </label>
                  <div className="grid grid-cols-2 gap-4 p-1.5 rounded-2xl bg-zinc-900/80 border border-white/5">
                    <button
                      type="button"
                      onClick={() => setNotificationChannel("telegram")}
                      className={`h-12 rounded-xl text-xs font-black uppercase tracking-[0.1em] transition-all duration-300 flex items-center justify-center gap-2 ${
                        notificationChannel === "telegram"
                          ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                      }`}
                    >
                      <Send className="w-4 h-4" />
                      {t("profile.notification.channel.telegram")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setNotificationChannel("whatsapp")}
                      className={`h-12 rounded-xl text-xs font-black uppercase tracking-[0.1em] transition-all duration-300 flex items-center justify-center gap-2 ${
                        notificationChannel === "whatsapp"
                          ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                      }`}
                    >
                      <MessageSquare className="w-4 h-4" />
                      {t("profile.notification.channel.whatsapp")}
                    </button>
                  </div>
                </div>

                {/* Telegram Config UI */}
                {notificationChannel === "telegram" && (
                  <div className="space-y-4 transition-all duration-300">
                    <div className="p-5 rounded-3xl border border-white/5 bg-zinc-900/30 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">{t("profile.notification.telegram.status")}</span>
                          {defaultTelegramChatId ? (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {t("profile.notification.telegram.linked")}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                              <AlertCircle className="w-3.5 h-3.5" />
                              {t("profile.notification.telegram.not_linked")}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={reloadAll}
                          className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                          title="Refresh connection status"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <p className="text-xs text-zinc-400 leading-relaxed font-semibold">
                        {t("profile.notification.telegram.desc")}
                      </p>

                      <a
                        href={`https://t.me/${botUsername}?start=${user.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600/90 text-xs font-black uppercase tracking-[0.1em] text-white hover:bg-indigo-500 transition-all shadow-md hover:shadow-indigo-500/10 active:scale-[0.98]"
                      >
                        <Send className="w-4 h-4" />
                        {t("profile.notification.telegram.btn")}
                      </a>
                      
                      <div className="space-y-2 pt-2 border-t border-white/5">
                        <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">
                          Manual Telegram Chat ID (Optional)
                        </label>
                        <input
                          type="text"
                          value={defaultTelegramChatId}
                          onChange={(e) => setDefaultTelegramChatId(e.target.value)}
                          placeholder="e.g. 987654321"
                          className="h-10 w-full rounded-xl border border-white/5 bg-zinc-950 px-4 text-xs font-black text-zinc-300 outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all font-mono"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* WhatsApp Config UI */}
                {notificationChannel === "whatsapp" && (
                  <div className="space-y-4 transition-all duration-300">
                    <div className="p-5 rounded-3xl border border-white/5 bg-zinc-900/30 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">{t("profile.notification.whatsapp.status")}</span>
                          {profile?.whatsapp_number && notificationChannel === "whatsapp" ? (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {t("profile.notification.whatsapp.linked")}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                              <AlertCircle className="w-3.5 h-3.5" />
                              {t("profile.notification.telegram.not_linked")}
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-zinc-400 leading-relaxed font-semibold">
                        {t("profile.notification.whatsapp.desc")}
                      </p>

                      <div className="space-y-2">
                        <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">
                          {t("profile.notification.whatsapp.label")}
                        </label>
                        <input
                          type="text"
                          value={whatsappNumber}
                          onChange={(e) => setWhatsappNumber(e.target.value)}
                          placeholder={t("profile.notification.whatsapp.placeholder")}
                          className="h-12 w-full rounded-xl border border-white/5 bg-zinc-950 px-4 text-sm font-black text-emerald-400 placeholder:text-zinc-700 outline-none focus:ring-1 focus:ring-emerald-500/30 transition-all font-mono"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Preview mockup panel */}
              <div className="p-6 rounded-3xl border border-white/5 bg-zinc-900/10 flex flex-col justify-between relative overflow-hidden min-h-[300px]">
                <div className="absolute top-0 left-0 w-32 h-32 bg-indigo-600/5 blur-[50px] rounded-full -translate-x-1/2 -translate-y-1/2" />
                
                <span className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em] ml-1 mb-4 block">Live Alert Preview</span>
                
                <div className="flex-1 flex items-center justify-center w-full">
                  {notificationChannel === "telegram" ? (
                    <div className="w-full max-w-sm rounded-2xl bg-zinc-900 p-4 border border-white/5 space-y-2 relative shadow-2xl">
                      <div className="flex items-center justify-between pb-2 border-b border-white/5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] font-black text-white">🤖</div>
                          <span className="text-[10px] font-bold text-zinc-300">Artoro Bot</span>
                        </div>
                        <span className="text-[8px] text-zinc-600">now</span>
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
                    <div className="w-full max-w-sm rounded-2xl bg-[#0b141a] p-4 border border-[#202c33] space-y-2 relative shadow-2xl">
                      <div className="flex items-center justify-between pb-2 border-b border-[#202c33]">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-[#128c7e] flex items-center justify-center text-[10px] font-black text-white">💬</div>
                          <span className="text-[10px] font-bold text-zinc-300">EGX Bots Alerts</span>
                        </div>
                        <span className="text-[8px] text-zinc-600">now</span>
                      </div>
                      <div className="text-[11px] text-zinc-300 font-mono leading-relaxed space-y-1">
                        <div className="text-emerald-400 font-bold">🟢 NEW BUY SIGNAL</div>
                        <div>💎 Symbol: <span className="text-white">COINS</span></div>
                        <div>💰 Entry Price: <span className="text-white">12.4500</span></div>
                        <div>🎯 Target ({defaultsTarget}%): <span className="text-white">{(12.4500 * (1 + Number(defaultsTarget)/100)).toFixed(4)}</span></div>
                        <div>🛡️ Stop Loss ({defaultsStop}%): <span className="text-white">{(12.4500 * (1 - Number(defaultsStop)/100)).toFixed(4)}</span></div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 text-[9px] text-zinc-600 text-center font-bold uppercase tracking-wider">
                  Real-time notification templates render dynamically in English & Arabic
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={saveDefaults}
            disabled={savingDefaults}
            className="h-14 w-full rounded-2xl bg-indigo-600 text-[11px] font-black uppercase tracking-[0.2em] text-white shadow-xl shadow-indigo-600/20 hover:bg-indigo-500 transition-all active:scale-[0.98] flex items-center justify-center gap-3 relative overflow-hidden group"
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
