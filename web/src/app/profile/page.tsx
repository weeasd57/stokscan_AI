"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Loader2, Save } from "lucide-react";
import UserBotsSection from "./components/UserBotsSection";

type ProfileRow = {
  default_target_pct: number;
  default_stop_pct: number;
  username: string | null;
  display_name: string | null;
  telegram_chat_id: string | null;
};

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [defaultsTarget, setDefaultsTarget] = useState("5");
  const [defaultsStop, setDefaultsStop] = useState("2");
  const [defaultTelegramChatId, setDefaultTelegramChatId] = useState("");
  const [savingDefaults, setSavingDefaults] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  const reloadAll = useCallback(async () => {
    if (!user) return;

    const { data: profileRow } = await supabase
      .from("profiles")
      .select("default_target_pct, default_stop_pct, username, display_name, telegram_chat_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileRow) {
      setProfile(profileRow as ProfileRow);
      setDefaultsTarget(String((profileRow as any).default_target_pct ?? 5));
      setDefaultsStop(String((profileRow as any).default_stop_pct ?? 2));
      setDefaultTelegramChatId((profileRow as any).telegram_chat_id || "");
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
          telegram_chat_id: defaultTelegramChatId.trim() || null
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
        {/* Trading Defaults & Telegram Settings */}
        <section className="rounded-[2.5rem] border border-white/5 bg-zinc-950/40 p-8 shadow-2xl backdrop-blur-xl space-y-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/5 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/2" />

          <div className="relative">
            <h2 className="text-xl font-black text-white uppercase tracking-tight mb-2">Profile & Default Settings</h2>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest leading-relaxed">Default values used when saving watchlist signals and routing bot notifications</p>
          </div>

          <div className="grid grid-cols-2 gap-6 relative">
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

          {/* Telegram Settings */}
          <div className="space-y-3 relative">
            <label className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] ml-1">Default Telegram Chat ID</label>
            <div className="relative group">
              <input
                type="text"
                value={defaultTelegramChatId}
                onChange={(e) => setDefaultTelegramChatId(e.target.value)}
                placeholder="e.g. -100123456789 or 987654321"
                className="h-14 w-full rounded-2xl border border-white/5 bg-zinc-900/50 px-5 text-sm font-black text-zinc-200 outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all font-mono placeholder:text-zinc-700"
              />
            </div>
            <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-wider leading-relaxed">
              * Configure your Telegram default chat ID here. Signal notifications will be sent to this chat if a bot-specific chat ID is not set. Go message the bot on Telegram and send <code className="text-zinc-500 font-mono">/start</code> to obtain your Chat ID.
            </p>
          </div>

          <button
            onClick={saveDefaults}
            disabled={savingDefaults}
            className="h-14 w-full rounded-2xl bg-indigo-600 text-[11px] font-black uppercase tracking-[0.2em] text-white shadow-xl shadow-indigo-600/20 hover:bg-indigo-500 transition-all active:scale-[0.98] flex items-center justify-center gap-3 relative overflow-hidden group"
          >
            {savingDefaults ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5 group-hover:scale-110 transition-transform" />}
            Save Default Settings
          </button>
        </section>
      </div>

      {/* AI Bots Section */}
      <UserBotsSection />

    </div>
  );
}
