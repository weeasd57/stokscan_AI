"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Globe, BarChart2, Brain, Activity, Menu, X, User, ChevronDown, ArrowLeftRight, Search, Loader2, Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { searchSymbols } from "@/lib/api";

const POPULAR_EGX_STOCKS = [
    { symbol: "COMI", name: "Commercial International Bank", exchange: "EGX", country: "Egypt" },
    { symbol: "FWRY", name: "Fawry for Banking & Payment Technology", exchange: "EGX", country: "Egypt" },
    { symbol: "TMGH", name: "Talaat Moustafa Group", exchange: "EGX", country: "Egypt" },
    { symbol: "EAST", name: "Eastern Company", exchange: "EGX", country: "Egypt" },
    { symbol: "AALR", name: "General Co. for Land Reclamation", exchange: "EGX", country: "Egypt" },
];

export default function Header() {
    const { language, setLanguage, t } = useLanguage();
    const { theme, toggleTheme } = useTheme();
    const { user, signOut } = useAuth();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const router = useRouter();
    const currentTab = searchParams.get("tab");
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);

    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchFocused, setSearchFocused] = useState(false);

    useEffect(() => {
        setMobileMenuOpen(false);
        setAccountMenuOpen(false);
    }, [pathname]);

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
                const input = document.getElementById("header-search-input");
                input?.focus();
            } else if (e.key === "/") {
                const active = document.activeElement?.tagName.toLowerCase();
                if (active !== "input" && active !== "textarea") {
                    e.preventDefault();
                    const input = document.getElementById("header-search-input");
                    input?.focus();
                }
            } else if (e.key === "Escape") {
                setSearchFocused(false);
                setSearchQuery("");
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
        { href: "/scanner/backtests?tab=bots", label: t("nav.scanner.ai_trading"), icon: <Brain className="w-4 h-4" />, activePath: "/scanner/backtests", badge: "AI DEMO" },
        { href: "/scanner/technical", label: t("nav.scanner.tech"), icon: <Activity className="w-4 h-4" />, activePath: "/scanner/technical" },
        { href: "/scanner/backtests?tab=backtests", label: t("nav.scanner.backtests"), icon: <BarChart2 className="w-4 h-4" />, activePath: null },
    ];

    const checkActive = (href: string, activePath: string | null) => {
        if (href.includes("?tab=backtests")) {
            return pathname === "/scanner/backtests" && currentTab === "backtests";
        }
        if (href.includes("?tab=bots")) {
            // Only active when ?tab=bots is explicitly in the URL
            return pathname === "/scanner/backtests" && (currentTab === "bots" || currentTab === null && false);
        }
        return activePath ? pathname === activePath : pathname === href;
    };

    return (
        <header className="fixed top-3 left-0 right-0 z-[100] px-3 sm:px-6 md:px-8 header-stable">
            <div className="mx-auto max-w-[1800px] w-full">
                <div className="app-header-surface flex items-center justify-between rounded-2xl sm:rounded-[2rem] px-3 sm:px-6 py-2.5 sm:py-3.5 ring-1 ring-white/5 transition-all duration-500 hover:border-white/20">
                    {/* Brand / Logo */}
                    <div className="flex items-center gap-2 sm:gap-6">
                        <Link href="/" className="group flex items-center gap-2 sm:gap-3">
                            <div className="relative transition-all duration-500 group-hover:rotate-12 group-hover:scale-110 flex-shrink-0">
                                <Image
                                    src="/brand-mark.svg"
                                    alt="EGX Bots logo"
                                    width={36}
                                    height={36}
                                    className="object-contain sm:w-11 sm:h-11 drop-shadow-[0_10px_30px_rgba(79,70,229,0.25)]"
                                    priority
                                />
                            </div>
                            {/* Hide title text on very small screens to save space */}
                            <div className="hidden sm:flex flex-col min-w-0 header-title">
                                <span className="text-base font-bold tracking-tight text-white leading-tight truncate">
                                    {t("app.title")}
                                </span>
                                <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500 leading-none hidden xs:block">
                                    {t("header.pro_analysis")}
                                </span>
                            </div>
                            {/* Show compact title on xs only */}
                            <span className="sm:hidden text-sm font-black tracking-tight text-white">EGX Bots</span>
                        </Link>

                        {/* Desktop Search Engine */}
                        <div id="header-search-container" className={`relative hidden md:block transition-all duration-300 ease-in-out ${searchFocused ? "w-72 lg:w-96" : "w-48 lg:w-64"}`}>
                            <div className="relative flex items-center">
                                <Search className="absolute left-3 w-4 h-4 text-zinc-500 light:text-slate-500" />
                                <input
                                    id="header-search-input"
                                    type="text"
                                    placeholder={language === "ar" ? "ابحث عن سهم مصري..." : "Search EGX symbol..."}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onFocus={() => setSearchFocused(true)}
                                    className="app-control h-9 w-full rounded-xl pl-9 pr-8 text-xs font-semibold outline-none focus:border-white/20 focus:ring-1 focus:ring-white/5 transition-all"
                                />
                                <kbd className="app-chip absolute right-3 px-1.5 py-0.5 rounded text-[9px] font-mono pointer-events-none uppercase">
                                    /
                                </kbd>
                            </div>

                            {/* Dropdown Overlay */}
                            {searchFocused && (
                                <div className="app-panel-strong absolute top-11 left-0 right-0 max-h-80 overflow-y-auto rounded-2xl p-1.5 z-50 animate-in fade-in slide-in-from-top-1 duration-200">
                                    {!searchQuery.trim() ? (
                                        <div className="flex flex-col gap-0.5">
                                            <div className="px-3 py-1.5 text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
                                                {language === "ar" ? "الأسهم المصرية الأكثر شعبية" : "Popular EGX Stocks"}
                                            </div>
                                            {POPULAR_EGX_STOCKS.map((result) => (
                                                <button
                                                    key={result.symbol}
                                                    onClick={() => {
                                                        setSearchQuery("");
                                                        setSearchFocused(false);
                                                        router.push(`/chart?symbol=${encodeURIComponent(result.symbol)}&exchange=EGX`);
                                                    }}
                                                    className="flex items-center justify-between w-full px-3 py-2 rounded-xl text-left hover:bg-white/5 transition-all active:scale-[0.99]"
                                                >
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="text-xs font-black text-white">{result.symbol}</span>
                                                        <span className="text-[10px] text-zinc-500 font-semibold truncate max-w-[180px] lg:max-w-[220px]">
                                                            {result.name}
                                                        </span>
                                                    </div>
                                                    <span className="text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                        EGX
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    ) : searching ? (
                                        <div className="flex items-center justify-center py-5 text-zinc-500 gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                                            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                                            <span>{language === "ar" ? "جاري البحث..." : "Searching..."}</span>
                                        </div>
                                    ) : searchResults.length > 0 ? (
                                        <div className="flex flex-col gap-0.5">
                                            {searchResults.map((result) => (
                                                <button
                                                    key={result.symbol}
                                                    onClick={() => {
                                                        setSearchQuery("");
                                                        setSearchFocused(false);
                                                        router.push(`/chart?symbol=${encodeURIComponent(result.symbol)}&exchange=EGX`);
                                                    }}
                                                    className="flex items-center justify-between w-full px-3 py-2 rounded-xl text-left hover:bg-white/5 transition-all active:scale-[0.99]"
                                                >
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="text-xs font-black text-white">{result.symbol}</span>
                                                        <span className="text-[10px] text-zinc-500 font-semibold truncate max-w-[180px] lg:max-w-[220px]">
                                                            {result.name}
                                                        </span>
                                                    </div>
                                                    <span className="text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                        EGX
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-5 text-xs text-zinc-600 font-bold uppercase tracking-wide">
                                            {language === "ar" ? "لا توجد نتائج" : "No symbols found"}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Desktop Navigation */}
                        <nav className="app-soft-panel hidden lg:flex flex-row flex-nowrap items-center gap-1 ml-2 xl:ml-4 py-1 px-1 rounded-xl">
                            {navItems.map((item) => {
                                const isActive = checkActive(item.href, item.activePath);
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`relative flex items-center justify-center gap-1.5 rounded-lg px-2 lg:px-3 py-1.5 text-[10px] lg:text-xs font-bold uppercase tracking-wider transition-all duration-300 whitespace-nowrap ${isActive
                                            ? "bg-zinc-100 text-zinc-950 shadow-lg shadow-white/5"
                                            : "text-zinc-500 hover:text-zinc-50 hover:bg-white/5"
                                            }`}
                                        title={item.label}
                                    >
                                        {item.icon}
                                        <span className="hidden xl:inline-flex items-center gap-1.5">
                                            {item.label}
                                            {item.badge && (
                                                <span className="px-1 py-0.5 rounded-[4px] bg-indigo-600 text-white text-[8px] font-black uppercase tracking-normal">
                                                    {item.badge}
                                                </span>
                                            )}
                                        </span>
                                        {isActive && (
                                            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-500" />
                                        )}
                                    </Link>
                                );
                            })}
                        </nav>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 sm:gap-2">
                        {/* Theme Toggle — hidden on mobile (inside mobile menu) */}
                        <button
                            onClick={toggleTheme}
                            className="app-icon-button hidden sm:flex items-center justify-center h-9 w-9 rounded-xl transition-all duration-300"
                            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                            aria-label="Toggle theme"
                        >
                            {theme === "dark" ? (
                                <Sun className="h-4 w-4" />
                            ) : (
                                <Moon className="h-4 w-4" />
                            )}
                        </button>

                        {/* Language Switcher — hidden on mobile (inside mobile menu) */}
                        <button
                            onClick={() => setLanguage(language === "ar" ? "en" : "ar")}
                            className="app-icon-button hidden sm:flex items-center justify-center gap-1.5 h-9 px-2 rounded-xl transition-all text-xs font-bold w-9 xl:w-20 language-switch"
                            title={language === "ar" ? "Switch to English" : "تغيير إلى العربية"}
                        >
                            <Globe className="h-4 w-4" />
                            <span className="hidden xl:inline">{language === "ar" ? "EN" : "العربية"}</span>
                        </button>

                        {/* Account — hidden on mobile (inside mobile menu) */}
                        {user ? (
                            <div className="relative hidden sm:block">
                                <button
                                    onClick={() => setAccountMenuOpen(!accountMenuOpen)}
                                    className={`h-9 px-3 rounded-xl transition-all ${accountMenuOpen ? "app-panel text-white" : "app-icon-button hover:text-white"} flex items-center gap-2`}
                                >
                                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center border border-white/10">
                                        <User className="h-3 w-3" />
                                    </div>
                                    <ChevronDown className={`h-3 w-3 transition-transform duration-300 ${accountMenuOpen ? "rotate-180" : ""}`} />
                                </button>

                                {accountMenuOpen && (
                                    <div className="app-panel-strong absolute right-0 mt-3 w-56 p-1.5 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-200">
                                        <div className="px-3 py-2 mb-1 border-b border-white/5">
                                            <p className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">{t("account.label")}</p>
                                            <p className="text-xs font-medium text-zinc-300 truncate">{user.email}</p>
                                        </div>
                                        <Link
                                            href="/profile"
                                            className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl transition-all"
                                        >
                                            <User className="h-4 w-4" />
                                            {t("nav.profile")}
                                        </Link>
                                        <button
                                            onClick={() => {
                                                setAccountMenuOpen(false);
                                                void signOut();
                                            }}
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
                                className="app-primary-action hidden sm:flex h-9 px-5 items-center rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                            >
                                {t("auth.login")}
                            </Link>
                        )}

                        {/* Hamburger — mobile only, always visible */}
                        <button
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            className="app-icon-button lg:hidden h-9 w-9 flex items-center justify-center rounded-xl hover:bg-white/10 transition-all flex-shrink-0"
                            aria-label="Toggle menu"
                        >
                            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                        </button>
                    </div>
                </div>

                {/* Mobile Menu Panel - Compact Dropdown */}
                {mobileMenuOpen && (
                    <>
                        {/* Backdrop overlay – tap anywhere outside to close */}
                        <div
                            className="lg:hidden fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
                            onClick={() => setMobileMenuOpen(false)}
                            aria-hidden="true"
                        />
                        <div className="app-panel-strong lg:hidden mt-6 rounded-2xl animate-in slide-in-from-top-2 duration-200 overflow-hidden relative z-[101]">
                            {/* Close button at top right */}
                            <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
                                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">Menu</span>
                                <button
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="app-icon-button h-7 w-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all"
                                    aria-label="Close menu"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>

                            {/* Nav Items */}
                            <div className="px-1.5 pb-1 flex flex-col gap-0.5">
                                {navItems.map((item) => {
                                    const isActive = checkActive(item.href, item.activePath);
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${isActive
                                                ? "bg-white text-zinc-950"
                                                : "text-zinc-400 hover:text-white hover:bg-white/5"
                                                }`}
                                        >
                                            {item.icon}
                                            <span className="flex items-center gap-1.5">
                                                {item.label}
                                                {item.badge && (
                                                    <span className="px-1 py-0.5 rounded-[4px] bg-indigo-600 text-white text-[8px] font-black uppercase tracking-normal">
                                                        {item.badge}
                                                    </span>
                                                )}
                                            </span>
                                        </Link>
                                    );
                                })}
                            </div>

                            <div className="h-px bg-white/5 mx-3" />

                            {/* Bottom Row: Language + Theme + Account */}
                            <div className="flex items-center gap-2 p-2">
                                <button
                                    onClick={toggleTheme}
                                    className="app-icon-button flex items-center justify-center h-8 w-8 rounded-xl transition-all"
                                    title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                                    aria-label="Toggle theme"
                                >
                                    {theme === "dark" ? (
                                        <Sun className="h-3.5 w-3.5" />
                                    ) : (
                                        <Moon className="h-3.5 w-3.5" />
                                    )}
                                </button>
                                <button
                                    onClick={() => setLanguage(language === "ar" ? "en" : "ar")}
                                    className="app-icon-button flex items-center gap-1.5 h-8 px-3 rounded-xl transition-all text-xs font-bold flex-1 justify-center"
                                >
                                    <Globe className="h-3.5 w-3.5" />
                                    <span>{language === "ar" ? "English" : "العربية"}</span>
                                </button>
                                {!user ? (
                                    <Link
                                        href="/login"
                                        className="app-primary-action flex items-center justify-center h-8 px-4 rounded-xl text-xs font-bold uppercase flex-1"
                                    >
                                        {t("auth.login")}
                                    </Link>
                                ) : (
                                    <>
                                        <Link
                                            href="/profile"
                                            className="app-icon-button flex items-center justify-center gap-1.5 h-8 px-3 rounded-xl text-xs font-bold flex-1"
                                        >
                                            <User className="h-3.5 w-3.5" />
                                        </Link>
                                        <button
                                            onClick={() => signOut()}
                                            className="flex items-center justify-center h-8 px-3 rounded-xl bg-red-500/10 text-red-400 text-xs font-bold flex-1"
                                        >
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

