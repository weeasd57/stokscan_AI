"use client";

import { useChat, ChatMessage } from "@/contexts/ChatContext";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { Send, X, Sparkles, User, Loader2, Lock, Maximize2, Minimize2, LogIn, UserPlus } from "lucide-react";
import { useState, useRef, useEffect } from "react";

export default function ChatWidget() {
    const { isOpen, setIsOpen, messages, sendMessage, isLoading, remainingQuota } = useChat();
    const { user } = useAuth();
    const router = useRouter();
    const [input, setInput] = useState("");
    const [isExpanded, setIsExpanded] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isOpen, isLoading]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || !user || isLoading) return;
        sendMessage(input);
        setInput("");
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-amber-500 hover:bg-amber-400 border-3 border-black text-black flex items-center justify-center shadow-[4px_4px_0px_0px_#000000] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.4)] transition-all hover:scale-105 active:translate-y-1 active:shadow-none z-50 animate-in fade-in zoom-in duration-300"
                title="AI Market Assistant"
            >
                <Sparkles className="h-6 w-6 text-black" />
            </button>
        );
    }

    return (
        <div 
            className={`
                fixed z-50 flex flex-col bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl border border-zinc-200 dark:border-zinc-800 shadow-2xl transition-all duration-300 overflow-hidden
                max-md:inset-0 max-md:w-full max-md:h-full max-md:rounded-none
                md:bottom-6 md:right-6 md:rounded-2xl md:resize md:overflow-hidden md:min-w-[360px] md:min-h-[480px] md:max-w-[90vw] md:max-h-[90vh]
                ${isExpanded 
                    ? "md:w-[720px] md:h-[800px] md:max-h-[85vh]" 
                    : "md:w-[420px] md:h-[620px] md:max-h-[75vh]"
                }
            `}
        >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 shrink-0">
                <div className="flex items-center gap-2 text-black dark:text-white font-medium">
                    <div className="p-1.5 rounded-lg bg-amber-500/10">
                        <Sparkles className="h-4 w-4 text-amber-500" />
                    </div>
                    <span>EGX AI Assistant</span>
                </div>
                <div className="flex items-center gap-2">
                    {user && (
                        <div className="text-xs font-medium px-2.5 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-full">
                            {remainingQuota >= 99 ? "Unlimited ♾️" : `${remainingQuota}/4 Left`}
                        </div>
                    )}
                    {/* Desktop Expand Toggle */}
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="hidden md:flex p-1.5 rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-black dark:hover:text-white transition-colors"
                        title={isExpanded ? "تعديل الحجم الافتراضي" : "تكبير النافذة"}
                    >
                        {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </button>
                    <button
                        onClick={() => setIsOpen(false)}
                        className="p-1.5 rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-black dark:hover:text-white transition-colors"
                        title="إغلاق"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {/* Messages Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {!user ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4 my-auto min-h-[300px]">
                        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500">
                            <Lock className="h-8 w-8" />
                        </div>
                        <div className="space-y-1">
                            <h3 className="font-bold text-lg text-black dark:text-white">تسجيل الدخول مطلوب</h3>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-[260px] leading-relaxed">
                                يرجى تسجيل الدخول أولاً لتتمكن من التحدث مع المساعد الذكي واستعراض تحليلات الأسهم.
                            </p>
                        </div>
                        <div className="flex flex-col w-full gap-2 pt-2 max-w-[240px]">
                            <button
                                onClick={() => {
                                    setIsOpen(false);
                                    router.push("/login?redirect=/chart");
                                }}
                                className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-all shadow-md active:scale-95"
                            >
                                <LogIn className="h-4 w-4" />
                                تسجيل الدخول
                            </button>
                            <button
                                onClick={() => {
                                    setIsOpen(false);
                                    router.push("/signup");
                                }}
                                className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-black dark:text-white text-xs font-medium transition-all"
                            >
                                <UserPlus className="h-3.5 w-3.5" />
                                إنشاء حساب جديد
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {remainingQuota === 0 && (
                            <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 text-xs text-orange-200 mb-4">
                                ⚠️ Daily chat limit reached. Please come back tomorrow to chat more!
                            </div>
                        )}

                        {messages.map((msg, idx) => (
                            <div
                                key={idx}
                                className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                            >
                                <div className={`
                                    h-8 w-8 rounded-full flex items-center justify-center shrink-0
                                    ${msg.role === "user" ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400" : "bg-amber-500 text-black"}
                                `}>
                                    {msg.role === "user" ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                                </div>
                                <div className={`
                                    max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed
                                    ${msg.role === "user"
                                        ? "bg-zinc-100 dark:bg-zinc-800 text-black dark:text-zinc-100 rounded-tr-none"
                                        : "bg-amber-500/10 border border-amber-500/20 text-black dark:text-zinc-100 rounded-tl-none"}
                                `}>
                                    <div className="whitespace-pre-wrap">{msg.content}</div>
                                </div>
                            </div>
                        ))}

                        {isLoading && (
                            <div className="flex gap-3">
                                <div className="h-8 w-8 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                                    <Sparkles className="h-4 w-4 text-black" />
                                </div>
                                <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl rounded-tl-none px-4 py-3 flex items-center gap-2">
                                    <div className="h-2 w-2 bg-amber-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                    <div className="h-2 w-2 bg-amber-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                    <div className="h-2 w-2 bg-amber-400 rounded-full animate-bounce"></div>
                                </div>
                            </div>
                        )}
                    </>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Input Form */}
            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 shrink-0">
                {user ? (
                    <form onSubmit={handleSubmit} className="flex gap-2">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="اسأل عن أي سهم في البورصة المصرية..."
                            className="flex-1 h-10 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3 text-sm text-black dark:text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none transition-colors"
                        />
                        <button
                            type="submit"
                            disabled={isLoading || !input.trim()}
                            className="h-10 w-10 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:hover:bg-amber-500 text-black flex items-center justify-center transition-all"
                        >
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </button>
                    </form>
                ) : (
                    <div className="text-center text-xs text-zinc-500 dark:text-zinc-400 py-1">
                        🔒 سجل الدخول أولاً لتتمكن من كتابة وإرسال الأسئلة.
                    </div>
                )}
            </div>
        </div>
    );
}
