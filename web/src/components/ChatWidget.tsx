"use client";

import { useChat, AVAILABLE_AI_MODELS } from "@/contexts/ChatContext";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRouter } from "next/navigation";
import NextImage from "next/image";
import { Send, X, Sparkles, User, Loader2, Lock, Maximize2, Minimize2, LogIn, UserPlus, ImagePlus, XCircle, Cpu, ChevronDown, Check, PanelLeft, Square, Download, ZoomIn } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { FormattedChatMessage } from "@/components/chat/FormattedChatMessage";
import { isChatAdminEmail } from "@/lib/chat-sharing";
import { toast } from "sonner";

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
    const [previewModalImage, setPreviewModalImage] = useState<string | null>(null);
    const [modelMenuOpen, setModelMenuOpen] = useState(false);
    const [modelMenuPos, setModelMenuPos] = useState<{ bottom: number; left: number; width: number } | null>(null);
    const [loadingStep, setLoadingStep] = useState<1 | 2 | 3>(1);
    const [sharingMessageId, setSharingMessageId] = useState<string | null>(null);
    const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
    const isChatAdmin = isChatAdminEmail(user?.email);

    const handleDownloadImage = async (url: string) => {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            const ext = blob.type.split("/")[1] || "png";
            a.download = `egxbots-image-${Date.now()}.${ext.replace(/[^a-z0-9]/gi, "")}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(blobUrl);
            toast.success(language === "ar" ? "تم تحميل الصورة بنجاح" : "Image downloaded successfully");
        } catch {
            const a = document.createElement("a");
            a.href = url;
            a.target = "_blank";
            a.download = `egxbots-image-${Date.now()}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    };

    const shareAnswer = useCallback(async (messageIndex: number) => {
        const answerMessage = messages[messageIndex];
        const questionMessage = [...messages.slice(0, messageIndex)].reverse().find(message => message.role === "user");
        if (!answerMessage?.content || !questionMessage?.content) return;
        const shareKey = answerMessage.id || String(messageIndex);
        setSharingMessageId(shareKey);
        try {
            const response = await fetch("/api/chat/share", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: questionMessage.content, answer: answerMessage.content }),
            });
            const data = await response.json();
            if (!response.ok || !data.url) throw new Error(data.error || "تعذر إنشاء الرابط");
            await navigator.clipboard.writeText(data.url);
            toast.success("تم نشر الإجابة ونسخ رابط المدونة");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "تعذر نشر الإجابة");
        } finally {
            setSharingMessageId(null);
        }
    }, [messages]);

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

    // Automatically open ChatWidget modal if URL contains chat=open parameter
    useEffect(() => {
        if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            if (params.get("chat") === "open" || params.get("chat") === "1" || params.get("openChat") === "true") {
                setIsOpen(true);
            }
        }
    }, [setIsOpen]);
    
    const bottomRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const modelMenuRef = useRef<HTMLDivElement>(null);
    const portalMenuRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Dynamic auto-expand textarea height as user types
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 220)}px`;
        }
    }, [input]);

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

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
        setIsUserScrolledUp(!isAtBottom);
    };

    useEffect(() => {
        if (!isUserScrolledUp) {
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages, isOpen, isLoading, isUserScrolledUp]);

    async function compressAndResizeImage(base64Str: string, maxDim = 1024, quality = 0.8): Promise<string> {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    resolve(base64Str);
                    return;
                }
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL("image/jpeg", quality));
            };
            img.onerror = () => resolve(base64Str);
            img.src = base64Str;
        });
    }

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
            if (file.size > 8 * 1024 * 1024) {
                alert(language === "ar" ? "حجم الصورة كبير جداً (الأقصى 8MB)" : "Image too large (Max 8MB)");
                return;
            }

            const reader = new FileReader();
            reader.onload = async () => {
                if (typeof reader.result === "string") {
                    const compressed = await compressAndResizeImage(reader.result);
                    setImagePreviews(prev => [...prev, compressed]);
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
        if (isLoading) {
            stopResponding();
            return;
        }
        if ((!input.trim() && imagePreviews.length === 0) || !user) return;

        setIsUserScrolledUp(false);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

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
                className="fixed bottom-5 right-5 h-16 w-16 bg-[#FFE600] hover:bg-[#ffef5c] border-4 border-black dark:border-white text-black flex items-center justify-center shadow-[6px_6px_0_0_#000] dark:shadow-[6px_6px_0_0_#fff] transition-all hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[9px_9px_0_0_#000] dark:hover:shadow-[9px_9px_0_0_#fff] active:translate-x-1 active:translate-y-1 active:shadow-none z-[9999] animate-in fade-in zoom-in duration-300 p-2"
                title="AI Market Assistant"
            >
                <NextImage src="/favicon_io/apple-touch-icon.png" alt="EGX Bots" width={40} height={40} className="w-10 h-10 object-contain" priority />
            </button>
        );
    }

    return (
        <div 
            className={`
                fixed z-[9999] flex bg-[#fffdf2] dark:bg-[#09090b] border-4 border-black dark:border-white transition-all duration-300 overflow-hidden
                max-md:inset-0 max-md:w-full max-md:h-full max-md:rounded-none max-md:pt-[env(safe-area-inset-top,20px)] max-md:pb-[env(safe-area-inset-bottom,10px)]
                md:rounded-none md:min-w-[400px] md:min-h-[500px] md:max-w-[100vw] md:max-h-[100vh]
                ${isExpanded 
                    ? "md:top-4 md:bottom-4 md:left-4 md:right-4 md:w-[calc(100vw-2rem)] md:h-[calc(100vh-2rem)] md:shadow-[10px_10px_0_0_#000] dark:md:shadow-[10px_10px_0_0_#fff]"
                    : "md:bottom-6 md:right-6 md:top-auto md:left-auto md:w-[700px] md:h-[680px] md:shadow-[10px_10px_0_0_#000] dark:md:shadow-[10px_10px_0_0_#fff]"
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
                <div className="flex items-center justify-between px-4 py-3 border-b-4 border-black dark:border-white bg-[#FFE600] shrink-0">
                    <div className="flex items-center gap-2 text-black font-black uppercase tracking-tight">
                        {user && (
                            <button
                                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                className="p-1.5 bg-white text-black border-2 border-black shadow-[2px_2px_0_0_#000] hover:bg-amber-400 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all cursor-pointer"
                                title="سجل المحادثات"
                            >
                                <PanelLeft className="h-4 w-4 stroke-[2.5]" />
                            </button>
                        )}
                        <div className="h-9 w-9 border-2 border-black bg-white flex items-center justify-center shadow-[2px_2px_0_0_#000] p-1 shrink-0">
                            <NextImage src="/favicon_io/apple-touch-icon.png" alt="EGX Bots" width={28} height={28} className="w-6 h-6 object-contain" />
                        </div>
                        <span>EGX AI Assistant</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {user && (
                            <div className="text-[10px] font-black px-2.5 py-1.5 bg-white text-black border-2 border-black uppercase shadow-[2px_2px_0_0_#000]">
                                {remainingQuota >= 99 ? "Unlimited ♾️" : `${remainingQuota}/50 Left`}
                            </div>
                        )}
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="hidden md:flex p-1.5 bg-white text-black border-2 border-black shadow-[2px_2px_0_0_#000] hover:bg-amber-400 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all cursor-pointer"
                            title={isExpanded ? "تعديل الحجم الافتراضي" : "تكبير النافذة"}
                        >
                            {isExpanded ? <Minimize2 className="h-4 w-4 stroke-[2.5]" /> : <Maximize2 className="h-4 w-4 stroke-[2.5]" />}
                        </button>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="p-1.5 bg-white text-black border-2 border-black shadow-[2px_2px_0_0_#000] hover:bg-rose-400 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all cursor-pointer flex items-center justify-center"
                            title="إغلاق"
                        >
                            <X className="h-4 w-4 stroke-[2.5]" />
                        </button>
                    </div>
                </div>

                {/* Messages Body */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5 space-y-4 neobrutal-grid-bg" onScroll={handleScroll}>
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
                                <div className="max-w-2xl mx-auto w-full py-4 px-2 space-y-6 dir-rtl animate-in fade-in slide-in-from-bottom-2 duration-300">
                                    {/* Header & Logo */}
                                    <div className="flex flex-col items-center text-center space-y-2.5">
                                        <div className="relative">
                                            <div className="h-16 w-16 border-4 border-black dark:border-white bg-[#FFE600] text-black flex items-center justify-center shadow-[5px_5px_0_0_#000] dark:shadow-[5px_5px_0_0_#fff] rotate-[-2deg] p-2">
                                                <NextImage src="/favicon_io/apple-touch-icon.png" alt="EGX Bots" width={48} height={48} className="w-11 h-11 object-contain" />
                                            </div>
                                            <span className="absolute -bottom-2 -right-2 px-1.5 py-0.5 bg-[#00FF66] text-black text-[9px] font-black uppercase border-2 border-black tracking-wider">
                                                AI PRO
                                            </span>
                                        </div>
                                        <h3 className="font-black text-xl sm:text-2xl text-black dark:text-white tracking-tight">
                                            اسأل السوق أو حلل محفظتك بالذكاء الاصطناعي
                                        </h3>
                                        <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 max-w-lg leading-relaxed font-medium">
                                            مساعد استثماري متصل مباشرة ببيانات البورصة المصرية اللحظية، مستويات وايكوف، ونماذج تعلم آلي متطورة.
                                        </p>
                                    </div>

                                    {/* Portfolio Image Upload Hero Card */}
                                    <div 
                                        onClick={() => fileInputRef.current?.click()}
                                        className="group relative cursor-pointer border-3 border-dashed border-black dark:border-[#FFE600] bg-[#FFE600]/10 hover:bg-[#FFE600]/25 dark:bg-[#FFE600]/5 dark:hover:bg-[#FFE600]/15 p-4 sm:p-5 transition-all shadow-[4px_4px_0_0_#000] dark:shadow-[4px_4px_0_0_#FFE600] hover:-translate-y-0.5 active:translate-y-0 text-right"
                                    >
                                        <div className="flex items-start sm:items-center justify-between gap-3">
                                            <div className="space-y-1 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="px-2 py-0.5 bg-[#FFE600] text-black text-[10px] font-black uppercase border-2 border-black">
                                                        جديد وحصري 📸
                                                    </span>
                                                    <h4 className="font-black text-sm sm:text-base text-black dark:text-white">
                                                        حلل محفظتك الاستثمارية من صورة
                                                    </h4>
                                                </div>
                                                <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed font-medium">
                                                    ارفع سكرين شوت لمحفظتك من (ثندر أو تطبيق وسيطك)، وسيقوم المساعد فوراً بقراءة الأسهم، حساب نسب السيولة، وتحليل المخاطر والأهداف الفنية لكل سهم.
                                                </p>
                                            </div>
                                            <button 
                                                type="button"
                                                className="shrink-0 px-3 py-2 bg-[#FFE600] text-black font-black text-xs border-2 border-black shadow-[2px_2px_0_0_#000] group-hover:bg-amber-300 active:translate-x-0.5 active:translate-y-0.5 transition-all flex items-center gap-1.5"
                                            >
                                                <ImagePlus className="w-4 h-4" />
                                                <span className="hidden sm:inline">رفع لقطة شاشة</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Smart Categorized Questions Grid */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between border-b border-black/15 dark:border-white/15 pb-1">
                                            <span className="text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                                أسئلة واقتراحات شائعة للبدء:
                                            </span>
                                            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                                                اضغط على أي سؤال للإرسال فوراً ⚡
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                            {[
                                                {
                                                    icon: "🔥",
                                                    tag: "سيولة وزخم",
                                                    text: "إيه أقوى الأسهم اللي بتجمع سيولة وأحجام تداول النهاردة؟"
                                                },
                                                {
                                                    icon: "📊",
                                                    tag: "وايكوف",
                                                    text: "هل فيه أسهم في مناطق تجميع وايكوف ومؤشرات إيجابية؟"
                                                },
                                                {
                                                    icon: "⚖️",
                                                    tag: "مقارنة",
                                                    text: "قارن لي بين البنك التجاري الدولي (COMI) ومجموعة طلعت مصطفى (TMGH)"
                                                },
                                                {
                                                    icon: "🛡️",
                                                    tag: "إدارة مخاطر",
                                                    text: "إزاي أوزع سيولتي وأحمي أرباحي عند تذبذب المؤشر العام؟"
                                                },
                                                {
                                                    icon: "🏭",
                                                    tag: "قطاعات",
                                                    text: "ما هو أنشط قطاع في البورصة المصرية حالياً ولماذا؟"
                                                },
                                                {
                                                    icon: "📈",
                                                    tag: "أسهم دفاعية",
                                                    text: "ما هي أفضل الأسهم الدفاعية وتوزيعات الأرباح في السوق؟"
                                                }
                                            ].map((q, qIdx) => (
                                                <button
                                                    key={qIdx}
                                                    type="button"
                                                    onClick={() => sendMessage(q.text)}
                                                    className="flex items-start gap-2.5 p-3 text-right bg-white dark:bg-zinc-900 border-2 border-black dark:border-white/80 shadow-[3px_3px_0_0_#000] dark:shadow-[3px_3px_0_0_#fff] hover:bg-amber-50 dark:hover:bg-zinc-800 hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-all group cursor-pointer"
                                                >
                                                    <span className="text-base shrink-0 p-1 bg-zinc-100 dark:bg-zinc-800 border border-black/20 dark:border-white/20">
                                                        {q.icon}
                                                    </span>
                                                    <div className="flex flex-col min-w-0 flex-1">
                                                        <span className="text-[10px] font-black text-amber-600 dark:text-amber-400 mb-0.5">
                                                            {q.tag}
                                                        </span>
                                                        <span className="text-xs font-bold text-black dark:text-zinc-100 group-hover:text-amber-700 dark:group-hover:text-amber-300 leading-snug">
                                                            {q.text}
                                                        </span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {messages.map((msg, idx) => (

                                <div
                                    key={idx}
                                    className="flex gap-2 sm:gap-4 w-full max-w-3xl mx-auto min-w-0"
                                >
                                    <div className={`
                                        h-9 w-9 border-2 border-black dark:border-white flex items-center justify-center shrink-0 mt-1 shadow-[2px_2px_0_0_#000] dark:shadow-[2px_2px_0_0_#fff] p-1
                                        ${msg.role === "user" ? "bg-white dark:bg-zinc-800 text-black dark:text-white" : "bg-white dark:bg-zinc-900"}
                                    `}>
                                        {msg.role === "user" ? <User className="h-5 w-5" /> : <NextImage src="/favicon_io/apple-touch-icon.png" alt="EGX Bots" width={28} height={28} className="w-6 h-6 object-contain" />}
                                    </div>
                                    <div className={`
                                        flex-1 border-2 border-black dark:border-white p-3 sm:p-4 text-xs sm:text-sm max-w-full leading-relaxed min-w-0 overflow-hidden shadow-[4px_4px_0_0_#000] dark:shadow-[4px_4px_0_0_#fff]
                                        ${msg.role === "user"
                                            ? "bg-[#67E8F9] dark:bg-cyan-950 text-black dark:text-zinc-100"
                                            : "bg-white dark:bg-zinc-900 text-black dark:text-zinc-100"}
                                    `}>
                                        {/* Show image thumbnails if present */}
                                        {((msg.images && msg.images.length > 0) || (msg.imageUrl && msg.imageUrl !== "[image]") || msg.imagePreviewUrl) && (
                                            <div className="mb-2.5 flex flex-wrap gap-2">
                                                {(msg.images || [msg.imagePreviewUrl || msg.imageUrl!]).filter(img => img && img !== "[image]").map((img, i) => (
                                                    <div
                                                        key={i}
                                                        onClick={() => setPreviewModalImage(img)}
                                                        className="relative group cursor-pointer overflow-hidden border-2 border-black dark:border-white shadow-[3px_3px_0_0_#000] dark:shadow-[3px_3px_0_0_#fff] hover:scale-[1.02] transition-all bg-black/5"
                                                        title="انقر لتكبير وتحميل الصورة"
                                                    >
                                                        <img
                                                            src={img}
                                                            alt={`Attached ${i + 1}`}
                                                            className="max-w-[200px] max-h-44 object-cover"
                                                        />
                                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-bold">
                                                            <ZoomIn className="w-4 h-4 text-[#FFE600]" />
                                                            <span>تكبير / تحميل</span>
                                                        </div>
                                                    </div>
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
                                             tables={msg.tables}
                                             showShareButton={isChatAdmin && msg.role === "assistant" && idx === messages.length - 1}
                                             onShare={() => shareAnswer(idx)}
                                             sharing={sharingMessageId === (msg.id || String(idx))}
                                             latencyMs={msg.latencyMs}
                                         />

                                    </div>
                                </div>
                            ))}

                            {isLoading && !messages[messages.length - 1]?.content && (
                                <div className="flex gap-3 w-full max-w-3xl mx-auto items-center p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 dark:bg-amber-500/5 transition-all duration-300">
                                    <div className="h-8 w-8 rounded-none border-2 border-black bg-white flex items-center justify-center shrink-0 shadow-md p-1">
                                        <NextImage src="/favicon_io/apple-touch-icon.png" alt="EGX Bots" width={24} height={24} className="w-5 h-5 object-contain animate-pulse" />
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
                <div className="p-3 sm:p-4 border-t-4 border-black dark:border-white bg-[#FFE600] shrink-0 min-w-0 overflow-hidden">
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
                            <div className="relative flex items-end gap-2 bg-white dark:bg-zinc-950 border-4 border-black dark:border-white p-2 focus-within:bg-[#fffce0] dark:focus-within:bg-zinc-900 transition-colors shadow-[4px_4px_0_0_#000]">
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
                                    ref={textareaRef}
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
                                    className="flex-1 min-h-[42px] max-h-[220px] py-2 px-3 bg-transparent text-base md:text-sm text-black dark:text-zinc-100 placeholder:text-zinc-500 focus:outline-none resize-none leading-relaxed overflow-y-auto transition-all duration-150"
                                />

                                <button
                                    type={isLoading ? "button" : "submit"}
                                    onClick={isLoading ? () => stopResponding() : undefined}
                                    disabled={!isLoading && (!input.trim() && imagePreviews.length === 0)}
                                    className={`h-10 w-10 shrink-0 border-2 border-black flex items-center justify-center transition-all mb-0.5 ${
                                        isLoading
                                            ? "bg-red-500 hover:bg-red-600 text-white cursor-pointer shadow-sm active:scale-95"
                                            : "bg-black hover:bg-zinc-800 disabled:opacity-50 text-white"
                                    }`}
                                    title={isLoading ? (language === "ar" ? "إيقاف الرد" : "Stop generation") : (language === "ar" ? "إرسال" : "Send")}
                                >
                                    {isLoading ? <Square className="h-3.5 w-3.5 fill-current" /> : <Send className="h-4 w-4" />}
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

            {/* Fullscreen Image Lightbox Modal */}
            {previewModalImage && (
                <div 
                    className="fixed inset-0 z-[100000] bg-black/90 backdrop-blur-md flex flex-col items-center justify-between p-4 sm:p-6 animate-in fade-in duration-200"
                    onClick={() => setPreviewModalImage(null)}
                >
                    {/* Modal Header */}
                    <div 
                        className="w-full max-w-4xl flex items-center justify-between py-2 border-b-2 border-white/20 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-2 text-white font-black text-sm">
                            <NextImage src="/favicon_io/apple-touch-icon.png" alt="Logo" width={24} height={24} className="w-6 h-6 object-contain" />
                            <span>معاينة الصورة المرفقة</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => handleDownloadImage(previewModalImage)}
                                className="flex items-center gap-2 px-4 py-2 bg-[#FFE600] text-black font-black text-xs border-2 border-black shadow-[3px_3px_0_0_#fff] hover:bg-yellow-300 active:translate-x-0.5 active:translate-y-0.5 transition-all cursor-pointer"
                                title="تحميل الصورة إلى جهازك"
                            >
                                <Download className="w-4 h-4 stroke-[2.5]" />
                                <span>تحميل الصورة</span>
                            </button>
                            <button
                                onClick={() => setPreviewModalImage(null)}
                                className="p-1.5 bg-white/10 hover:bg-white/20 text-white border-2 border-white/30 transition-all cursor-pointer"
                                title="إغلاق"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* Modal Image Body */}
                    <div 
                        className="flex-1 flex items-center justify-center max-w-5xl w-full my-4 overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <img 
                            src={previewModalImage} 
                            alt="Enlarged Chat Attachment" 
                            className="max-w-full max-h-[75vh] object-contain border-4 border-black dark:border-white shadow-[8px_8px_0_0_#FFE600] bg-zinc-950" 
                        />
                    </div>

                    {/* Modal Footer hint */}
                    <div className="text-zinc-400 text-xs font-medium text-center shrink-0">
                        انقر في أي مكان خارج الصورة أو اضغط على زر الإغلاق للعودة
                    </div>
                </div>
            )}
        </div>
    );
}
