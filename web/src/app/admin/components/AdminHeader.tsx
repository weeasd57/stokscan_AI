"use client";

import { Brain, Database, Bot, LineChart, History, Calendar, Sparkles, Clock, Users, BookOpen, MessageSquare } from "lucide-react";

interface AdminHeaderProps {
    activeMainTab: "data" | "ai" | "backtest" | "bot" | "schedule" | "similarity" | "jobs" | "users" | "articles" | "support";
    setActiveMainTab: (tab: "data" | "ai" | "backtest" | "bot" | "schedule" | "similarity" | "jobs" | "users" | "articles" | "support") => void;
}

export default function AdminHeader({ activeMainTab, setActiveMainTab }: AdminHeaderProps) {
    const tabs = [
        { id: "data", label: "DATA", icon: Database, color: "cyan" },
        { id: "ai", label: "AI AUTO", icon: Brain, color: "purple" },
        { id: "bot", label: "LIVE BOT", icon: Bot, color: "green" },
        { id: "backtest", label: "BACKTEST", icon: LineChart, color: "yellow" },
        { id: "similarity", label: "SIMILARITY", icon: History, color: "pink" },
        { id: "jobs", label: "JOBS", icon: Clock, color: "orange" },
        { id: "schedule", label: "ALERTS", icon: Calendar, color: "amber" },
        { id: "users", label: "USERS", icon: Users, color: "blue" },
        { id: "articles", label: "ARTICLES", icon: BookOpen, color: "teal" },
        { id: "support", label: "SUPPORT", icon: MessageSquare, color: "pink" },
    ] as const;

    const getTabColorClasses = (color: string, isActive: boolean) => {
        if (!isActive) return "";
        
        const colors = {
            cyan: "neobrutal-bg-cyan",
            purple: "neobrutal-bg-purple",
            green: "neobrutal-bg-green",
            yellow: "neobrutal-bg-yellow",
            pink: "neobrutal-bg-pink",
            orange: "neobrutal-bg-orange",
            amber: "neobrutal-bg-amber",
            blue: "neobrutal-bg-blue",
            teal: "neobrutal-bg-teal"
        };
        
        return colors[color as keyof typeof colors] || "neobrutal-bg-yellow";
    };

    return (
        <>
            {/* Animated Ticker Ribbon */}
            <div className="sticky top-[92px] z-50 w-full border-y-4 border-black dark:border-white bg-black dark:bg-zinc-950 text-white overflow-hidden py-2 font-mono font-black text-[10px] uppercase tracking-widest flex select-none">
                <div className="animate-marquee-neobrutal flex gap-8 shrink-0 min-w-full justify-around">
                    <span className="flex items-center gap-2">
                        <Sparkles className="w-3 h-3" />
                        ADMIN CONTROL PANEL
                    </span>
                    <span>🎯 DATA SYNC • AI TRAINING • LIVE MONITORING</span>
                    <span className="flex items-center gap-2">
                        <Bot className="w-3 h-3" />
                        AUTOMATED TRADING SYSTEM
                    </span>
                    <span>📊 BACKTEST SIMULATOR • PATTERN RECOGNITION</span>
                </div>
                <div aria-hidden="true" className="animate-marquee-neobrutal flex gap-8 shrink-0 min-w-full justify-around">
                    <span className="flex items-center gap-2">
                        <Sparkles className="w-3 h-3" />
                        ADMIN CONTROL PANEL
                    </span>
                    <span>🎯 DATA SYNC • AI TRAINING • LIVE MONITORING</span>
                    <span className="flex items-center gap-2">
                        <Bot className="w-3 h-3" />
                        AUTOMATED TRADING SYSTEM
                    </span>
                    <span>📊 BACKTEST SIMULATOR • PATTERN RECOGNITION</span>
                </div>
            </div>

            {/* Main Navigation Header */}
            <header className="sticky top-[126px] z-40 w-full border-b-4 border-black dark:border-white bg-white dark:bg-zinc-950">
                <div className="max-w-[1920px] mx-auto px-4 md:px-8 py-4">
                    
                    {/* Navigation Tabs */}
                    <nav className="relative w-full overflow-x-auto pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide">
                        <div className="flex items-stretch gap-2 min-w-max md:min-w-0 md:justify-start">
                            {tabs.map((tab) => {
                                const isActive = activeMainTab === tab.id;
                                const Icon = tab.icon;
                                const bgClass = getTabColorClasses(tab.color, isActive);

                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveMainTab(tab.id)}
                                        className={`
                                            group relative px-4 md:px-6 py-3 border-4 border-black dark:border-white font-black text-[10px] md:text-xs uppercase tracking-widest
                                            transition-all duration-100
                                            ${isActive
                                                ? `${bgClass} text-black shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] translate-x-0 translate-y-0`
                                                : "bg-white dark:bg-zinc-900 text-black dark:text-white shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:hover:shadow-[3px_3px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                                            }
                                        `}
                                    >
                                        <div className="flex items-center gap-2">
                                            <Icon className={`w-4 h-4 ${isActive ? 'text-black' : 'text-zinc-600 dark:text-zinc-400 group-hover:text-black dark:group-hover:text-white'}`} />
                                            <span>{tab.label}</span>
                                        </div>
                                        
                                        {/* Active Indicator Dot */}
                                        {isActive && (
                                            <div className="absolute -top-1 -right-1 w-3 h-3 bg-black dark:bg-white border-2 border-black dark:border-white rounded-full animate-pulse" />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </nav>

                </div>
            </header>

            <style jsx>{`
                .scrollbar-hide::-webkit-scrollbar {
                    display: none;
                }
                .scrollbar-hide {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            `}</style>
        </>
    );
}
