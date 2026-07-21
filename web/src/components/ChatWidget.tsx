"use client";

import { useChat, ChatMessage, AVAILABLE_AI_MODELS } from "@/contexts/ChatContext";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRouter } from "next/navigation";
import { Send, X, Sparkles, User, Loader2, Lock, Maximize2, Minimize2, LogIn, UserPlus, ImagePlus, XCircle, Cpu, ChevronDown, Check } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";

export default function ChatWidget() {
    const { isOpen, setIsOpen, messages, sendMessage, isLoading, remainingQuota, selectedModel, setSelectedModel } = useChat();
    const { language } = useLanguage();
    const { user } = useAuth();
    const router = useRouter();
    const [input, setInput] = useState("");
    const [isExpanded, setIsExpanded] = useState(false);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]); // base64 data URLs array
    const [modelMenuOpen, setModelMenuOpen] = useState(false);
    
    const bottomRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const modelMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) {
                setModelMenuOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isOpen, isLoading]);

    const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 4 * 1024 * 1024) {
            alert(language === "ar" ? "حجم الصورة كبير جداً (الأقصى 4MB)" : "Image too large (Max 4MB)");
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string") {
                setImagePreviews([reader.result]);
            }
        };
        reader.readAsDataURL(file);

        // Reset file input so same file can be re-selected
        e.target.value = "";
    }, [language]);

    const removeImage = useCallback((index: number) => {
        setImagePreviews(prev => prev.filter((_, i) => i !== index));
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if ((!input.trim() && imagePreviews.length === 0) || !user || isLoading) return;
        sendMessage(input, imagePreviews.length > 0 ? imagePreviews : undefined);
        setInput("");
        setImagePreviews([]);
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-amber-500 hover:bg-amber-400 border-3 border-black text-black flex items-center justify-center shadow-[4px_4px_0px_0px_#000000] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.4)] transition-all hover:scale-105 active:translate-y-1 active:shadow-none z-[9999] animate-in fade-in zoom-in duration-300"
                title="AI Market Assistant"
            >
                <Sparkles className="h-6 w-6 text-black" />
            </button>
        );
    }

    return (
        <div 
            className={`
                fixed z-[9999] flex flex-col bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl border border-zinc-200 dark:border-zinc-800 shadow-2xl transition-all duration-300 overflow-hidden
                max-md:inset-0 max-md:w-full max-md:h-full max-md:rounded-none max-md:pt-[env(safe-area-inset-top,20px)] max-md:pb-[env(safe-area-inset-bottom,10px)]
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
                            {remainingQuota >= 99 ? "Unlimited ♾️" : `${remainingQuota}/15 Left`}
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
                        className="p-2 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-black dark:hover:text-white border border-zinc-200 dark:border-zinc-800 md:border-none transition-colors min-w-[38px] min-h-[38px] flex items-center justify-center active:scale-95"
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
                                    {/* Show image thumbnails if present */}
                                     {((msg.images && msg.images.length > 0) || (msg.imageUrl && msg.imageUrl !== "[image]")) && (
                                         <div className="mb-2 flex flex-wrap gap-1.5">
                                             {(msg.images || [msg.imageUrl!]).filter(img => img && img !== "[image]").map((img, i) => (
                                                 <img
                                                     key={i}
                                                     src={img}
                                                     alt={`Attached ${i + 1}`}
                                                     className="max-w-[180px] max-h-40 rounded-lg border border-zinc-300 dark:border-zinc-700 object-cover shadow-sm"
                                                 />
                                             ))}
                                         </div>
                                     )}
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
            <div className="p-3 sm:p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 shrink-0">
                {user ? (
                    <div>
                        {/* Custom Modern Model Selector Menu (ChatGPT / Claude Style) */}
                        {(() => {
                            const currentModelObj = AVAILABLE_AI_MODELS.find(m => m.id === selectedModel) || AVAILABLE_AI_MODELS[0];
                            return (
                                <div className="relative mb-2 inline-block" ref={modelMenuRef}>
                                    <button
                                        type="button"
                                        onClick={() => setModelMenuOpen(!modelMenuOpen)}
                                        className="flex items-center gap-2 bg-zinc-200/80 dark:bg-zinc-800/90 hover:bg-zinc-300/80 dark:hover:bg-zinc-700/80 border border-zinc-300 dark:border-zinc-700/80 rounded-xl px-3 py-1.5 text-xs text-black dark:text-white font-bold transition-all shadow-sm active:scale-95"
                                    >
                                        <Cpu className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                        <span className="flex items-center gap-1.5">
                                            <span>{currentModelObj?.name}</span>
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold">
                                                {language === "ar" ? currentModelObj?.badgeAr : currentModelObj?.badgeEn}
                                            </span>
                                        </span>
                                        <ChevronDown className={`h-3.5 w-3.5 text-zinc-500 transition-transform duration-200 ${modelMenuOpen ? "rotate-180" : ""}`} />
                                    </button>

                                    {/* Popover Menu */}
                                    {modelMenuOpen && (
                                        <div className="absolute bottom-full mb-2 left-0 w-72 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-2xl p-1.5 z-[100] animate-in fade-in zoom-in-95 duration-150 space-y-1">
                                            <div className="px-2 py-1 text-[10px] font-black uppercase text-zinc-400 tracking-wider">
                                                {language === "ar" ? "اختر موديل الذكاء الاصطناعي" : "Select AI Model"}
                                            </div>
                                            {AVAILABLE_AI_MODELS.map((m) => {
                                                const isSelected = selectedModel === m.id;
                                                return (
                                                    <button
                                                        key={m.id}
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedModel(m.id);
                                                            setModelMenuOpen(false);
                                                        }}
                                                        className={`
                                                            w-full text-left flex items-start justify-between p-2.5 rounded-xl text-xs transition-all
                                                            ${isSelected 
                                                                ? "bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/30 text-black dark:text-white font-bold" 
                                                                : "hover:bg-zinc-100 dark:hover:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 border border-transparent"}
                                                        `}
                                                    >
                                                        <div className="flex flex-col gap-0.5 min-w-0 pr-2">
                                                            <div className="flex items-center gap-1.5 font-bold text-black dark:text-white">
                                                                <span>{m.name}</span>
                                                                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold">
                                                                    {language === "ar" ? m.badgeAr : m.badgeEn}
                                                                </span>
                                                            </div>
                                                            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-normal leading-tight">
                                                                {language === "ar" ? m.descAr : m.descEn}
                                                            </span>
                                                        </div>
                                                        {isSelected && <Check className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                        {/* Image Previews List */}
                        {imagePreviews.length > 0 && (
                            <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-1">
                                {imagePreviews.map((img, idx) => (
                                    <div key={idx} className="relative shrink-0">
                                        <img
                                            src={img}
                                            alt={`Preview ${idx + 1}`}
                                            className="h-16 w-16 rounded-lg border-2 border-amber-500/40 object-cover shadow-sm"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => removeImage(idx)}
                                            className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 transition-colors shadow-md"
                                            title="Remove"
                                        >
                                            <XCircle className="h-4 w-4" />
                                        </button>
                                        <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[9px] font-bold px-1 rounded">
                                            #{idx + 1}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <form onSubmit={handleSubmit} className="flex gap-2">
                            {/* Hidden file input supporting multiple files */}
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                className="hidden"
                                onChange={handleImageSelect}
                            />
                            {/* Image upload button */}
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isLoading}
                                className="h-10 w-10 shrink-0 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 flex items-center justify-center transition-all disabled:opacity-50 relative"
                                title={language === "ar" ? "إرفاق صور للتحليل" : "Attach images for analysis"}
                            >
                                <ImagePlus className="h-4 w-4" />
                                {imagePreviews.length > 0 && (
                                    <span className="absolute -top-1 -right-1 bg-amber-500 text-black text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-black">
                                        {imagePreviews.length}
                                    </span>
                                )}
                            </button>
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder={
                                    imagePreviews.length > 0
                                        ? (language === "ar" ? `أضف وصفاً لـ (${imagePreviews.length}) صور (اختياري)...` : `Add description for (${imagePreviews.length}) images (optional)...`) 
                                        : (language === "ar" ? "اسأل عن أي سهم في البورصة المصرية..." : "Ask about any EGX stock...")
                                }
                                className="flex-1 h-10 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 px-3 text-sm text-black dark:text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none transition-colors"
                            />
                            <button
                                type="submit"
                                disabled={isLoading || (!input.trim() && imagePreviews.length === 0)}
                                className="h-10 w-10 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:hover:bg-amber-500 text-black flex items-center justify-center transition-all"
                            >
                                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </button>
                        </form>
                    </div>
                ) : (
                    <div className="text-center text-xs text-zinc-500 dark:text-zinc-400 py-1">
                        🔒 سجل الدخول أولاً لتتمكن من كتابة وإرسال الأسئلة.
                    </div>
                )}
            </div>
        </div>
    );
}
