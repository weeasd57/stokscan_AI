"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export interface SavedSymbol {
    id: string;
    symbol: string;
    name: string;
    source: "home" | "ai_scanner" | "tech_scanner";
    addedAt: string;
    metadata: any;
    targetPct?: number;
    stopPct?: number;
    entryPrice?: number | null;
    status?: "open" | "hit_target" | "hit_stop" | "closed_manual";
}

interface WatchlistContextType {
    watchlist: SavedSymbol[];
    saveSymbol: (item: Omit<SavedSymbol, "id" | "addedAt">) => void;
    updateSymbol: (id: string, updates: Partial<Pick<SavedSymbol, "name" | "targetPct" | "stopPct" | "entryPrice" | "metadata">>) => Promise<boolean>;
    removeSymbol: (id: string) => void;
    removeSymbolBySymbol: (symbol: string) => void;
    isSaved: (symbol: string) => boolean;
}

const WatchlistContext = createContext<WatchlistContextType | undefined>(undefined);

export const WatchlistProvider = ({ children }: { children: ReactNode }) => {
    const [watchlist, setWatchlist] = useState<SavedSymbol[]>([]);

    const { user } = useAuth();
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);

    // Refs to prevent redundant API calls
    const hasInitializedRef = useRef(false);
    const lastFetchedAtRef = useRef<number>(0);
    const lastUserIdRef = useRef<string | null>(null);
    const STALE_TIME_MS = 60 * 1000; // 1 minute

    function safeParseStored(raw: string | null): SavedSymbol[] | null {
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw) as SavedSymbol[];
            if (!Array.isArray(parsed)) return null;
            return parsed;
        } catch {
            return null;
        }
    }

    useEffect(() => {
        let cancelled = false;

        async function load() {
            if (!user) {
                setWatchlist([]);
                hasInitializedRef.current = false;
                lastUserIdRef.current = null;
                return;
            }

            // Skip if already loaded for this user and data is fresh
            const now = Date.now();
            const isSameUser = lastUserIdRef.current === user.id;
            const isFresh = (now - lastFetchedAtRef.current) < STALE_TIME_MS;
            if (hasInitializedRef.current && isSameUser && isFresh) {
                return;
            }

            const { data: profile } = await supabase
                .from("profiles")
                .select("default_target_pct, default_stop_pct")
                .eq("id", user.id)
                .maybeSingle();

            const local = safeParseStored(localStorage.getItem("ai_stocks_watchlist"));
            if (local && local.length > 0) {
                const { data: existing } = await supabase
                    .from("positions")
                    .select("symbol")
                    .eq("user_id", user.id)
                    .eq("status", "open");

                const existingSymbols = new Set((existing ?? []).map((r: any) => String(r.symbol).toUpperCase()));

                const uniqueLocal = Array.from(
                    new Map(local.filter((i) => i?.symbol).map((i) => [String(i.symbol).toUpperCase(), i] as const)).values()
                );

                const defaultTarget = Number(profile?.default_target_pct ?? 10);
                const defaultStop = Number(profile?.default_stop_pct ?? 3.5);

                const rows = uniqueLocal
                    .filter((i) => i?.symbol && !existingSymbols.has(String(i.symbol).toUpperCase()))
                    .map((i) => {
                        const entryPrice =
                            typeof (i as any).entryPrice === "number"
                                ? (i as any).entryPrice
                                : typeof i.metadata?.price === "number"
                                    ? i.metadata.price
                                    : typeof i.metadata?.last_close === "number"
                                        ? i.metadata.last_close
                                        : null;

                        return {
                            user_id: user.id,
                            symbol: String(i.symbol).toUpperCase(),
                            name: i.name,
                            source: i.source,
                            metadata: i.metadata ?? {},
                            entry_price: entryPrice,
                            entry_at: entryPrice ? i.addedAt : null,
                            target_pct: Number(i.targetPct ?? defaultTarget),
                            stop_pct: Number(i.stopPct ?? defaultStop),
                            added_at: i.addedAt,
                        };
                    });

                if (rows.length > 0) {
                    const { error } = await supabase.from("positions").insert(rows);
                    if (!error) {
                        localStorage.removeItem("ai_stocks_watchlist");
                    }
                } else {
                    localStorage.removeItem("ai_stocks_watchlist");
                }
            }

            const { data, error } = await supabase
                .from("positions")
                .select("id, symbol, name, source, added_at, metadata, target_pct, stop_pct, entry_price, status")
                .eq("user_id", user.id)
                .eq("status", "open")
                .order("added_at", { ascending: false });

            if (cancelled) return;
            if (error || !data) {
                setWatchlist([]);
                return;
            }

            setWatchlist(
                data.map((r: any) => ({
                    id: r.id,
                    symbol: String(r.symbol).toUpperCase(),
                    name: r.name,
                    source: r.source,
                    addedAt: r.added_at,
                    metadata: r.metadata ?? {},
                    targetPct: r.target_pct ?? undefined,
                    stopPct: r.stop_pct ?? undefined,
                    entryPrice: r.entry_price ?? null,
                    status: r.status ?? "open",
                }))
            );

            // Mark as initialized
            hasInitializedRef.current = true;
            lastFetchedAtRef.current = Date.now();
            lastUserIdRef.current = user.id;
        }

        void load();
        return () => {
            cancelled = true;
        };
    }, [supabase, user]);

    const isSaved = useCallback((symbol: string) => {
        const s = String(symbol).toUpperCase();
        return watchlist.some((item) => String(item.symbol).toUpperCase() === s);
    }, [watchlist]);

    const saveSymbol = useCallback(async (item: Omit<SavedSymbol, "id" | "addedAt">) => {
        if (!user) {
            window.location.href = "/login";
            return;
        }
        if (isSaved(item.symbol)) return;

        // Fetch profile defaults
        const { data: profile } = await supabase
            .from("profiles")
            .select("default_target_pct, default_stop_pct")
            .eq("id", user.id)
            .maybeSingle();

        const suggestedTarget = Number((item as any).targetPct ?? profile?.default_target_pct ?? 10);
        const suggestedStop = Number((item as any).stopPct ?? profile?.default_stop_pct ?? 3.5);

        // DIALOG REMOVED - Directly save with default values (no modal)
        const entryPrice =
            typeof (item as any).entryPrice === "number"
                ? (item as any).entryPrice
                : typeof (item as any).metadata?.price === "number"
                    ? (item as any).metadata.price
                    : typeof (item as any).metadata?.last_close === "number"
                        ? (item as any).metadata.last_close
                        : null;

        const { data, error } = await supabase
            .from("positions")
            .insert({
                user_id: user.id,
                symbol: String(item.symbol).toUpperCase(),
                name: item.name,
                source: item.source,
                metadata: item.metadata ?? {},
                entry_price: entryPrice,
                entry_at: entryPrice ? new Date().toISOString() : null,
                target_pct: suggestedTarget,
                stop_pct: suggestedStop,
            })
            .select("id, symbol, name, source, added_at, metadata, target_pct, stop_pct, entry_price, status")
            .single();

        if (error || !data) return;

        setWatchlist((prev) => [
            {
                id: data.id,
                symbol: String(data.symbol).toUpperCase(),
                name: data.name,
                source: data.source,
                addedAt: data.added_at,
                metadata: data.metadata ?? {},
                targetPct: data.target_pct ?? undefined,
                stopPct: data.stop_pct ?? undefined,
                entryPrice: data.entry_price ?? null,
                status: data.status ?? "open",
            },
            ...prev,
        ]);
    }, [user, supabase, isSaved]);

    const confirmSave = useCallback(async (targetPct: number, stopPct: number, itemToSave: Omit<SavedSymbol, "id" | "addedAt">) => {
        if (!itemToSave || !user) return;

        const item = itemToSave;
        const entryPrice =
            typeof (item as any).entryPrice === "number"
                ? (item as any).entryPrice
                : typeof (item as any).metadata?.price === "number"
                    ? (item as any).metadata.price
                    : typeof (item as any).metadata?.last_close === "number"
                        ? (item as any).metadata.last_close
                        : null;

        const { data, error } = await supabase
            .from("positions")
            .insert({
                user_id: user.id,
                symbol: String(item.symbol).toUpperCase(),
                name: item.name,
                source: item.source,
                metadata: item.metadata ?? {},
                entry_price: entryPrice,
                entry_at: entryPrice ? new Date().toISOString() : null,
                target_pct: targetPct,
                stop_pct: stopPct,
            })
            .select("id, symbol, name, source, added_at, metadata, target_pct, stop_pct, entry_price, status")
            .single();

        if (error || !data) return;

        setWatchlist((prev) => [
            {
                id: data.id,
                symbol: String(data.symbol).toUpperCase(),
                name: data.name,
                source: data.source,
                addedAt: data.added_at,
                metadata: data.metadata ?? {},
                targetPct: data.target_pct ?? undefined,
                stopPct: data.stop_pct ?? undefined,
                entryPrice: data.entry_price ?? null,
                status: data.status ?? "open",
            },
            ...prev,
        ]);
    }, [user, supabase]);

    const updateSymbol = useCallback(async (id: string, updates: Partial<Pick<SavedSymbol, "name" | "targetPct" | "stopPct" | "entryPrice" | "metadata">>) => {
        if (!user) return false;

        const patch: Record<string, any> = {};
        if (updates.name !== undefined) patch.name = updates.name;
        if (updates.targetPct !== undefined) patch.target_pct = updates.targetPct;
        if (updates.stopPct !== undefined) patch.stop_pct = updates.stopPct;
        if (updates.entryPrice !== undefined) patch.entry_price = updates.entryPrice;
        if (updates.metadata !== undefined) patch.metadata = updates.metadata;

        const { data, error } = await supabase
            .from("positions")
            .update(patch)
            .eq("id", id)
            .eq("user_id", user.id)
            .select("id, symbol, name, source, added_at, metadata, target_pct, stop_pct, entry_price, status")
            .single();

        if (error || !data) return false;

        setWatchlist((prev) => prev.map((item) => item.id === id ? {
            id: data.id,
            symbol: String(data.symbol).toUpperCase(),
            name: data.name,
            source: data.source,
            addedAt: data.added_at,
            metadata: data.metadata ?? {},
            targetPct: data.target_pct ?? undefined,
            stopPct: data.stop_pct ?? undefined,
            entryPrice: data.entry_price ?? null,
            status: data.status ?? "open",
        } : item));

        return true;
    }, [user, supabase]);

    const removeSymbol = useCallback((id: string) => {
        if (!user) return;
        void (async () => {
            const { error } = await supabase.from("positions").delete().eq("id", id).eq("user_id", user.id);
            if (error) return;
            setWatchlist((prev) => prev.filter((item) => item.id !== id));
        })();
    }, [user, supabase]);

    const removeSymbolBySymbol = useCallback((symbol: string) => {
        if (!user) return;
        const normalized = symbol.toUpperCase().trim();
        const item = watchlist.find(w => w.symbol.toUpperCase() === normalized);
        if (item) {
            removeSymbol(item.id);
        }
    }, [user, watchlist, removeSymbol]);

    return (
        <WatchlistContext.Provider value={{ watchlist, saveSymbol, updateSymbol, removeSymbol, removeSymbolBySymbol, isSaved }}>
            {children}
            {/* TargetStopModal - REMOVED AS PER USER REQUEST */}
        </WatchlistContext.Provider>
    );
};

export const useWatchlist = () => {
    const context = useContext(WatchlistContext);
    if (context === undefined) {
        throw new Error("useWatchlist must be used within a WatchlistProvider");
    }
    return context;
};
