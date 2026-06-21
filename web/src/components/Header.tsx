"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import {
    Globe, BarChart2, Brain, Activity, Menu, X, User, ChevronDown,
    Search, Loader2, Sun, Moon, TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { searchSymbols } from "@/lib/api";

const POPULAR_EGX_STOCKS = [
    { symbol: "COMI", name: "Commercial International Bank", exchange: "EGX", country: "Egypt" },
    { symbol: "FWRY", name: "Fawry for Banking & Payment Technology", exchange: "EGX", country: "Egypt" },
    { symbol: "TMGH", name: "Talaat Moustafa Group", exchange: "EGX", country: "Egypt" },
    { symbol: "EAST", name: "Eastern Company", exchange: "EGX", country: "Egypt" },
    { symbol: "AALR", name: "General Co. for Land Reclamation", exchange: "EGX", country: "Egypt" },
];

type SearchResult = { symbol: string; name?: string; exchange?: string };

function SearchDropdown({
    language,
    searchQuery,
    searching,
    searchResults,
    onSelect,
}: {
    language: string;
    searchQuery: string;
    searching: boolean;
    searchResults: SearchResult[];
    onSelect: (symbol: string) => void;
}) {
    if (!searchQuery.trim()) {
        return (
            <div className="flex flex-col">
                <div className="px-4 py-2 text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest border-b-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 select-none">
                    {language === "ar" ? "الأسهم المصرية الأكثر شعبية" : "Popular EGX Stocks"}
                </div>
                {POPULAR_EGX_STOCKS.map((result) => (
                    <button
                        key={result.symbol}
                        onClick={() => onSelect(result.symbol)}
                        className="flex items-center justify-between w-full px-4 py-2.5 rounded-none text-left border-b border-black/10 dark:border-white/10 last:border-b-0 hover:bg-[#FFE600] hover:text-black transition-none group/item text-black dark:text-white"
                    >
                        <div className="flex flex-col min-w-0">
                            <span className="text-xs font-black text-black dark:text-white group-hover/item:text-black">{result.symbol}</span>
                            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold truncate max-w-[200px] sm:max-w-[260px] group-hover/item:text-black/80">
                                {result.name}
                            </span>
                        </div>
                        <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-none bg-[#00FF66] text-black border-2 border-black shrink-0">
                            EGX
                        </span>
                    </button>
                ))}
            </div>
        );
    }

    if (searching) {
        return (
            <div className="flex items-center justify-center py-5 text-zinc-500 gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                <span>{language === "ar" ? "جاري البحث..." : "Searching..."}</span>
            </div>
        );
    }

    if (searchResults.length > 0) {
        return (
            <div className="flex flex-col">
                {searchResults.map((result) => (
                    <button
                        key={result.symbol}
                        onClick={() => onSelect(result.symbol)}
                        className="flex items-center justify-between w-full px-4 py-2.5 rounded-none text-left border-b border-black/10 dark:border-white/10 last:border-b-0 hover:bg-[#FFE600] hover:text-black transition-none group/item text-black dark:text-white"
                    >
                        <div className="flex flex-col min-w-0">
                            <span className="text-xs font-black text-black dark:text-white group-hover/item:text-black">{result.symbol}</span>
                            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold truncate max-w-[200px] sm:max-w-[260px] group-hover/item:text-black/80">
                                {result.name}
                            </span>
                        </div>
                        <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-none bg-[#00FF66] text-black border-2 border-black shrink-0">
                            EGX
                        </span>
                    </button>
                ))}
            </div>
        );
    }

    return (
        <div className="text-center py-6 text-xs text-zinc-500 font-black uppercase tracking-widest border-t-2 border-black bg-zinc-50 dark:bg-zinc-900 dark:border-white">
            {language === "ar" ? "لا توجد نتائج" : "No symbols found"}
        </div>
    );
}

export default function Header() {
    const { language, setLanguage, t } = useLanguage();
    const { theme, toggleTheme } = useTheme();
    const { user, signOut } = useAuth();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const router = useRouter();
    const currentTab = searchParams.get("tab");

    const shellRef = useRef<HTMLDivElement>(null);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchFocused, setSearchFocused] = useState(false);

    const updateHeaderOffset = useCallback(() => {
        const shell = shellRef.current;
        if (!shell) return;
        const bottom = shell.getBoundingClientRect().bottom;
        document.documentElement.style.setProperty("--header-offset", `${Math.ceil(bottom + 8)}px`);
    }, []);

    useEffect(() => {
        setMobileMenuOpen(false);
        setMobileSearchOpen(false);
        setAccountMenuOpen(false);
    }, [pathname]);

    useEffect(() => {
        updateHeaderOffset();
        const shell = shellRef.current;
        if (!shell) return;

        const observer = new ResizeObserver(updateHeaderOffset);
        observer.observe(shell);
        window.addEventListener("resize", updateHeaderOffset);

        return () => {
            observer.disconnect();
            window.removeEventListener("resize", updateHeaderOffset);
        };
    }, [updateHeaderOffset, mobileMenuOpen, mobileSearchOpen, searchFocused, user]);

    useEffect(() => {
        if (!searchQuery.trim()) {
            setSearchResults([]);
            return;
        }

        const delayDebounce = setTimeout(async () => {
            setSearching(true);
            try {
                const results = await searchSymbols(searchQuery, undefined, 50, undefined, undefined, "EGX");
                setSearchResults(results);
            } catch (err) {
                console.error("Error searching symbols:", err);
            } finally {
                setSearching(false);
            }
        }, 200);

        return () => clearTimeout(delayDebounce);
    }, [searchQuery]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                if (window.innerWidth < 640) {
                    setMobileSearchOpen(true);
                    setMobileMenuOpen(false);
                    setTimeout(() => document.getElementById("header-search-input-mobile")?.focus(), 50);
                } else {
                    document.getElementById("header-search-input")?.focus();
                }
            } else if (e.key === "/") {
                const active = document.activeElement?.tagName.toLowerCase();
                if (active !== "input" && active !== "textarea") {
                    e.preventDefault();
                    if (window.innerWidth < 640) {
                        setMobileSearchOpen(true);
                        setMobileMenuOpen(false);
                        setTimeout(() => document.getElementById("header-search-input-mobile")?.focus(), 50);
                    } else {
                        document.getElementById("header-search-input")?.focus();
                    }
                }
            } else if (e.key === "Escape") {
                setSearchFocused(false);
                setSearchQuery("");
                setMobileSearchOpen(false);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const container = document.getElementById("header-search-container");
            if (container && !container.contains(e.target as Node)) {
                setSearchFocused(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const navItems = [
        { href: "/scanner/backtests?tab=bots", label: t("nav.scanner.ai_trading"), icon: <Brain className="w-4 h-4 shrink-0" />, activePath: "/scanner/backtests", badge: "AI DEMO" },
        { href: "/scanner/technical", label: t("nav.scanner.tech"), icon: <Activity className="w-4 h-4 shrink-0" />, activePath: "/scanner/technical" },
        { href: "/scanner/backtests?tab=similarity", label: t("nav.scanner.similarity"), icon: <TrendingUp className="w-4 h-4 shrink-0" />, activePath: null },
    ];

    const checkActive = (href: string, activePath: string | null) => {
        if (href.includes("?tab=backtests")) {
            return pathname === "/scanner/backtests" && currentTab === "backtests";
        }
        if (href.includes("?tab=bots")) {
            return pathname === "/scanner/backtests" && currentTab === "bots";
        }
        if (href.includes("?tab=similarity")) {
            return pathname === "/scanner/backtests" && currentTab === "similarity";
        }
        return activePath ? pathname === activePath : pathname === href;
    };

    const handleSymbolSelect = (symbol: string) => {
        setSearchQuery("");
        setSearchFocused(false);
        setMobileSearchOpen(false);
        setMobileMenuOpen(false);
        const baseSym = symbol.split('.')[0].toLowerCase();
        router.push(`/stocks/${baseSym}`);
    };

    if (pathname === "/antigrafity" || pathname?.startsWith("/antigrafity")) {
        return null;
    }

    return (
        <header className="fixed top-0 left-0 right-0 z-[100] w-full border-b-4 border-black dark:border-white bg-white dark:bg-zinc-950 header-stable" dir="ltr">
            <div ref={shellRef} className="mx-auto max-w-[1800px] w-full px-4 md:px-8 py-3 flex items-center justify-between gap-4">
                {/* Brand */}
                <div className="flex items-center min-w-0">
                    <Link href="/" className="group flex items-center gap-2 sm:gap-2.5 min-w-0">
                        <div className="relative bg-white p-1 rounded-none border-4 border-black dark:border-white transition-all duration-300 group-hover:scale-110 group-hover:rotate-6 flex-shrink-0 flex items-center justify-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.5)]">
                                <Image
                                    src="/favicon_io/apple-touch-icon.png"
                                    alt="EGX Bots logo"
                                    width={32}
                                    height={32}
                                    className="object-contain w-7 h-7 sm:w-8 sm:h-8"
                                    priority
                                />
                            </div>
                            <div className="hidden min-[420px]:flex flex-col min-w-0 header-title max-w-[120px] sm:max-w-none">
                                <span className="text-sm sm:text-base font-black tracking-tight text-black dark:text-white leading-tight truncate uppercase animate-in slide-in-from-left-2 duration-700">
                                    {t("app.title")}
                                </span>
                                <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.18em] font-black text-black/70 dark:text-white/70 leading-none truncate hidden sm:block">
                                    {t("header.pro_analysis")}
                                </span>
                            </div>
                        </Link>
                    </div>

                    {/* Center: search + nav */}
                    <div className="header-center min-w-0">
                        <div
                            id="header-search-container"
                            className={`relative min-w-0 hidden md:flex ${searchFocused ? "flex-1 max-w-md lg:max-w-lg" : "w-full max-w-[9rem] md:max-w-[11rem] lg:max-w-[14rem] xl:max-w-xs"} transition-all duration-300 animate-in fade-in duration-700 delay-100`}
                        >
                            <div className="relative flex items-center w-full">
                                <Search className="absolute left-3 w-4 h-4 text-black/60 dark:text-white/60 pointer-events-none z-10" />
                                <input
                                    id="header-search-input"
                                    type="text"
                                    placeholder={language === "ar" ? "ابحث عن سهم..." : "Search EGX..."}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onFocus={() => setSearchFocused(true)}
                                    className="h-9 w-full rounded-none pl-9 pr-8 text-xs font-black outline-none border-3 border-black bg-white dark:bg-zinc-900 text-black dark:text-white placeholder-black/50 dark:placeholder-white/50 focus:bg-[#FFE600] focus:text-black transition-none"
                                />
                                <kbd className="absolute right-3 px-1.5 py-0.5 rounded text-[9px] font-mono pointer-events-none uppercase hidden md:inline bg-black/10 dark:bg-white/10 text-black dark:text-white font-black border-2 border-black/20 dark:border-white/20">
                                    /
                                </kbd>
                            </div>

                            {searchFocused && (
                                <div className="absolute top-11 left-0 right-0 max-h-72 overflow-y-auto rounded-none p-0 z-50 animate-in fade-in slide-in-from-top-1 duration-200 custom-scrollbar bg-white dark:bg-zinc-950 border-4 border-black dark:border-white shadow-[6px_6px_0px_0px_#FFE600]">
                                    <SearchDropdown
                                        language={language}
                                        searchQuery={searchQuery}
                                        searching={searching}
                                        searchResults={searchResults}
                                        onSelect={handleSymbolSelect}
                                    />
                                </div>
                            )}
                        </div>

                        <nav className="hidden md:flex items-center gap-1 py-1 px-1 rounded-xl shrink-0 animate-in fade-in duration-700 delay-200">
                            {navItems.map((item, idx) => {
                                const isActive = checkActive(item.href, item.activePath);
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`relative flex items-center justify-center gap-1.5 rounded-lg px-2 lg:px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all duration-300 whitespace-nowrap border-3 animate-in fade-in duration-500 ${
                                            isActive
                                                ? "bg-black dark:bg-white !text-white dark:!text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.5)] border-black dark:border-white scale-105"
                                                : "bg-white dark:bg-zinc-900 text-black dark:text-white border-black/30 dark:border-white/30 hover:scale-105 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.3)]"
                                        }`}
                                        title={item.label}
                                        style={{
                                            animationDelay: `${300 + idx * 50}ms`,
                                            color: isActive ? (theme === "dark" ? "#000000" : "#ffffff") : undefined
                                        }}
                                    >
                                        {item.icon}
                                        <span className="hidden xl:inline-flex items-center gap-1.5">
                                            {item.label}
                                            {item.badge && (
                                                <span className="px-1 py-0.5 rounded-[4px] bg-[#ff6b6b] text-white text-[8px] font-black uppercase tracking-normal border-2 border-black dark:border-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                                    {item.badge}
                                                </span>
                                            )}
                                        </span>
                                        {isActive && (
                                            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[#ff6b6b] dark:bg-[#4ecdc4] border-2 border-black dark:border-white animate-pulse" />
                                        )}
                                    </Link>
                                );
                            })}
                        </nav>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 md:gap-1.5 shrink-0 animate-in fade-in duration-700 delay-300">
                        <button
                            onClick={() => {
                                setMobileSearchOpen((v) => !v);
                                if (!mobileSearchOpen) {
                                    setMobileMenuOpen(false);
                                    setTimeout(() => document.getElementById("header-search-input-mobile")?.focus(), 50);
                                }
                            }}
                            className="md:hidden h-9 w-9 flex items-center justify-center rounded-xl bg-white dark:bg-zinc-900 border-3 border-black dark:border-white text-black dark:text-white hover:scale-110 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.3)] transition-all duration-200"
                            aria-label="Search"
                        >
                            <Search className="h-4 w-4" />
                        </button>

                        <button
                            onClick={toggleTheme}
                            className="hidden md:flex items-center justify-center h-9 w-9 rounded-xl transition-all bg-white dark:bg-zinc-900 border-3 border-black dark:border-white text-black dark:text-white hover:scale-110 hover:rotate-12 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.3)] duration-200"
                            aria-label="Toggle theme"
                        >
                            {theme === "dark" ? <Sun className="h-4 w-4 animate-spin" style={{ animationDuration: '3s' }} /> : <Moon className="h-4 w-4" />}
                        </button>

                        <button
                            onClick={() => setLanguage(language === "ar" ? "en" : "ar")}
                            className="hidden md:flex items-center justify-center gap-1.5 h-9 px-2 rounded-xl text-xs font-black w-9 xl:w-[4.5rem] bg-white dark:bg-zinc-900 border-3 border-black dark:border-white text-black dark:text-white hover:scale-110 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.3)] transition-all duration-200"
                            title={language === "ar" ? "Switch to English" : "تغيير إلى العربية"}
                        >
                            <Globe className="h-4 w-4 shrink-0" />
                            <span className="hidden xl:inline">{language === "ar" ? "EN" : "AR"}</span>
                        </button>

                        {user ? (
                            <div className="relative hidden md:block">
                                <button
                                    onClick={() => setAccountMenuOpen(!accountMenuOpen)}
                                    className={`h-9 px-2.5 rounded-xl transition-all ${
                                        accountMenuOpen ? "app-panel text-white" : "app-icon-button hover:text-white"
                                    } flex items-center gap-1.5`}
                                >
                                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center border border-white/10">
                                        <User className="h-3 w-3" />
                                    </div>
                                    <ChevronDown className={`h-3 w-3 transition-transform ${accountMenuOpen ? "rotate-180" : ""}`} />
                                </button>

                                {accountMenuOpen && (
                                    <div className="app-panel-strong absolute right-0 mt-2 w-56 p-1.5 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-200 z-[110]">
                                        <div className="px-3 py-2 mb-1 border-b border-white/5">
                                            <p className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">{t("account.label")}</p>
                                            <p className="text-xs font-medium text-zinc-300 truncate">{user.email}</p>
                                        </div>
                                        <Link href="/profile" className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl transition-all">
                                            <User className="h-4 w-4" />
                                            {t("nav.profile")}
                                        </Link>
                                        <button
                                            onClick={() => { setAccountMenuOpen(false); void signOut(); }}
                                            className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
                                        >
                                            <X className="h-4 w-4" />
                                            {t("auth.logout")}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <Link
                                href="/login"
                                className="app-primary-action hidden md:flex h-9 px-3 md:px-5 items-center rounded-xl text-[10px] md:text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap"
                            >
                                {t("auth.login")}
                            </Link>
                        )}

                        <button
                            onClick={() => {
                                setMobileMenuOpen(!mobileMenuOpen);
                                if (!mobileMenuOpen) {
                                    setMobileSearchOpen(false);
                                }
                            }}
                            className="app-icon-button md:hidden h-9 w-9 flex items-center justify-center rounded-xl hover:bg-white/10 transition-all"
                            aria-label="Toggle menu"
                        >
                            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                        </button>
                    </div>

                {/* Mobile search row */}
                {mobileSearchOpen && (
                    <div className="md:hidden rounded-none border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-2 shadow-[6px_6px_0px_0px_#FFE600] animate-in slide-in-from-top-1 duration-200">
                        <div id="header-search-container-mobile" className="relative">
                            <div className="relative flex items-center">
                                <Search className="absolute left-3 w-4 h-4 text-zinc-500" />
                                <input
                                    id="header-search-input-mobile"
                                    type="text"
                                    placeholder={language === "ar" ? "ابحث عن سهم مصري..." : "Search EGX symbol..."}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onFocus={() => setSearchFocused(true)}
                                    className="h-10 w-full rounded-none pl-9 pr-3 text-sm font-black outline-none border-3 border-black bg-white text-black dark:bg-zinc-900 dark:text-white dark:border-white focus:bg-[#FFE600] focus:text-black transition-none"
                                    autoFocus
                                />
                            </div>
                            <div className="mt-2 max-h-60 overflow-y-auto custom-scrollbar">
                                <SearchDropdown
                                    language={language}
                                    searchQuery={searchQuery}
                                    searching={searching}
                                    searchResults={searchResults}
                                    onSelect={handleSymbolSelect}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Mobile menu */}
                {mobileMenuOpen && (
                    <>
                        <div
                            className="md:hidden fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
                            onClick={() => setMobileMenuOpen(false)}
                            aria-hidden="true"
                        />
                        <div className="app-panel-strong md:hidden rounded-2xl animate-in slide-in-from-top-2 duration-200 overflow-hidden relative z-[101]">
                            <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
                                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">Menu</span>
                                <button
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="app-icon-button h-7 w-7 flex items-center justify-center rounded-lg"
                                    aria-label="Close menu"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>

                            <div className="px-1.5 pb-1 flex flex-col gap-0.5">
                                {navItems.map((item) => {
                                    const isActive = checkActive(item.href, item.activePath);
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                                                isActive ? "bg-white text-zinc-950" : "text-zinc-400 hover:text-white hover:bg-white/5"
                                            }`}
                                        >
                                            {item.icon}
                                            <span className="flex items-center gap-1.5">
                                                {item.label}
                                                {item.badge && (
                                                    <span className="px-1 py-0.5 rounded-[4px] bg-indigo-600 text-white text-[8px] font-black uppercase">
                                                        {item.badge}
                                                    </span>
                                                )}
                                            </span>
                                        </Link>
                                    );
                                })}
                            </div>

                            <div className="h-px bg-white/5 mx-3" />

                            <div className="flex items-center gap-2 p-2">
                                <button onClick={toggleTheme} className="app-icon-button flex items-center justify-center h-8 w-8 rounded-xl" aria-label="Toggle theme">
                                    {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                                </button>
                                <button
                                    onClick={() => setLanguage(language === "ar" ? "en" : "ar")}
                                    className="app-icon-button flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-bold flex-1 justify-center"
                                >
                                    <Globe className="h-3.5 w-3.5" />
                                    <span>{language === "ar" ? "English" : "العربية"}</span>
                                </button>
                                {!user ? (
                                    <Link href="/login" className="app-primary-action flex items-center justify-center h-8 px-4 rounded-xl text-xs font-bold uppercase flex-1">
                                        {t("auth.login")}
                                    </Link>
                                ) : (
                                    <>
                                        <Link href="/profile" className="app-icon-button flex items-center justify-center h-8 px-3 rounded-xl text-xs font-bold flex-1">
                                            <User className="h-3.5 w-3.5" />
                                        </Link>
                                        <button onClick={() => signOut()} className="flex items-center justify-center h-8 px-3 rounded-xl bg-red-500/10 text-red-400 text-xs font-bold flex-1">
                                            {t("auth.logout")}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </header>
    );
}
