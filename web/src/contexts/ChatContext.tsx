"use client";

import { createContext, useContext, useState, ReactNode, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ChatSession } from "@/components/chat/ChatSidebar";
import { sanitizeReply } from "@/lib/ai/sanitizer";

export type ChatMessage = {
    id?: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    imageUrl?: string;
    imagePreviewUrl?: string;
    images?: string[];
    actions?: ChatAction[];
    suggestedButtons?: string[];
    isStreaming?: boolean;
    statusText?: string;
    tables?: ChatTable[];
};

export type ChatTable = {
    id: string;
    title: string;
    headers: string[];
    rows: string[][];
    source?: string;
    data_time?: string;
};

type ChatAction = {
    label: string;
    type: "navigate" | "function";
    value: string;
};

export const AVAILABLE_AI_MODELS = [
    { id: "deepseek-ai/deepseek-v4-flash", name: "DeepSeek V4 Flash", badgeAr: "تفكير عالي 🧠", badgeEn: "Reasoning 🧠", descAr: "نموذج الاستدلال الفني والمالي والتفكير المعمق", descEn: "Specialized in deep reasoning and financial logic" },
    { id: "deepseek-ai/deepseek-v4-pro", name: "DeepSeek V4 Pro", badgeAr: "العملاق 🔥", badgeEn: "Ultra MoE 🔥", descAr: "نموذج ديب سيك V4 الأحدث بسياق 1M وسرعة تحليل", descEn: "Latest DeepSeek V4 Pro model with 1M context" },
];

interface ChatContextType {
    isOpen: boolean;
    setIsOpen: (v: boolean) => void;
    messages: ChatMessage[];
    sendMessage: (text: string, imageInput?: string | string[]) => Promise<void>;
    stopResponding: () => void;
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

// Local Storage Persistence Helpers
function getStoredSessions(): ChatSession[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem("egxbots_chat_sessions_v2");
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveStoredSessions(sessions: ChatSession[]) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem("egxbots_chat_sessions_v2", JSON.stringify(sessions));
    } catch (e) {
        console.error("Failed to save sessions to localStorage:", e);
    }
}

function getStoredMessages(sessionId: string): ChatMessage[] {
    if (typeof window === "undefined" || !sessionId) return [];
    try {
        const raw = localStorage.getItem(`egxbots_msgs_${sessionId}`);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveStoredMessagesSync(sessionId: string, msgs: ChatMessage[]) {
    if (typeof window === "undefined" || !sessionId) return;
    try {
        // Preserve attached image preview URLs so user uploads persist across page refreshes
        const cleanMsgs = msgs.map(m => ({
            ...m,
            imagePreviewUrl: m.imagePreviewUrl || (m.imageUrl && m.imageUrl !== "[image]" ? m.imageUrl : undefined),
            imageUrl: m.imageUrl,
            images: m.images
        }));
        localStorage.setItem(`egxbots_msgs_${sessionId}`, JSON.stringify(cleanMsgs));
    } catch (e) {
        console.error("Failed to save messages to localStorage:", e);
    }
}

function stripMarkdownTables(text: string): string {
    return text
        .replace(/(?:^|\n)###?[^\n]*\n\|[^\n]+\|\n\|[\s:\-|]+\|(?:\n\|[^\n]+\|)*/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function ChatProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();

    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [remainingQuota, setRemainingQuota] = useState<number>(15);
    const [selectedModel, setSelectedModelState] = useState<string>("deepseek-ai/deepseek-v4-flash");
    const [sessions, setSessionsState] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

    useEffect(() => {
        if (typeof window !== "undefined") {
            setIsSidebarOpen(window.innerWidth >= 768);
        }
    }, []);

    const sessionMessagesCache = useRef<Record<string, ChatMessage[]>>({});
    const loadingSessionIds = useRef<Record<string, boolean>>({});
    const activeSessionIdRef = useRef<string | null>(activeSessionId);
    const abortControllerRef = useRef<AbortController | null>(null);
    const saveTimersRef = useRef<Record<string, NodeJS.Timeout>>({});

    const setActiveSessionId = useCallback((id: string | null) => {
        activeSessionIdRef.current = id;
        setActiveSessionIdState(id);
    }, []);

    // Flush debounced localStorage writes for a given session
    const flushStoredMessages = useCallback((sessionId: string, msgs?: ChatMessage[]) => {
        if (saveTimersRef.current[sessionId]) {
            clearTimeout(saveTimersRef.current[sessionId]);
            delete saveTimersRef.current[sessionId];
        }
        const targetMsgs = msgs || sessionMessagesCache.current[sessionId];
        if (targetMsgs) {
            saveStoredMessagesSync(sessionId, targetMsgs);
        }
    }, []);

    // Debounce localStorage writes (400ms) to prevent synchronous serialization on every stream token
    const debouncedSaveStoredMessages = useCallback((sessionId: string, msgs: ChatMessage[]) => {
        if (saveTimersRef.current[sessionId]) {
            clearTimeout(saveTimersRef.current[sessionId]);
        }
        saveTimersRef.current[sessionId] = setTimeout(() => {
            saveStoredMessagesSync(sessionId, msgs);
            delete saveTimersRef.current[sessionId];
        }, 400);
    }, []);

    // Unified helper to update session messages cache, state (if active), and schedule debounced save
    const setSessionMessages = useCallback((sessionId: string, updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
        const prevMsgs = sessionMessagesCache.current[sessionId] || [];
        const nextMsgs = typeof updater === "function" ? updater(prevMsgs) : updater;

        sessionMessagesCache.current[sessionId] = nextMsgs;

        if (activeSessionIdRef.current === sessionId) {
            setMessages(nextMsgs);
        }

        debouncedSaveStoredMessages(sessionId, nextMsgs);
    }, [debouncedSaveStoredMessages]);

    const stopResponding = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setIsLoading(false);
            loadingSessionIds.current = {};
        }
    }, []);

    const setSessions = useCallback((updater: ChatSession[] | ((prev: ChatSession[]) => ChatSession[])) => {
        setSessionsState(prev => {
            const next = typeof updater === "function" ? updater(prev) : updater;
            saveStoredSessions(next);
            return next;
        });
    }, []);

    // Flush any pending localStorage saves on unmount
    useEffect(() => {
        return () => {
            Object.keys(saveTimersRef.current).forEach(sessionId => {
                if (saveTimersRef.current[sessionId]) {
                    clearTimeout(saveTimersRef.current[sessionId]);
                    const pendingMsgs = sessionMessagesCache.current[sessionId];
                    if (pendingMsgs) {
                        saveStoredMessagesSync(sessionId, pendingMsgs);
                    }
                }
            });
        };
    }, []);

    // Load initial sessions & messages from localStorage on mount
    useEffect(() => {
        const localSessions = getStoredSessions();
        if (localSessions.length > 0) {
            setSessionsState(localSessions);
            const latest = localSessions[0];
            setActiveSessionId(latest.id);
            const localMsgs = getStoredMessages(latest.id);
            if (localMsgs.length > 0) {
                setMessages(localMsgs);
                sessionMessagesCache.current[latest.id] = localMsgs;
            }
        }
    }, [setActiveSessionId]);

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

    const fetchSessionMessages = useCallback(async (sessionId: string) => {
        try {
            const res = await fetch(`/api/ai-chat?session_id=${sessionId}`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.history) && data.history.length > 0) {
                    const existing = sessionMessagesCache.current[sessionId] || getStoredMessages(sessionId);
                    const localImageMap = new Map<number, { imageUrl?: string; imagePreviewUrl?: string; images?: string[] }>();
                    existing.forEach((m, idx) => {
                        if (m.imageUrl || m.imagePreviewUrl || m.images) {
                            localImageMap.set(idx, {
                                imageUrl: m.imageUrl,
                                imagePreviewUrl: m.imagePreviewUrl,
                                images: m.images
                            });
                        }
                    });

                    const mergedHistory: ChatMessage[] = data.history.map((srvMsg: ChatMessage, idx: number) => {
                        const localImg = localImageMap.get(idx);
                        return {
                            ...srvMsg,
                            imagePreviewUrl: srvMsg.imagePreviewUrl || localImg?.imagePreviewUrl || srvMsg.imageUrl || localImg?.imageUrl,
                            imageUrl: srvMsg.imageUrl || localImg?.imageUrl,
                            images: srvMsg.images || localImg?.images
                        };
                    });

                    // If a message is actively streaming in this session, preserve the streaming message at the end
                    if (loadingSessionIds.current[sessionId]) {
                        const streamingMsg = existing.find(m => m.isStreaming);
                        if (streamingMsg && !mergedHistory.some(m => m.id === streamingMsg.id)) {
                            mergedHistory.push(streamingMsg);
                        }
                    }

                    setSessionMessages(sessionId, mergedHistory);
                    flushStoredMessages(sessionId, mergedHistory);
                }
            }
        } catch (e) {
            console.error("Failed to load session messages from server:", e);
        }
    }, [setSessionMessages, flushStoredMessages]);

    const fetchSessions = useCallback(async () => {
        try {
            const res = await fetch("/api/ai-chat?action=sessions");
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.sessions)) {
                    setSessions(prevLocal => {
                        const localMap = new Map(prevLocal.map(s => [s.id, s]));
                        data.sessions.forEach((srvS: ChatSession) => {
                            localMap.set(srvS.id, srvS);
                        });
                        const merged = Array.from(localMap.values());
                        merged.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
                        return merged;
                    });

                    if (!activeSessionIdRef.current && data.sessions.length > 0) {
                        const latestId = data.sessions[0].id;
                        setActiveSessionId(latestId);
                        fetchSessionMessages(latestId);
                    }
                }
                if (data.remaining_quota !== undefined) {
                    setRemainingQuota(data.remaining_quota);
                }
            }
        } catch (e) {
            console.error("Failed to fetch chat sessions:", e);
        }
    }, [setActiveSessionId, setSessions, fetchSessionMessages]);

    // Switch active session instantly while preserving state
    const switchSession = useCallback(async (sessionId: string) => {
        if (activeSessionIdRef.current) {
            flushStoredMessages(activeSessionIdRef.current);
        }

        setActiveSessionId(sessionId);

        const isTargetLoading = !!loadingSessionIds.current[sessionId];
        setIsLoading(isTargetLoading);

        // 1. Memory Cache
        if (sessionMessagesCache.current[sessionId] && sessionMessagesCache.current[sessionId].length > 0) {
            setMessages(sessionMessagesCache.current[sessionId]);
        } else {
            // 2. localStorage
            const localMsgs = getStoredMessages(sessionId);
            if (localMsgs.length > 0) {
                setMessages(localMsgs);
                sessionMessagesCache.current[sessionId] = localMsgs;
            } else {
                setMessages([]);
            }
        }

        // 3. Fetch background sync from server
        await fetchSessionMessages(sessionId);
    }, [setActiveSessionId, flushStoredMessages, fetchSessionMessages]);

    const createNewSession = useCallback(() => {
        if (activeSessionIdRef.current) {
            flushStoredMessages(activeSessionIdRef.current);
        }
        setActiveSessionId(null);
        setMessages([]);
        setIsLoading(false);
    }, [setActiveSessionId, flushStoredMessages]);

    const deleteSession = useCallback(async (sessionId: string) => {
        if (saveTimersRef.current[sessionId]) {
            clearTimeout(saveTimersRef.current[sessionId]);
            delete saveTimersRef.current[sessionId];
        }
        delete sessionMessagesCache.current[sessionId];
        delete loadingSessionIds.current[sessionId];
        if (typeof window !== "undefined") {
            localStorage.removeItem(`egxbots_msgs_${sessionId}`);
        }
        setSessions(prev => prev.filter(s => s.id !== sessionId));

        if (activeSessionIdRef.current === sessionId) {
            createNewSession();
        }

        try {
            await fetch(`/api/ai-chat?session_id=${sessionId}`, { method: "DELETE" });
        } catch (e) {
            console.error("Failed to delete chat session from server:", e);
        }
    }, [createNewSession, setSessions]);

    const renameSession = useCallback(async (sessionId: string, newTitle: string) => {
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s));
        try {
            await fetch("/api/ai-chat", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: sessionId, title: newTitle })
            });
        } catch (e) {
            console.error("Failed to rename session on server:", e);
        }
    }, [setSessions]);

    useEffect(() => {
        fetchSessions();
    }, [user, fetchSessions]);

    const sendMessage = useCallback(async (text: string, imageInput?: string | string[]) => {
        const imagesList: string[] = Array.isArray(imageInput)
            ? imageInput
            : (imageInput ? [imageInput] : []);

        if (!text.trim() && imagesList.length === 0) return;

        let currentSessionId = activeSessionIdRef.current;
        if (!currentSessionId) {
            currentSessionId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "session-" + Date.now();
            setActiveSessionId(currentSessionId);

            const sessionTitle = text.trim()
                ? text.trim().substring(0, 32) + (text.length > 32 ? "..." : "")
                : (imagesList.length > 0 ? "تحليل صورة محفظة" : "محادثة جديدة");

            setSessions(prev => [{
                id: currentSessionId!,
                title: sessionTitle,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, ...prev]);
        }

        const newUserMsg: ChatMessage = {
            role: "user",
            content: text || (imagesList.length > 0 ? `📷 [${imagesList.length} Images attached]` : ""),
            timestamp: Date.now(),
            imageUrl: imagesList[0] || undefined,
            imagePreviewUrl: imagesList[0] || undefined,
            images: imagesList.length > 0 ? imagesList : undefined,
        };

        const existingSessionMsgs = sessionMessagesCache.current[currentSessionId] || [];
        const nextMessages = [...existingSessionMsgs, newUserMsg];

        setSessionMessages(currentSessionId, nextMessages);

        // Mark loading state for this session
        loadingSessionIds.current[currentSessionId] = true;
        if (activeSessionIdRef.current === currentSessionId) {
            setIsLoading(true);
        }

        // Create optimistic assistant message
        const assistantMsgId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "msg-" + Date.now();
        const assistantMsg: ChatMessage = {
            id: assistantMsgId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            isStreaming: true,
            statusText: "جاري تحليل السؤال...",
        };

        const updateAssistantMsgInState = (updatedMsg: ChatMessage) => {
            setSessionMessages(currentSessionId!, prevMsgs => {
                const existingIndex = prevMsgs.findIndex(m => m.id === updatedMsg.id);
                if (existingIndex >= 0) {
                    const updated = [...prevMsgs];
                    updated[existingIndex] = updatedMsg;
                    return updated;
                } else {
                    return [...prevMsgs, updatedMsg];
                }
            });
        };

        // Render initial optimistic assistant message
        updateAssistantMsgInState(assistantMsg);

        try {
            if (remainingQuota <= 0) {
                assistantMsg.content = "وصلت للحد الأقصى اليومي (15 رسالة يومياً). يرجى العودة غداً أو تواصل مع الدعم الفني!";
                assistantMsg.isStreaming = false;
                assistantMsg.statusText = undefined;
                updateAssistantMsgInState(assistantMsg);
                flushStoredMessages(currentSessionId);
                return;
            }

            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            abortControllerRef.current = new AbortController();

            const response = await fetch("/api/ai-chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream, application/json",
                    "x-stream": "true"
                },
                signal: abortControllerRef.current.signal,
                body: JSON.stringify({
                    message: text || "قم بقراءة وتحليل هذه الصورة المرفقة.",
                    history: existingSessionMsgs.map(m => ({ role: m.role, content: m.content })),
                    images: imagesList.length > 0 ? imagesList : undefined,
                    image: imagesList[0] || undefined,
                    model: selectedModel,
                    session_id: currentSessionId,
                    stream: true,
                })
            });

            if (response.status === 429) {
                setRemainingQuota(0);
                let detail = "وصلت للحد الأقصى اليومي (15 رسالة يومياً). يرجى العودة غداً أو تواصل مع الدعم الفني!";
                try {
                    const data = await response.json();
                    if (data.detail && typeof data.detail === "string" && data.detail.includes("Daily limit")) {
                        detail = "وصلت للحد الأقصى اليومي (15 رسالة يومياً). يرجى العودة غداً أو تواصل مع الدعم الفني!";
                    } else if (data.detail) {
                        detail = data.detail;
                    }
                } catch {}
                assistantMsg.content = detail;
                assistantMsg.isStreaming = false;
                assistantMsg.statusText = undefined;
                updateAssistantMsgInState(assistantMsg);
                flushStoredMessages(currentSessionId);
                return;
            }

            if (response.status === 504 || response.status === 502) {
                assistantMsg.content = "استغرقت الاستجابة وقتاً أطول من المعتاد بسبب الضغط على الموديل. يرجى إعادة المحاولة أو اختيار موديل أسرع مثل Llama 3.1 8B ⚡";
                assistantMsg.isStreaming = false;
                assistantMsg.statusText = undefined;
                updateAssistantMsgInState(assistantMsg);
                flushStoredMessages(currentSessionId);
                return;
            }

            if (!response.ok) {
                let errorMsg = "حدث خطأ في السيرفر أثناء معالجة الطلب. يرجى المحاولة مرة أخرى لاحقاً.";
                try {
                    const data = await response.json();
                    if (data.detail) errorMsg = data.detail;
                } catch {}
                assistantMsg.content = errorMsg;
                assistantMsg.isStreaming = false;
                assistantMsg.statusText = undefined;
                updateAssistantMsgInState(assistantMsg);
                flushStoredMessages(currentSessionId);
                return;
            }

            const contentType = response.headers.get("content-type") || "";

            // Fallback for non-streaming JSON responses
            if (contentType.includes("application/json") || !response.body) {
                const data = await response.json();
                if (data.remaining_quota !== undefined) {
                    setRemainingQuota(data.remaining_quota);
                }
                assistantMsg.content = stripMarkdownTables(sanitizeReply(data.reply || "معذرة، لم أتمكن من معالجة هذا الطلب."));
                assistantMsg.tables = Array.isArray(data.tables) ? data.tables : undefined;
                assistantMsg.suggestedButtons = Array.isArray(data.suggested_buttons) ? data.suggested_buttons : undefined;
                assistantMsg.isStreaming = false;
                assistantMsg.statusText = undefined;
                updateAssistantMsgInState(assistantMsg);
                flushStoredMessages(currentSessionId);
                return;
            }

            // SSE ReadableStream reading
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";
            let currentEventName = "";
            let lastRenderTime = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) {
                        currentEventName = "";
                        continue;
                    }

                    if (trimmed.startsWith("event:")) {
                        currentEventName = trimmed.slice(6).trim();
                        continue;
                    }

                    if (trimmed.startsWith("data:")) {
                        const dataStr = trimmed.slice(5).trim();
                        if (dataStr === "[DONE]") {
                            assistantMsg.isStreaming = false;
                            updateAssistantMsgInState(assistantMsg);
                            continue;
                        }

                        try {
                            const parsed = JSON.parse(dataStr);

                            if (parsed.type === "error") {
                                assistantMsg.content = parsed.detail || "حدث خطأ في السيرفر أثناء معالجة الطلب. يرجى المحاولة مرة أخرى لاحقاً.";
                                assistantMsg.isStreaming = false;
                                assistantMsg.statusText = undefined;
                                updateAssistantMsgInState(assistantMsg);
                            } else if (parsed.type === "tables" && Array.isArray(parsed.data)) {
                                assistantMsg.tables = parsed.data;
                                updateAssistantMsgInState(assistantMsg);
                            } else if (currentEventName === "status" || parsed.type === "status" || parsed.event === "status" || parsed.status) {
                                const statusMsg = parsed.status || parsed.message || parsed.content;
                                if (statusMsg) {
                                    assistantMsg.statusText = statusMsg;
                                    updateAssistantMsgInState(assistantMsg);
                                }
                            } else if (currentEventName === "token" || parsed.type === "token" || parsed.event === "token" || parsed.token !== undefined || parsed.delta !== undefined) {
                                 const token = parsed.token ?? parsed.delta ?? parsed.content ?? parsed.text ?? "";
                                 assistantMsg.content = sanitizeReply(assistantMsg.content + token);
                                assistantMsg.isStreaming = true;
                                
                                const now = Date.now();
                                if (now - lastRenderTime > 35) {
                                    lastRenderTime = now;
                                    updateAssistantMsgInState(assistantMsg);
                                }
                            } else if (currentEventName === "done" || parsed.type === "done" || parsed.event === "done") {
                                if (parsed.reply) {
                                    assistantMsg.content = stripMarkdownTables(sanitizeReply(parsed.reply));
                                } else if (assistantMsg.content) {
                                    assistantMsg.content = stripMarkdownTables(sanitizeReply(assistantMsg.content));
                                }
                                if (Array.isArray(parsed.suggested_buttons)) {
                                    assistantMsg.suggestedButtons = parsed.suggested_buttons;
                                }
                                if (Array.isArray(parsed.tables)) assistantMsg.tables = parsed.tables;
                                if (parsed.remaining_quota !== undefined) {
                                    setRemainingQuota(parsed.remaining_quota);
                                }
                                assistantMsg.isStreaming = false;
                                updateAssistantMsgInState(assistantMsg);
                            } else {
                                if (parsed.status) {
                                    assistantMsg.statusText = parsed.status;
                                }
                                if (parsed.token || parsed.delta || parsed.text) {
                                    assistantMsg.content += (parsed.token || parsed.delta || parsed.text);
                                } else if (parsed.reply && !assistantMsg.content) {
                                    assistantMsg.content = parsed.reply;
                                }
                                if (Array.isArray(parsed.suggested_buttons)) {
                                    assistantMsg.suggestedButtons = parsed.suggested_buttons;
                                }
                                if (parsed.remaining_quota !== undefined) {
                                    setRemainingQuota(parsed.remaining_quota);
                                }
                                updateAssistantMsgInState(assistantMsg);
                            }
                        } catch {
                            // Raw string token in data field
                            assistantMsg.content += dataStr;
                            assistantMsg.isStreaming = true;
                            updateAssistantMsgInState(assistantMsg);
                        }
                    }
                }
            }

            // Stream complete
            assistantMsg.isStreaming = false;
            if (!assistantMsg.content && assistantMsg.statusText) {
                assistantMsg.content = assistantMsg.statusText;
            } else {
                assistantMsg.content = stripMarkdownTables(sanitizeReply(assistantMsg.content));
            }
            updateAssistantMsgInState(assistantMsg);
            flushStoredMessages(currentSessionId);

        } catch (err: any) {
            if (err.name === "AbortError" || err.message?.includes("aborted") || err.message === "The user aborted a request.") {
                console.log("Chat request aborted by user");
                if (!assistantMsg.content) {
                    assistantMsg.content = "تم إيقاف الاستجابة بناءً على طلبك.";
                }
            } else if (err.name === "TypeError" && (err.message?.includes("fetch") || err.message?.includes("Failed to fetch") || err.message?.includes("network"))) {
                assistantMsg.content = "تعذر الاتصال بالشبكة. يرجى التحقق من اتصالك بالإنترنت وتجربة المحاولة مرة أخرى.";
            } else {
                assistantMsg.content = err.message || "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي.";
            }
            assistantMsg.isStreaming = false;
            assistantMsg.statusText = undefined;
            updateAssistantMsgInState(assistantMsg);
            flushStoredMessages(currentSessionId);
        } finally {
            abortControllerRef.current = null;
            loadingSessionIds.current[currentSessionId] = false;
            if (activeSessionIdRef.current === currentSessionId) {
                setIsLoading(false);
            }
        }
    }, [remainingQuota, selectedModel, setActiveSessionId, setSessions, setSessionMessages, flushStoredMessages]);

    return (
        <ChatContext.Provider value={{
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
