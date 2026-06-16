"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Bell, BellOff, MessageCircle, Globe } from "lucide-react";
import Link from "next/link";

export type ServiceType = "stock_score" | "historical_similarity" | "technical_scanner" | "ai_bot";

interface TelegramServiceToggleProps {
    serviceType: ServiceType;
    botId?: string;
    title?: string;
    description?: string;
    className?: string;
}

const DEFAULT_BOT_USERNAME = "egxbots_bot";

export default function TelegramServiceToggle({
    serviceType,
    botId = serviceType,
    title,
    description,
    className = "",
}: TelegramServiceToggleProps) {
    const { user } = useAuth();
    const { language } = useLanguage();
    const isAr = language === "ar";
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);

    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState(false);
    const [telegramLinked, setTelegramLinked] = useState(false);
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);
    const [chatId, setChatId] = useState<string | null>(null);
    const [botUsername, setBotUsername] = useState(DEFAULT_BOT_USERNAME);

    const defaultTitle = {
        stock_score: { en: "Stocks Score Alerts", ar: "تنبيهات تقييم الأسهم" },
        historical_similarity: { en: "Historical Similarity Alerts", ar: "تنبيهات التشابه التاريخي" },
        technical_scanner: { en: "Technical Scanner Alerts", ar: "تنبيهات الماسح الفني" },
        ai_bot: { en: "AI Bot Alerts", ar: "تنبيهات بوت الذكاء الاصطناعي" },
    }[serviceType];

    const defaultDesc = {
        stock_score: { en: "Get daily stock score updates on Telegram", ar: "احصل على تحديثات تقييم الأسهم اليومية على تليجرام" },
        historical_similarity: { en: "Receive new historical similarity reports on Telegram", ar: "استلم تقارير التشابه التاريخي الجديدة على تليجرام" },
        technical_scanner: { en: "Get technical scanner matches on Telegram", ar: "استلم نتائج الماسح الفني على تليجرام" },
        ai_bot: { en: "Receive live AI bot signals on Telegram", ar: "استلم إشارات بوت الذكاء الاصطناعي المباشرة على تليجرام" },
    }[serviceType];

    const tTitle = title || (isAr ? defaultTitle.ar : defaultTitle.en);
    const tDesc = description || (isAr ? defaultDesc.ar : defaultDesc.en);

    useEffect(() => {
        fetch("/api/ai_bot/telegram/bot_username")
            .then((res) => res.json())
            .then((data) => {
                if (typeof data?.username === "string" && data.username.trim()) {
                    setBotUsername(data.username.trim());
                }
            })
            .catch((err) => console.error("Error fetching bot username:", err));
    }, []);

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }
        let active = true;
        async function load() {
            try {
                const { data: profile } = await supabase
                    .from("profiles")
                    .select("telegram_chat_id")
                    .eq("id", user!.id)
                    .maybeSingle();

                if (active && profile?.telegram_chat_id) {
                    setTelegramLinked(true);
                    setChatId(profile.telegram_chat_id);
                }

                const { data: subs } = await supabase
                    .from("bot_subscriptions")
                    .select("notifications_enabled, telegram_chat_id")
                    .eq("user_id", user!.id)
                    .eq("service_type", serviceType)
                    .maybeSingle();

                if (active && subs) {
                    setNotificationsEnabled(subs.notifications_enabled ?? true);
                    if (subs.telegram_chat_id) setChatId(subs.telegram_chat_id);
                }
            } catch (e) {
                console.error(`TelegramServiceToggle load error (${serviceType}):`, e);
            } finally {
                if (active) setLoading(false);
            }
        }
        load();
        return () => { active = false; };
    }, [user, supabase, serviceType]);

    const connectTelegramApp = () => {
        const userId = user?.id || "";
        window.open(`https://t.me/${botUsername}?start=${userId}`, "_blank");
    };

    const connectTelegramWeb = () => {
        const userId = user?.id || "";
        window.open(
            `https://web.telegram.org/a/#?tgaddr=tg%3A%2F%2Fresolve%3Fdomain%3D${botUsername}%26start%3D${userId}`,
            "_blank"
        );
    };

    const toggleNotifications = async () => {
        if (!user || toggling) return;
        setToggling(true);
        const newState = !notificationsEnabled;
        try {
            const { data: existing } = await supabase
                .from("bot_subscriptions")
                .select("id")
                .eq("user_id", user.id)
                .eq("service_type", serviceType)
                .maybeSingle();

            if (existing) {
                await supabase
                    .from("bot_subscriptions")
                    .update({ notifications_enabled: newState })
                    .eq("user_id", user.id)
                    .eq("service_type", serviceType);
            } else {
                await supabase.from("bot_subscriptions").insert({
                    user_id: user.id,
                    bot_id: botId,
                    service_type: serviceType,
                    notifications_enabled: newState,
                    telegram_chat_id: chatId,
                    created_at: new Date().toISOString(),
                });
            }
            setNotificationsEnabled(newState);
        } catch (e) {
            console.error(`Toggle notifications error (${serviceType}):`, e);
        } finally {
            setToggling(false);
        }
    };

    if (loading) {
        return (
            <div className={`border-2 border-white/10 bg-zinc-900/50 p-4 animate-pulse ${className}`}>
                <div className="h-5 w-40 bg-zinc-800 rounded" />
            </div>
        );
    }

    if (!user) {
        return (
            <div className={`border-2 border-white/10 bg-zinc-900/80 p-4 ${className}`}>
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 flex items-center justify-center border-2 bg-zinc-800 border-zinc-700">
                            <MessageCircle className="w-5 h-5 text-zinc-500" />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-white uppercase tracking-tight">{tTitle}</h3>
                            <p className="text-[10px] text-zinc-400 font-medium">
                                {isAr ? "سجل الدخول لتفعيل تنبيهات تليجرام" : "Login to enable Telegram alerts"}
                            </p>
                        </div>
                    </div>
                    <Link
                        href="/login"
                        className="h-9 px-4 border-2 border-zinc-600 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 font-bold uppercase text-xs flex items-center gap-2 transition-all duration-100"
                    >
                        {isAr ? "تسجيل الدخول" : "Login"}
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className={`border-2 border-white/10 bg-zinc-900/80 p-4 ${className}`}>
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 flex items-center justify-center border-2 ${telegramLinked ? "bg-sky-500/20 border-sky-500/30" : "bg-zinc-800 border-zinc-700"}`}>
                        <MessageCircle className={`w-5 h-5 ${telegramLinked ? "text-sky-400" : "text-zinc-500"}`} />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-white uppercase tracking-tight">{tTitle}</h3>
                        <p className="text-[10px] text-zinc-400 font-medium">
                            {telegramLinked
                                ? (isAr ? "✅ الحساب مربوط — استلم التنبيهات" : "✅ Account linked — receive alerts")
                                : tDesc}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {!telegramLinked ? (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={connectTelegramApp}
                                className="h-9 px-3 border-2 border-sky-500 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 font-bold uppercase text-xs flex items-center gap-2 shadow-[2px_2px_0px_rgba(14,165,233,0.3)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
                                title={isAr ? "افتح في تطبيق تليجرام" : "Open Telegram app"}
                            >
                                <MessageCircle className="w-4 h-4" />
                                {isAr ? "التطبيق" : "App"}
                            </button>
                            <button
                                onClick={connectTelegramWeb}
                                className="h-9 px-3 border-2 border-sky-500/60 bg-sky-500/5 text-sky-300 hover:bg-sky-500/15 font-bold uppercase text-xs flex items-center gap-2 shadow-[2px_2px_0px_rgba(14,165,233,0.2)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
                                title={isAr ? "افتح في متصفح تليجرام" : "Open Telegram Web"}
                            >
                                <Globe className="w-4 h-4" />
                                {isAr ? "المتصفح" : "Web"}
                            </button>
                        </div>
                    ) : (
                        <>
                            <button
                                onClick={toggleNotifications}
                                disabled={toggling}
                                className={`relative h-9 w-16 border-2 transition-all duration-200 ${
                                    notificationsEnabled
                                        ? "bg-emerald-500/20 border-emerald-500"
                                        : "bg-zinc-800 border-zinc-600"
                                }`}
                                aria-label={notificationsEnabled ? (isAr ? "تعطيل" : "Disable") : (isAr ? "تفعيل" : "Enable")}
                            >
                                <div className={`absolute top-1 w-5 h-5 bg-white shadow transition-all duration-200 ${
                                    notificationsEnabled ? "right-1" : "left-1"
                                }`} />
                            </button>
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                                {notificationsEnabled ? (
                                    <><Bell className="w-3.5 h-3.5 text-emerald-400" /> {isAr ? "مفعل" : "ON"}</>
                                ) : (
                                    <><BellOff className="w-3.5 h-3.5 text-zinc-500" /> {isAr ? "معطل" : "OFF"}</>
                                )}
                            </span>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
