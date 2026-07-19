"use client";

import { useState, useEffect } from "react";
import { Loader2, Save, Sparkles, MessageSquare, KeyRound, Link as LinkIcon, Settings2, User, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import SupportTab from "./SupportTab";

export default function AIChatbotTab() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [logsLoading, setLogsLoading] = useState(true);
    
    const [settings, setSettings] = useState({
        api_url: "https://api.agentrouter.org/v1",
        api_key: "",
        model: "claude-opus-4-6",
        system_prompt: ""
    });

    const [logs, setLogs] = useState<any[]>([]);
    const [viewMode, setViewMode] = useState<"ai_config" | "support_chats">("support_chats");

    useEffect(() => {
        fetchSettings();
        fetchLogs();
    }, []);

    const fetchSettings = async () => {
        try {
            const res = await fetch("/api/admin/ai-chatbot");
            if (res.ok) {
                const data = await res.json();
                if (data.api_url) {
                    setSettings({
                        api_url: data.api_url || "https://api.agentrouter.org/v1",
                        api_key: data.api_key || "",
                        model: data.model || "claude-opus-4-6",
                        system_prompt: data.system_prompt || ""
                    });
                }
            }
        } catch (e) {
            console.error("Failed to load AI settings");
        } finally {
            setLoading(false);
        }
    };

    const fetchLogs = async () => {
        setLogsLoading(true);
        try {
            const res = await fetch("/api/admin/ai-chatbot/logs");
            if (res.ok) {
                const data = await res.json();
                setLogs(data);
            }
        } catch (e) {
            console.error("Failed to load logs");
        } finally {
            setLogsLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch("/api/admin/ai-chatbot", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(settings)
            });
            if (res.ok) {
                toast.success("AI settings saved successfully!");
            } else {
                toast.error("Failed to save AI settings");
            }
        } catch (e) {
            toast.error("An error occurred");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
            </div>
        );
    }

    return (
        <div className="max-w-[1920px] mx-auto px-4 md:px-8 py-8 space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-black uppercase tracking-tight text-black dark:text-white flex items-center gap-3">
                        <Sparkles className="w-8 h-8 text-indigo-500" />
                        AI Chatbot Control
                    </h2>
                    <p className="text-zinc-500 font-medium mt-1">Configure AgentRouter rules and monitor user interactions.</p>
                </div>
                {viewMode === "ai_config" && (
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-3 font-bold uppercase tracking-widest text-sm transition-all disabled:opacity-50 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:hover:shadow-[2px_2px_0px_rgba(255,255,255,1)]"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Config
                    </button>
                )}
            </div>

            {/* Sub-navigation */}
            <div className="flex items-center gap-4 border-b-2 border-black dark:border-zinc-800 pb-px">
                <button
                    onClick={() => setViewMode("support_chats")}
                    className={`flex items-center gap-2 px-6 py-3 font-bold text-sm tracking-wider uppercase transition-colors relative ${viewMode === "support_chats" ? "text-amber-600 dark:text-amber-500" : "text-zinc-500 hover:text-black dark:hover:text-white"}`}
                >
                    <MessageSquare className="w-4 h-4" />
                    Human Support Chats
                    {viewMode === "support_chats" && <div className="absolute bottom-0 left-0 w-full h-1 bg-amber-500 translate-y-px"></div>}
                </button>
                <button
                    onClick={() => setViewMode("ai_config")}
                    className={`flex items-center gap-2 px-6 py-3 font-bold text-sm tracking-wider uppercase transition-colors relative ${viewMode === "ai_config" ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-500 hover:text-black dark:hover:text-white"}`}
                >
                    <Sparkles className="w-4 h-4" />
                    AI Config & Logs
                    {viewMode === "ai_config" && <div className="absolute bottom-0 left-0 w-full h-1 bg-indigo-500 translate-y-px"></div>}
                </button>
            </div>

            {viewMode === "support_chats" ? (
                <div className="-mx-4 md:mx-0">
                    <SupportTab />
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Settings Column */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-white dark:bg-zinc-900 border-4 border-black dark:border-white p-6 shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_rgba(255,255,255,1)]">
                            <h3 className="text-lg font-bold uppercase flex items-center gap-2 mb-6 border-b-2 border-zinc-200 dark:border-zinc-800 pb-4">
                                <Settings2 className="w-5 h-5 text-indigo-500" />
                                Provider Config
                            </h3>

                            <div className="space-y-5">
                                <div>
                                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-2">
                                        <LinkIcon className="w-4 h-4" /> Base URL
                                    </label>
                                    <input
                                        type="text"
                                        value={settings.api_url}
                                        onChange={(e) => setSettings({ ...settings, api_url: e.target.value })}
                                        className="w-full bg-zinc-100 dark:bg-zinc-950 text-black dark:text-white border-2 border-black dark:border-zinc-700 px-4 py-3 font-mono text-sm focus:border-indigo-500 focus:outline-none transition-colors"
                                        placeholder="https://api.agentrouter.org/v1"
                                    />
                                </div>

                                <div>
                                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-2">
                                        <KeyRound className="w-4 h-4" /> API Key
                                    </label>
                                    <input
                                        type="password"
                                        value={settings.api_key}
                                        onChange={(e) => setSettings({ ...settings, api_key: e.target.value })}
                                        className="w-full bg-zinc-100 dark:bg-zinc-950 text-black dark:text-white border-2 border-black dark:border-zinc-700 px-4 py-3 font-mono text-sm focus:border-indigo-500 focus:outline-none transition-colors"
                                        placeholder="sk-..."
                                    />
                                </div>

                                <div>
                                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-2">
                                        <Sparkles className="w-4 h-4" /> AI Model
                                    </label>
                                    <select
                                        value={settings.model}
                                        onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                                        className="w-full bg-zinc-100 dark:bg-zinc-950 text-black dark:text-white border-2 border-black dark:border-zinc-700 px-4 py-3 font-mono text-sm focus:border-indigo-500 focus:outline-none transition-colors appearance-none cursor-pointer"
                                    >
                                        <optgroup label="Anthropic">
                                            <option value="claude-3-5-sonnet-20240620">Claude 3.5 Sonnet</option>
                                            <option value="claude-3-opus-20240229">Claude 3 Opus</option>
                                            <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
                                        </optgroup>
                                        <optgroup label="OpenAI">
                                            <option value="gpt-4o">GPT-4o</option>
                                            <option value="gpt-4o-mini">GPT-4o Mini</option>
                                            <option value="gpt-4-turbo">GPT-4 Turbo</option>
                                        </optgroup>
                                        <optgroup label="Google">
                                            <option value="gemini-1.5-pro-latest">Gemini 1.5 Pro</option>
                                            <option value="gemini-1.5-flash-latest">Gemini 1.5 Flash</option>
                                        </optgroup>
                                        <optgroup label="Meta / Open Source">
                                            <option value="llama-3-70b-instruct">Llama 3 (70B)</option>
                                            <option value="mixtral-8x7b-instruct">Mixtral 8x7B</option>
                                        </optgroup>
                                        <optgroup label="Other">
                                            <option value={settings.model}>{settings.model}</option>
                                        </optgroup>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-zinc-900 border-4 border-black dark:border-white p-6 shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_rgba(255,255,255,1)]">
                            <h3 className="text-lg font-bold uppercase flex items-center gap-2 mb-6 border-b-2 border-zinc-200 dark:border-zinc-800 pb-4">
                                <MessageSquare className="w-5 h-5 text-indigo-500" />
                                System Rules (Prompt)
                            </h3>

                            <div>
                                <textarea
                                    value={settings.system_prompt}
                                    onChange={(e) => setSettings({ ...settings, system_prompt: e.target.value })}
                                    className="w-full h-64 bg-zinc-100 dark:bg-zinc-950 text-black dark:text-white border-2 border-black dark:border-zinc-700 px-4 py-3 font-mono text-sm focus:border-indigo-500 focus:outline-none transition-colors resize-none"
                                    placeholder="You are a helpful AI assistant for the users of this platform..."
                                />
                            </div>
                        </div>
                    </div>

                    {/* Logs Column */}
                    <div className="lg:col-span-2">
                        <div className="bg-white dark:bg-zinc-900 border-4 border-black dark:border-white h-full shadow-[8px_8px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_rgba(255,255,255,1)] flex flex-col">
                            <div className="p-6 border-b-2 border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                                <h3 className="text-lg font-bold uppercase flex items-center gap-2">
                                    <User className="w-5 h-5 text-indigo-500" />
                                    Recent User Interactions
                                </h3>
                                <button
                                    onClick={fetchLogs}
                                    disabled={logsLoading}
                                    className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
                                >
                                    <RefreshCw className={`w-5 h-5 text-zinc-500 ${logsLoading ? "animate-spin" : ""}`} />
                                </button>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto p-0 min-h-[500px] max-h-[800px]">
                                {logsLoading && logs.length === 0 ? (
                                    <div className="flex items-center justify-center h-full">
                                        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
                                    </div>
                                ) : logs.length === 0 ? (
                                    <div className="flex items-center justify-center h-full text-zinc-500 font-medium">
                                        No interactions recorded yet.
                                    </div>
                                ) : (
                                    <table className="w-full text-left border-collapse">
                                        <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800 z-10 border-b-2 border-black dark:border-white">
                                            <tr>
                                                <th className="py-3 px-4 text-xs font-black uppercase tracking-wider text-zinc-500 w-[150px]">Time</th>
                                                <th className="py-3 px-4 text-xs font-black uppercase tracking-wider text-zinc-500 w-[150px]">User</th>
                                                <th className="py-3 px-4 text-xs font-black uppercase tracking-wider text-zinc-500">Interaction</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                                            {logs.map((log) => (
                                                <tr key={log.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                                                    <td className="py-4 px-4 text-xs text-zinc-500 align-top">
                                                        {new Date(log.created_at).toLocaleString()}
                                                    </td>
                                                    <td className="py-4 px-4 align-top">
                                                        <div className="font-bold text-sm text-black dark:text-white">
                                                            {log.user_name}
                                                        </div>
                                                        {log.telegram_chat_id && (
                                                            <div className="text-[10px] text-blue-500 mt-1 uppercase tracking-wider flex items-center gap-1">
                                                                <LinkIcon className="w-3 h-3" /> Linked
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="py-4 px-4 align-top space-y-3">
                                                        <div className="bg-zinc-100 dark:bg-zinc-950 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
                                                            <span className="text-xs font-bold text-zinc-500 mb-1 block uppercase tracking-wider">User:</span>
                                                            <p className="text-sm text-black dark:text-zinc-300">{log.message}</p>
                                                        </div>
                                                        <div className="bg-indigo-50 dark:bg-indigo-950/20 p-3 rounded-lg border border-indigo-100 dark:border-indigo-900/30">
                                                            <span className="text-xs font-bold text-indigo-500 mb-1 block uppercase tracking-wider flex items-center gap-1">
                                                                <Sparkles className="w-3 h-3" /> Bot:
                                                            </span>
                                                            <p className="text-sm text-black dark:text-zinc-300 whitespace-pre-wrap">{log.reply}</p>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
