"use client";

import { createContext, useContext, useState, ReactNode, useEffect, useCallback, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useAuth } from "@/contexts/AuthContext";
import { useTechnicalScanner } from "@/contexts/TechnicalScannerContext";
import { useRouter } from "next/navigation";
import { ChatSession } from "@/components/chat/ChatSidebar";

export type ChatMessage = {
    id?: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    imageUrl?: string;
    images?: string[];
    actions?: ChatAction[];
};

type ChatAction = {
    label: string;
    type: "navigate" | "function";
    value: string;
};

export const AVAILABLE_AI_MODELS = [
    { id: "z-ai/glm-5.2", name: "GLM 5.2", badgeAr: "عملاق 📊", badgeEn: "GLM 5.2 📊", descAr: "نموذج Z-AI GLM 5.2 بسعة 753B لعمليات الاستدلال المعقدة", descEn: "Z-AI GLM 5.2 MoE 753B model for complex reasoning" },
    { id: "openai/gpt-oss-120b", name: "GPT OSS 120B", badgeAr: "جديد 🤖", badgeEn: "OpenAI Open 🤖", descAr: "موديل OpenAI المفتوح المصدر سعة 120B بارامتر للتحليلات", descEn: "OpenAI open-source 120B model for high-tier analysis" },
    { id: "deepseek-ai/deepseek-v4-pro", name: "DeepSeek V4 Pro", badgeAr: "العملاق 🔥", badgeEn: "Ultra MoE 🔥", descAr: "نموذج ديب سيك V4 الأحدث بسياق 1M وسرعة تحليلائيات", descEn: "Latest DeepSeek V4 Pro model with 1M context" },
    { id: "deepseek-ai/deepseek-v4-flash", name: "DeepSeek V4 Flash", badgeAr: "تفكير عالي 🧠", badgeEn: "Reasoning 🧠", descAr: "متخصص في الاستنتاج البرمجي والمالي العميق", descEn: "Specialized in deep reasoning and financial logic" },
    { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6", badgeAr: "جديد 🌙", badgeEn: "Kimi 🌙", descAr: "موديل Moonshot Kimi لتفسير المستندات والسياق الطويل", descEn: "Moonshot AI Kimi model for long context" },
    { id: "meta/llama-3.3-70b-instruct", name: "Llama 3.3 70B", badgeAr: "الأذكى ✨", badgeEn: "Smartest ✨", descAr: "نموذج الذكاء الاصطناعي الأقوى لتحليل البورصة", descEn: "Most capable model for stock analysis" },
    { id: "meta/llama-3.2-11b-vision-instruct", name: "Llama 3.2 Vision", badgeAr: "رؤية الصور 📷", badgeEn: "Vision 📷", descAr: "متخصص في قراءة وتحليل صور الشاشات والمحافظ", descEn: "Specialized in analyzing portfolio screenshots" },
    { id: "meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B", badgeAr: "سريع ⚡", badgeEn: "Fast ⚡", descAr: "فائق السرعة للإجابات المباشرة السريعة", descEn: "Ultra-fast response for simple queries" },
];

interface ChatContextType {
    isOpen: boolean;
    setIsOpen: (v: boolean) => void;
    messages: ChatMessage[];
    sendMessage: (text: string, imageInput?: string | string[]) => Promise<void>;
    isLoading: boolean;
    remainingQuota: number;
    selectedModel: string;
    setSelectedModel: (model: string) => void;
    sessions: ChatSession[];
    activeSessionId: string | null;
    createNewSession: () => void;
    switchSession: (sessionId: string) => Promise<void>;
    deleteSession: (sessionId: string) => Promise<void>;
    renameSession: (sessionId: string, newTitle: string) => Promise<void>;
    isSidebarOpen: boolean;
    setIsSidebarOpen: (v: boolean) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const { setTechScanner } = useTechnicalScanner();
    const router = useRouter();

    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [remainingQuota, setRemainingQuota] = useState<number>(15);
    const [selectedModel, setSelectedModelState] = useState<string>("meta/llama-3.3-70b-instruct");
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

    const messagesRef = useRef<ChatMessage[]>(messages);
    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    const WELCOME_MSG: ChatMessage = {
        role: "assistant",
        content: "أهلاً بك! أنا مساعدك الذكي البورصة المصرية (EGX AI Assistant). يمكنك الاستفسار عن الأسهم، إشارات الـ AI، قراءة صور المحافظ والشاشات 📷، وتصدير الجداول والمخططات لإكسيل.",
        timestamp: 0,
    };

    useEffect(() => {
        const savedModel = localStorage.getItem("egxbots_selected_model");
        if (savedModel && AVAILABLE_AI_MODELS.some(m => m.id === savedModel)) {
            setSelectedModelState(savedModel);
        }
    }, []);

    const setSelectedModel = useCallback((model: string) => {
        setSelectedModelState(model);
        localStorage.setItem("egxbots_selected_model", model);
    }, []);

    // Fetch sessions list from backend
    const fetchSessions = useCallback(async () => {
        try {
            const res = await fetch("/api/ai-chat?action=sessions");
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.sessions)) {
                    setSessions(data.sessions);
                }
                if (data.remaining_quota !== undefined) {
                    setRemainingQuota(data.remaining_quota);
                }
            }
        } catch (e) {
            console.error("Failed to fetch chat sessions:", e);
        }
    }, []);

    // Switch active session and fetch its messages
    const switchSession = useCallback(async (sessionId: string) => {
        setActiveSessionId(sessionId);
        setIsLoading(true);
        try {
            const res = await fetch(`/api/ai-chat?session_id=${sessionId}`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.history) && data.history.length > 0) {
                    setMessages([WELCOME_MSG, ...data.history]);
                    messagesRef.current = [WELCOME_MSG, ...data.history];
                } else {
                    setMessages([WELCOME_MSG]);
                    messagesRef.current = [WELCOME_MSG];
                }
            }
        } catch (e) {
            console.error("Failed to load session messages:", e);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Start a new chat session
    const createNewSession = useCallback(() => {
        setActiveSessionId(null);
        setMessages([WELCOME_MSG]);
        messagesRef.current = [WELCOME_MSG];
    }, []);

    // Delete a session
    const deleteSession = useCallback(async (sessionId: string) => {
        try {
            const res = await fetch(`/api/ai-chat?session_id=${sessionId}`, { method: "DELETE" });
            if (res.ok) {
                setSessions(prev => prev.filter(s => s.id !== sessionId));
                if (activeSessionId === sessionId) {
                    createNewSession();
                }
            }
        } catch (e) {
            console.error("Failed to delete chat session:", e);
        }
    }, [activeSessionId, createNewSession]);

    // Rename a session
    const renameSession = useCallback(async (sessionId: string, newTitle: string) => {
        try {
            const res = await fetch("/api/ai-chat", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: sessionId, title: newTitle })
            });
            if (res.ok) {
                setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s));
            }
        } catch (e) {
            console.error("Failed to rename session:", e);
        }
    }, []);

    // Initial load on mount or user change
    useEffect(() => {
        fetchSessions();
    }, [user, fetchSessions]);

    const sendMessage = useCallback(async (text: string, imageInput?: string | string[]) => {
        const imagesList: string[] = Array.isArray(imageInput) 
            ? imageInput 
            : (imageInput ? [imageInput] : []);

        if (!text.trim() && imagesList.length === 0) return;

        const newUserMsg: ChatMessage = {
            role: "user",
            content: text || (imagesList.length > 0 ? `📷 [${imagesList.length} Images attached]` : ""),
            timestamp: Date.now(),
            imageUrl: imagesList[0] || undefined,
            images: imagesList.length > 0 ? imagesList : undefined,
        };

        const historySnapshot = [...messagesRef.current];
        const nextMessages = [...historySnapshot, newUserMsg];
        setMessages(nextMessages);
        messagesRef.current = nextMessages;
        setIsLoading(true);

        try {
            if (remainingQuota <= 0) {
                const limitMsg: ChatMessage = {
                    role: "assistant",
                    content: "وصلت للحد الأقصى اليومي (15 رسالة يومياً). يرجى العودة غداً أو تواصل مع الدعم الفني!",
                    timestamp: Date.now()
                };
                setMessages(prev => [...prev, limitMsg]);
                messagesRef.current = [...messagesRef.current, limitMsg];
                setIsLoading(false);
                return;
            }

            const response = await fetch("/api/ai-chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text || "قم بقراءة وتحليل هذه الصورة المرفقة.",
                    history: historySnapshot.map(m => ({ role: m.role, content: m.content })),
                    images: imagesList.length > 0 ? imagesList : undefined,
                    image: imagesList[0] || undefined,
                    model: selectedModel,
                    session_id: activeSessionId || undefined,
                })
            });

            if (response.status === 504 || response.status === 502) {
                const timeoutMsg: ChatMessage = {
                    role: "assistant",
                    content: "استغرقت الاستجابة وقتاً أطول من المعتاد بسبب الضغط على الموديل. يرجى إعادة المحاولة أو اختيار موديل أسرع مثل Llama 3.1 8B ⚡",
                    timestamp: Date.now()
                };
                setMessages(prev => [...prev, timeoutMsg]);
                messagesRef.current = [...messagesRef.current, timeoutMsg];
                return;
            }

            const data = await response.json();
            
            if (response.status === 429) {
                setRemainingQuota(0);
                const limitMsg: ChatMessage = {
                    role: "assistant",
                    content: data.detail || "وصلت للحد الأقصى اليومي 15 رسالة.",
                    timestamp: Date.now()
                };
                setMessages(prev => [...prev, limitMsg]);
                messagesRef.current = [...messagesRef.current, limitMsg];
                return;
            }

            if (!response.ok) {
                throw new Error(data.detail || "Failed to communicate with AI");
            }

            if (data.session_id) {
                setActiveSessionId(data.session_id);
                fetchSessions();
            }

            if (data.remaining_quota !== undefined) {
                setRemainingQuota(data.remaining_quota);
            }

            const assistantMsg: ChatMessage = {
                role: "assistant",
                content: data.reply || "معذرة، لم أتمكن من معالجة هذا الطلب.",
                timestamp: Date.now()
            };
            setMessages(prev => [...prev, assistantMsg]);
            messagesRef.current = [...messagesRef.current, assistantMsg];

        } catch (err: any) {
            const errorMsg: ChatMessage = {
                role: "assistant",
                content: "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي.",
                timestamp: Date.now()
            };
            setMessages(prev => [...prev, errorMsg]);
            messagesRef.current = [...messagesRef.current, errorMsg];
        } finally {
            setIsLoading(false);
        }
    }, [remainingQuota, selectedModel, activeSessionId, fetchSessions]);

    return (
        <ChatContext.Provider value={{ 
            isOpen, 
            setIsOpen, 
            messages, 
            sendMessage, 
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
        }}>
            {children}
        </ChatContext.Provider>
    );
}

export function useChat() {
    const context = useContext(ChatContext);
    if (!context) throw new Error("useChat must be used within ChatProvider");
    return context;
}
