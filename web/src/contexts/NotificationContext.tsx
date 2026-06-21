"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";

export type ServiceType = "stock_score" | "historical_similarity" | "technical_scanner" | "ai_bot";

interface NotificationContextType {
    telegramLinked: boolean;
    telegramChatId: string | null;
    notificationChannel: "telegram" | null;
    subscriptions: Record<string, boolean>;
    loading: boolean;
    toggling: Record<string, boolean>;
    botUsername: string;
    toggleSubscription: (serviceType: ServiceType, botId?: string) => Promise<void>;
    updateNotificationChannel: (channel: "telegram" | null) => Promise<void>;
    reloadAll: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const { language } = useLanguage();
    const isAr = language === "ar";
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);

    const [loading, setLoading] = useState(true);
    const [telegramLinked, setTelegramLinked] = useState(false);
    const [telegramChatId, setTelegramChatId] = useState<string | null>(null);
    const [notificationChannel, setNotificationChannel] = useState<"telegram" | null>(null);
    const [subscriptions, setSubscriptions] = useState<Record<string, boolean>>({});
    const [toggling, setToggling] = useState<Record<string, boolean>>({});
    const [botUsername, setBotUsername] = useState("egxbots_bot");

    // Fetch bot username
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

    // Load initial states
    const reloadAll = useCallback(async () => {
        if (!user) {
            setLoading(false);
            setTelegramLinked(false);
            setTelegramChatId(null);
            setNotificationChannel(null);
            setSubscriptions({});
            return;
        }

        try {
            const { data: profile } = await supabase
                .from("profiles")
                .select("telegram_chat_id, notification_channel")
                .eq("id", user.id)
                .maybeSingle();

            if (profile) {
                const chatIdVal = profile.telegram_chat_id || null;
                setTelegramChatId(chatIdVal);
                setTelegramLinked(!!chatIdVal);
                setNotificationChannel((profile.notification_channel as "telegram") || null);
            }

            const { data: subs } = await supabase
                .from("bot_subscriptions")
                .select("service_type, notifications_enabled")
                .eq("user_id", user.id);

            const subMap: Record<string, boolean> = {};
            if (subs) {
                for (const s of subs) {
                    if (s.service_type) {
                        subMap[s.service_type] = s.notifications_enabled ?? true;
                    }
                }
            }
            setSubscriptions(subMap);
        } catch (e) {
            console.error("Error reloading notifications data:", e);
        } finally {
            setLoading(false);
        }
    }, [supabase, user]);

    // Initial load and Real-time listener
    useEffect(() => {
        if (!user) {
            setLoading(false);
            setTelegramLinked(false);
            setTelegramChatId(null);
            setNotificationChannel(null);
            setSubscriptions({});
            return;
        }

        setLoading(true);
        void reloadAll();

        const channel = supabase
            .channel(`notifications-realtime-${user.id}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "profiles",
                    filter: `id=eq.${user.id}`
                },
                (payload: any) => {
                    const newProfile = payload.new;
                    if (newProfile) {
                        const chatIdVal = newProfile.telegram_chat_id || null;
                        setTelegramChatId(chatIdVal);
                        setTelegramLinked(!!chatIdVal);
                        setNotificationChannel((newProfile.notification_channel as "telegram") || null);
                    }
                }
            )
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "bot_subscriptions",
                    filter: `user_id=eq.${user.id}`
                },
                (payload: any) => {
                    const newRow = payload.new;
                    const oldRow = payload.old;
                    
                    if (payload.eventType === "DELETE" && oldRow) {
                        setSubscriptions(prev => {
                            const next = { ...prev };
                            delete next[oldRow.service_type];
                            return next;
                        });
                    } else if (newRow && newRow.service_type) {
                        setSubscriptions(prev => ({
                            ...prev,
                            [newRow.service_type]: newRow.notifications_enabled ?? true
                        }));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [reloadAll, supabase, user]);

    // Toggle service subscription
    const toggleSubscription = useCallback(async (serviceType: ServiceType, botId: string = "primary") => {
        if (!user) return;
        setToggling(prev => ({ ...prev, [serviceType]: true }));
        const newState = !subscriptions[serviceType];
        try {
            const { data: existing } = await supabase
                .from("bot_subscriptions")
                .select("id")
                .eq("user_id", user.id)
                .eq("service_type", serviceType)
                .maybeSingle();

            if (existing) {
                const { error } = await supabase
                    .from("bot_subscriptions")
                    .update({ notifications_enabled: newState })
                    .eq("user_id", user.id)
                    .eq("service_type", serviceType);
                if (error) throw error;
            } else {
                const { error } = await supabase.from("bot_subscriptions").insert({
                    user_id: user.id,
                    bot_id: "primary", // Force bot_id to "primary" to satisfy FK constraint to bot_configs
                    service_type: serviceType,
                    notifications_enabled: newState,
                    telegram_chat_id: telegramChatId,
                    created_at: new Date().toISOString(),
                });
                if (error) throw error;
            }

            // Sync with profiles table
            if (newState) {
                const { error } = await supabase
                    .from("profiles")
                    .update({ notification_channel: "telegram" })
                    .eq("id", user.id);
                if (error) throw error;
                setNotificationChannel("telegram");
            } else {
                const nextSubs = { ...subscriptions, [serviceType]: newState };
                const hasActive = Object.keys(nextSubs).some(k => nextSubs[k] === true);
                if (!hasActive) {
                    const { error } = await supabase
                        .from("profiles")
                        .update({ notification_channel: null })
                        .eq("id", user.id);
                    if (error) throw error;
                    setNotificationChannel(null);
                }
            }

            // Optimistic update
            setSubscriptions(prev => ({ ...prev, [serviceType]: newState }));
        } catch (e) {
            console.error(`Toggle subscription error (${serviceType}):`, e);
            toast.error(isAr ? "فشل تغيير حالة التنبيه" : "Failed to toggle alert status");
        } finally {
            setToggling(prev => ({ ...prev, [serviceType]: false }));
        }
    }, [supabase, user, subscriptions, telegramChatId, isAr]);

    // Update global notification channel
    const updateNotificationChannel = useCallback(async (channel: "telegram" | null) => {
        if (!user) return;
        setNotificationChannel(channel);
        try {
            const { error } = await supabase
                .from("profiles")
                .update({ notification_channel: channel })
                .eq("id", user.id);

            if (error) throw error;

            const isEnabled = channel === "telegram";

            // Update all subscriptions
            const { error: updateError } = await supabase
                .from("bot_subscriptions")
                .update({ notifications_enabled: isEnabled })
                .eq("user_id", user.id);
            if (updateError) throw updateError;

            // Create defaults if enabled and none exist
            if (isEnabled) {
                for (const type of ["stock_score", "historical_similarity", "technical_scanner", "ai_bot"]) {
                    const { data: existing } = await supabase
                        .from("bot_subscriptions")
                        .select("id")
                        .eq("user_id", user.id)
                        .eq("service_type", type)
                        .maybeSingle();

                    if (!existing) {
                        const { error: insertError } = await supabase.from("bot_subscriptions").insert({
                            user_id: user.id,
                            bot_id: "primary", // Force bot_id to "primary" to satisfy FK constraint to bot_configs
                            service_type: type,
                            notifications_enabled: true,
                            created_at: new Date().toISOString(),
                        });
                        if (insertError) throw insertError;
                    }
                }
            }

            // Optimistic update
            setSubscriptions(prev => {
                const next = { ...prev };
                for (const k of ["stock_score", "historical_similarity", "technical_scanner", "ai_bot"]) {
                    next[k] = isEnabled;
                }
                return next;
            });
        } catch (err: any) {
            console.error("Error updating notification channel:", err);
            toast.error(isAr ? `فشل تحديث القناة: ${err.message}` : `Failed to update channel: ${err.message}`);
        }
    }, [supabase, user, isAr]);

    const value = useMemo(() => ({
        telegramLinked,
        telegramChatId,
        notificationChannel,
        subscriptions,
        loading,
        toggling,
        botUsername,
        toggleSubscription,
        updateNotificationChannel,
        reloadAll
    }), [telegramLinked, telegramChatId, notificationChannel, subscriptions, loading, toggling, botUsername, toggleSubscription, updateNotificationChannel, reloadAll]);

    return (
        <NotificationContext.Provider value={value}>
            {children}
        </NotificationContext.Provider>
    );
}

export function useNotification() {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error("useNotification must be used within a NotificationProvider");
    }
    return context;
}
