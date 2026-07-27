"use client";

import { useChat, AVAILABLE_AI_MODELS } from "@/contexts/ChatContext";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRouter } from "next/navigation";
import { Send, X, Sparkles, User, Loader2, Lock, Maximize2, Minimize2, LogIn, UserPlus, ImagePlus, XCircle, Cpu, ChevronDown, Check, PanelLeft } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { FormattedChatMessage } from "@/components/chat/FormattedChatMessage";

export default function ChatWidget() {
    const { 
        isOpen, 
        setIsOpen, 
        messages, 
        sendMessage, 
        stopResponding,
        isLoading, 
        remainingQuota, 
        selectedModel, 
        setSelectedModel,
        sessions,
        activeSessionId,
        createNewSession,
        switchSession,
        deleteSession,
        renameSession,
        isSidebarOpen,
        setIsSidebarOpen
    } = useChat();

    const { language } = useLanguage();
    const { user } = useAuth();
    const router = useRouter();
    const [input, setInput] = useState("");
    const [isExpanded, setIsExpanded] = useState(false);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]);
    const [modelMenuOpen, setModelMenuOpen] = useState(false);
    const [modelMenuPos, setModelMenuPos] = useState<{ bottom: number; left: number; width: number } | null>(null);
    const [loadingStep, setLoadingStep] = useState<1 | 2 | 3>(1);

    useEffect(() => {
        if (!isLoading) {
            setLoadingStep(1);
            return;
        }
        setLoadingStep(1);
        const timer1 = setTimeout(() => setLoadingStep(2), 1600);
        const timer2 = setTimeout(() => setLoadingStep(3), 3600);
        return () => {
            clearTimeout(timer1);
            clearTimeout(timer2);
        };
    }, [isLoading]);
    
    const bottomRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const modelMenuRef = useRef<HTMLDivElement>(null);
    const portalMenuRef = useRef<HTMLDivElement>(null);

    // Close model menu when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Node;
            if (
                modelMenuRef.current &&
                !modelMenuRef.current.contains(target) &&
                portalMenuRef.current &&
                !portalMenuRef.current.contains(target)
            ) {
                setModelMenuOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Recalculate position on scroll/resize
    useEffect(() => {
        if (!modelMenuOpen) return;
        const update = () => {
            if (modelMenuRef.current) {
                const rect = modelMenuRef.current.getBoundingClientRect();
                setModelMenuPos({
                    bottom: window.innerHeight - rect.top + 8,
                    left: rect.left,
                    width: Math.max(rect.width, 288)
                });
            }
        };
        update();
        window.addEventListener("scroll", update, true);
        window.addEventListener("resize", update);
        return () => {
            window.removeEventListener("scroll", update, true);
            window.removeEventListener("resize", update);
        };
    }, [modelMenuOpen]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isOpen, isLoading]);

    async function combineImagesSideBySide(imagesBase64: string[]): Promise<string> {
        if (imagesBase64.length <= 1) return imagesBase64[0] || "";

        try {
            const loadedImages: HTMLImageElement[] = await Promise.all(
                imagesBase64.map(src => new Promise<HTMLImageElement>((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                    img.src = src;
                }))
            );

            const targetHeight = 800;
            const scaledWidths = loadedImages.map(img => (img.width / img.height) * targetHeight);
            const totalWidth = scaledWidths.reduce((sum, w) => sum + w, 0) + (loadedImages.length - 1) * 12;

            const canvas = document.createElement("canvas");
            canvas.width = totalWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext("2d");

            if (!ctx) return imagesBase64[0];

            ctx.fillStyle = "#09090b";
            ctx.fillRect(0, 0, totalWidth, targetHeight);

            let currentX = 0;
            loadedImages.forEach((img, i) => {
                const w = scaledWidths[i];
                ctx.drawImage(img, currentX, 0, w, targetHeight);
                currentX += w;
                if (i < loadedImages.length - 1) {
                    ctx.fillStyle = "#f59e0b";
                    ctx.fillRect(currentX, 0, 12, targetHeight);
                    currentX += 12;
                }
            });

            return canvas.toDataURL("image/jpeg", 0.85);
        } catch (e) {
            console.error("Failed to combine images side-by-side:", e);
            return imagesBase64[0];
        }
    }

    const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        const validFiles = files.slice(0, 3 - imagePreviews.length);

        validFiles.forEach(file => {
            if (file.size > 4 * 1024 * 1024) {
                alert(language === "ar" ? "حجم الصورة كبير جداً (الأقصى 4MB)" : "Image too large (Max 4MB)");
                return;
            }

            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result === "string") {
                    const resultStr = reader.result;
                    setImagePreviews(prev => [...prev, resultStr]);
                }
            };
            reader.readAsDataURL(file);
        });

        e.target.value = "";
    }, [imagePreviews.length, language]);

    const removeImage = useCallback((index: number) => {
        setImagePreviews(prev => prev.filter((_, i) => i !== index));
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if ((!input.trim() && imagePreviews.length === 0) || !user || isLoading) return;

        const textToSend = input;
        const currentPreviews = [...imagePreviews];

        setInput("");
        setImagePreviews([]);

        let finalImagePayload: string | undefined = undefined;
        if (currentPreviews.length === 1) {
            finalImagePayload = currentPreviews[0];
        } else if (currentPreviews.length > 1) {
            finalImagePayload = await combineImagesSideBySide(currentPreviews);
        }

        await sendMessage(textToSend, finalImagePayload);
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
                fixed z-[9999] flex bg-white/95 dark:bg-[#09090b]/95 backdrop-blur-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl transition-all duration-500 overflow-hidden ring-1 ring-amber-500/10 dark:ring-amber-500/20
                max-md:inset-0 max-md:w-full max-md:h-full max-md:rounded-none max-md:pt-[env(safe-area-inset-top,20px)] max-md:pb-[env(safe-area-inset-bottom,10px)]
                md:rounded-2xl md:min-w-[400px] md:min-h-[500px] md:max-w-[100vw] md:max-h-[100vh]
                ${isExpanded 
                    ? "md:top-4 md:bottom-4 md:left-4 md:right-4 md:w-[calc(100vw-2rem)] md:h-[calc(100vh-2rem)] md:shadow-[0_0_50px_-12px_rgba(245,158,11,0.15)]" 
                    : "md:bottom-6 md:right-6 md:top-auto md:left-auto md:w-[700px] md:h-[680px]"
                }
            `}
        >
            {/* Sidebar Drawer */}
            {user && (
                <ChatSidebar
                    sessions={sessions}
                    activeSessionId={activeSessionId}
                    onSelectSession={switchSession}
                    onNewChat={createNewSession}
                    onDeleteSession={deleteSession}
                    onRenameSession={renameSession}
                    isOpen={isSidebarOpen}
                    onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                />
            )}

            {/* Main Chat Container */}
            <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-amber-500/20 bg-gradient-to-l from-amber-50/50 to-transparent dark:from-amber-950/20 dark:to-transparent shrink-0">
                    <div className="flex items-center gap-2 text-black dark:text-white font-medium">
                        {user && (
                            <button
                                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                className="md:hidden p-1.5 rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
                                title="قائمة المحادثات"
                            >
                                <PanelLeft className="h-4 w-4" />
                            </button>
                        )}
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
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="hidden md:flex p-1.5 rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-black dark:hover:text-white transition-colors"
                            title={isExpanded ? "تعديل الحجم الافتراضي" : "تكبير النافذة"}
                        >
                            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                        </button>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="p-2 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-black dark:hover:text-white transition-colors flex items-center justify-center active:scale-95"
                            title="إغلاق"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                {/* Messages Body */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 sm:p-4 space-y-3 sm:space-y-4">
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

                            {messages.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3 my-auto min-h-[260px] dir-rtl">
                                    <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                                        <Sparkles className="h-7 w-7" />
                                    </div>
                                    <h3 className="font-bold text-base text-black dark:text-white">كيف يمكنني مساعدتك اليوم؟</h3>
                                    <p className="text-xs text-zinc-400 max-w-[300px] leading-relaxed">
                                        اختر سهمًا للتحليل، أو استفسر عن مؤشرات RSI والمحافظ المالية، أو أرفق صورة للتحليل الفوري 📊
                                    </p>
                                </div>
                            )}

                            {messages.map((msg, idx) => (

                                <div
                                    key={idx}
                                    className="flex gap-2 sm:gap-4 w-full max-w-3xl mx-auto min-w-0"
                                >
                                    <div className={`
                                        h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-1
                                        ${msg.role === "user" ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400" : "bg-amber-500 text-black"}
                                    `}>
                                        {msg.role === "user" ? <User className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                                    </div>
                                    <div className={`
                                        flex-1 rounded-2xl p-2.5 sm:p-4 text-xs sm:text-sm max-w-full leading-relaxed min-w-0 overflow-hidden
                                        ${msg.role === "user"
                                            ? "bg-zinc-100 dark:bg-zinc-800 text-black dark:text-zinc-100"
                                            : "bg-transparent text-black dark:text-zinc-100"}
                                    `}>
                                        {/* Show image thumbnails if present */}
                                        {((msg.images && msg.images.length > 0) || (msg.imageUrl && msg.imageUrl !== "[image]") || msg.imagePreviewUrl) && (
                                            <div className="mb-2 flex flex-wrap gap-1.5">
                                                {(msg.images || [msg.imagePreviewUrl || msg.imageUrl!]).filter(img => img && img !== "[image]").map((img, i) => (
                                                    <img
                                                        key={i}
                                                        src={img}
                                                        alt={`Attached ${i + 1}`}
                                                        className="max-w-[180px] max-h-40 rounded-lg border border-zinc-300 dark:border-zinc-700 object-cover shadow-sm"
                                                    />
                                                ))}
                                            </div>
                                        )}
                                        <FormattedChatMessage 
                                            content={msg.content || msg.statusText || ""} 
                                            role={msg.role} 
                                            suggestedButtons={msg.suggestedButtons}
                                            showSuggestedButtons={idx === messages.length - 1}
                                            onButtonClick={(btnText) => sendMessage(btnText)}
                                            isStreaming={msg.isStreaming}
                                        />

                                    </div>
                                </div>
                            ))}

                            {isLoading && !messages[messages.length - 1]?.content && (
                                <div className="flex gap-3 w-full max-w-3xl mx-auto items-center p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 dark:bg-amber-500/5 transition-all duration-300">
                                    <div className="h-8 w-8 rounded-full bg-amber-500 flex items-center justify-center shrink-0 shadow-md">
                                        <Sparkles className="h-4 w-4 text-black animate-spin" />
                                    </div>
                                    <div className="flex-1 flex flex-col gap-0.5 overflow-hidden">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-amber-600 dark:text-amber-400 transition-all duration-300">
                                                {loadingStep === 1 && (imagePreviews.length > 0 ? "🧠 جاري قراءة الصورة واستيعاب السؤال..." : "🧠 جاري قراءة السؤال واستيعاب السياق...")}
                                                {loadingStep === 2 && "🔍 جاري استعلام بيانات وأسعار البورصة المصرية..."}
                                                {loadingStep === 3 && "📊 جاري صياغة التقرير المالي والرد النهائي..."}
                                            </span>
                                        </div>
                                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
                                            مرحلة {loadingStep} من 3
                                        </span>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={stopResponding}
                                        className="flex items-center gap-1 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30 rounded-xl px-2.5 py-1 text-xs font-bold transition-all shrink-0 mr-2"
                                        title={language === "ar" ? "إيقاف الاستجابة" : "Stop Responding"}
                                    >
                                        <X className="h-3.5 w-3.5" />
                                        <span>{language === "ar" ? "إيقاف" : "Stop"}</span>
                                    </button>

                                    <div className="flex items-center gap-1 shrink-0">
                                        <div className={`h-2 w-2 rounded-full transition-all duration-300 ${loadingStep === 1 ? "bg-amber-500 scale-125 animate-bounce" : "bg-zinc-400 dark:bg-zinc-600"}`}></div>
                                        <div className={`h-2 w-2 rounded-full transition-all duration-300 ${loadingStep === 2 ? "bg-amber-500 scale-125 animate-bounce" : "bg-zinc-400 dark:bg-zinc-600"}`}></div>
                                        <div className={`h-2 w-2 rounded-full transition-all duration-300 ${loadingStep === 3 ? "bg-amber-500 scale-125 animate-bounce" : "bg-zinc-400 dark:bg-zinc-600"}`}></div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                    <div ref={bottomRef} />
                </div>

                {/* Input Form */}
                <div className="p-3 sm:p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 shrink-0 min-w-0 overflow-hidden">
                    {user ? (
                        <form onSubmit={handleSubmit} className="space-y-2">
                            {/* Image Previews List */}
                            {imagePreviews.length > 0 && (
                                <div className="flex items-center gap-2 overflow-x-auto pb-1">
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

                            {/* Textarea + Action buttons box */}
                            <div className="relative flex items-end gap-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-2xl p-2 focus-within:border-amber-500 transition-colors">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    accept="image/png,image/jpeg,image/webp,image/gif"
                                    className="hidden"
                                    onChange={handleImageSelect}
                                />

                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isLoading}
                                    className="h-9 w-9 shrink-0 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 flex items-center justify-center transition-all disabled:opacity-50 relative mb-0.5"
                                    title={language === "ar" ? "إرفاق صور للتحليل" : "Attach images for analysis"}
                                >
                                    <ImagePlus className="h-4 w-4" />
                                    {imagePreviews.length > 0 && (
                                        <span className="absolute -top-1 -right-1 bg-amber-500 text-black text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-black">
                                            {imagePreviews.length}
                                        </span>
                                    )}
                                </button>

                                <textarea
                                    rows={1}
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSubmit(e);
                                        }
                                    }}
                                    placeholder={
                                        imagePreviews.length > 0
                                            ? (language === "ar" ? `أضف وصفاً لـ (${imagePreviews.length}) صور (اختياري)...` : `Add description for (${imagePreviews.length}) images (optional)...`) 
                                            : (language === "ar" ? "اسأل عن أي سهم في البورصة المصرية... (Shift+Enter لسطر جديد)" : "Ask about any EGX stock... (Shift+Enter for newline)")
                                    }
                                    className="flex-1 min-h-[36px] max-h-[120px] py-1.5 px-2 bg-transparent text-sm text-black dark:text-zinc-100 placeholder:text-zinc-500 focus:outline-none resize-none leading-relaxed"
                                />

                                <button
                                    type="submit"
                                    disabled={isLoading || (!input.trim() && imagePreviews.length === 0)}
                                    className="h-9 w-9 shrink-0 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:hover:bg-amber-500 text-black flex items-center justify-center transition-all mb-0.5"
                                >
                                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                </button>
                            </div>

                            {/* Bottom Bar: Custom Modern Model Selector Dropdown Menu */}
                            <div className="flex items-center justify-between pt-1">
                                {(() => {
                                    const currentModelObj = AVAILABLE_AI_MODELS.find(m => m.id === selectedModel) || AVAILABLE_AI_MODELS[0];
                                    return (
                                        <div className="relative inline-block" ref={modelMenuRef}>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (!modelMenuOpen && modelMenuRef.current) {
                                                        const rect = modelMenuRef.current.getBoundingClientRect();
                                                        setModelMenuPos({
                                                            bottom: window.innerHeight - rect.top + 8,
                                                            left: Math.max(4, Math.min(rect.left, window.innerWidth - 292)),
                                                            width: Math.max(rect.width, 288)
                                                        });
                                                    }
                                                    setModelMenuOpen(!modelMenuOpen);
                                                }}
                                                className="flex items-center gap-1.5 bg-zinc-200/80 dark:bg-zinc-800/90 hover:bg-zinc-300/80 dark:hover:bg-zinc-700/80 border border-zinc-300 dark:border-zinc-700/80 rounded-xl px-2.5 py-1 text-[11px] text-black dark:text-white font-bold transition-all shadow-sm active:scale-95"
                                            >
                                                <Cpu className="h-3 w-3 text-amber-500 shrink-0" />
                                                <span className="flex items-center gap-1">
                                                    <span>{currentModelObj?.name}</span>
                                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold">
                                                        {language === "ar" ? currentModelObj?.badgeAr : currentModelObj?.badgeEn}
                                                    </span>
                                                </span>
                                                <ChevronDown className={`h-3 w-3 text-zinc-500 transition-transform duration-200 ${modelMenuOpen ? "rotate-180" : ""}`} />
                                            </button>

                                            {/* Model dropdown rendered as portal to escape overflow:hidden */}
                                            {modelMenuOpen && modelMenuPos && typeof document !== "undefined" && createPortal(
                                                <div
                                                    ref={portalMenuRef}
                                                    style={{
                                                        position: "fixed",
                                                        bottom: modelMenuPos.bottom,
                                                        left: modelMenuPos.left,
                                                        width: modelMenuPos.width,
                                                        zIndex: 99999
                                                    }}
                                                    className="bg-white/98 dark:bg-zinc-900/98 backdrop-blur-xl border border-zinc-200 dark:border-zinc-700 shadow-2xl rounded-2xl p-1.5 space-y-0.5"
                                                >
                                                    <div className="px-2.5 py-1.5 text-[10px] font-black uppercase text-zinc-400 tracking-wider border-b border-zinc-100 dark:border-zinc-800 mb-1">
                                                        {language === "ar" ? "🤖 اختر موديل الذكاء الاصطناعي" : "🤖 Select AI Model"}
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
                                                                        ? "bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/40 text-black dark:text-white"
                                                                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 border border-transparent"}
                                                                `}
                                                            >
                                                                <div className="flex flex-col gap-0.5 min-w-0 pr-2">
                                                                    <div className="flex items-center gap-1.5 font-bold text-black dark:text-white">
                                                                        <span>{m.name}</span>
                                                                        <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold">
                                                                            {language === "ar" ? m.badgeAr : m.badgeEn}
                                                                        </span>
                                                                        {isSelected && <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold">✓ نشط</span>}
                                                                    </div>
                                                                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-normal leading-tight">
                                                                        {language === "ar" ? m.descAr : m.descEn}
                                                                    </span>
                                                                </div>
                                                                {isSelected && <Check className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />}
                                                            </button>
                                                        );
                                                    })}
                                                </div>,
                                                document.body
                                            )}
                                        </div>
                                    );
                                })()}

                                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">
                                    {language === "ar" ? "Shift+Enter لسطر جديد" : "Shift+Enter for newline"}
                                </span>
                            </div>
                        </form>
                    ) : (
                        <div className="text-center text-xs text-zinc-500 dark:text-zinc-400 py-1">
                            🔒 سجل الدخول أولاً لتتمكن من كتابة وإرسال الأسئلة.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
