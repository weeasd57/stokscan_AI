"use client";

import React, { useState, useRef, useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useSupportChat } from "@/contexts/SupportChatContext";
import { Send, X, MessageSquare, Sparkles, User, Bot, Loader2 } from "lucide-react";

export default function SupportChatWidget() {
    const { language } = useLanguage();
    const isAr = language === "ar";
    
    const {
        isOpen,
        setIsOpen,
        messages,
        sendMessage,
        loading,
        unreadCount
    } = useSupportChat();
    
    const [input, setInput] = useState("");
    const messagesContainerRef = useRef<HTMLDivElement>(null);

    // Scroll to bottom
    useEffect(() => {
        if (isOpen) {
            const container = messagesContainerRef.current;
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }
    }, [messages, isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;

        const content = input.trim();
        setInput("");
        await sendMessage(content);
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-amber-500 hover:bg-amber-400 border-3 border-black text-black flex items-center justify-center shadow-[4px_4px_0px_0px_#000000] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.4)] transition-all hover:scale-105 active:translate-y-1 active:shadow-none z-50"
                aria-label={isAr ? "الدعم الفني" : "Customer Support"}
            >
                <MessageSquare className="h-6 w-6 text-black" />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-600 border-2 border-black dark:border-white rounded-full text-[9px] font-black text-white flex items-center justify-center animate-bounce">
                        {unreadCount}
                    </span>
                )}
            </button>
        );
    }

    return (
        <div 
            className="fixed bottom-24 right-6 w-[360px] h-[520px] max-h-[75vh] rounded-none border-4 border-black dark:border-white bg-white dark:bg-zinc-950 text-black dark:text-white shadow-[6px_6px_0px_0px_#000000] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.2)] flex flex-col z-50 animate-in fade-in slide-in-from-bottom-5 duration-200 overflow-hidden"
            dir={isAr ? "rtl" : "ltr"}
        >
            {/* Header */}
            <div className="bg-amber-500 text-black border-b-4 border-black p-4 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 font-black uppercase text-xs sm:text-sm tracking-wider">
                    <Sparkles className="h-4 w-4 animate-pulse" />
                    <span>{isAr ? "الدعم الفني والعملاء" : "EGX BOTS Support"}</span>
                </div>
                <button
                    onClick={() => setIsOpen(false)}
                    className="p-1 rounded-none hover:bg-black/10 border border-transparent hover:border-black transition-colors"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* Message Area */}
            <div 
                ref={messagesContainerRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-white dark:bg-zinc-950 font-mono text-xs"
            >
                {messages.length === 0 ? (
                    <div className="text-center py-10 text-zinc-400 dark:text-zinc-500 font-bold">
                        {isAr ? "أهلاً بك! كيف يمكننا مساعدتك اليوم؟" : "Hello! How can we help you today?"}
                    </div>
                ) : (
                    messages.map((msg) => (
                        <div
                            key={msg.id}
                            className={`flex gap-2.5 ${msg.sender === "user" ? "flex-row-reverse" : "flex-row"}`}
                        >
                            <div className={`
                                h-7 w-7 rounded-none flex items-center justify-center shrink-0 border-2 border-black
                                ${msg.sender === "user" 
                                    ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700" 
                                    : "bg-amber-500 text-black border-black"}
                            `}>
                                {msg.sender === "user" ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                            </div>
                            <div className={`
                                max-w-[75%] rounded-none p-3 border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,0.15)] dark:shadow-[2px_2px_0px_rgba(255,255,255,0.05)]
                                ${msg.sender === "user" 
                                    ? "bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border-zinc-300 dark:border-zinc-700" 
                                    : "bg-amber-50 dark:bg-amber-500/10 border-amber-400 dark:border-amber-500 text-amber-900 dark:text-amber-200"}
                            `}>
                                <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Input Form */}
            <form onSubmit={handleSubmit} className="p-3 border-t-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 flex gap-2 flex-shrink-0">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={isAr ? "اكتب رسالتك هنا..." : "Type your message..."}
                    className="flex-1 h-10 rounded-none bg-white dark:bg-zinc-950 border-2 border-black dark:border-zinc-700 px-3 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none transition-colors"
                />
                <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="h-10 w-10 rounded-none bg-amber-500 hover:bg-amber-400 border-2 border-black dark:border-zinc-700 text-black flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
            </form>
        </div>
    );
}
