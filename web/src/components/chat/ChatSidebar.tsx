"use client";

import React, { useState } from "react";
import { Plus, MessageSquare, Trash2, Edit2, Check, X, PanelLeftClose, PanelLeft } from "lucide-react";

export interface ChatSession {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
}

interface ChatSidebarProps {
    sessions: ChatSession[];
    activeSessionId: string | null;
    onSelectSession: (id: string) => void;
    onNewChat: () => void;
    onDeleteSession: (id: string) => void;
    onRenameSession: (id: string, newTitle: string) => void;
    isOpen: boolean;
    onToggle: () => void;
}

export function ChatSidebar({
    sessions,
    activeSessionId,
    onSelectSession,
    onNewChat,
    onDeleteSession,
    onRenameSession,
    isOpen,
    onToggle
}: ChatSidebarProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState("");

    const handleStartRename = (session: ChatSession, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingId(session.id);
        setEditTitle(session.title);
    };

    const handleSaveRename = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (editTitle.trim()) {
            onRenameSession(id, editTitle.trim());
        }
        setEditingId(null);
    };

    if (!isOpen) {
        return (
            <button
                onClick={onToggle}
                className="p-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg transition-colors border border-zinc-300 dark:border-zinc-700 m-2 shadow-sm"
                title="فتح قائمة المحادثات (Sidebar)"
            >
                <PanelLeft className="w-5 h-5" />
            </button>
        );
    }

    return (
        <aside className="w-64 bg-zinc-50 dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 flex flex-col h-full text-right select-none transition-all duration-200">
            {/* Top Header & New Chat Button */}
            <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
                <button
                    onClick={onNewChat}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl transition-all shadow-md active:scale-95"
                >
                    <Plus className="w-4 h-4" />
                    محادثة جديدة
                </button>
                <button
                    onClick={onToggle}
                    className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white rounded-lg transition-colors"
                    title="إغلاق الشريط الجانبي"
                >
                    <PanelLeftClose className="w-5 h-5" />
                </button>
            </div>

            {/* Sessions List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {sessions.length === 0 ? (
                    <div className="text-center text-xs text-zinc-400 dark:text-zinc-500 py-8">
                        لا توجد محادثات سابقة
                    </div>
                ) : (
                    sessions.map((s) => {
                        const isActive = s.id === activeSessionId;
                        const isEditing = editingId === s.id;

                        return (
                            <div
                                key={s.id}
                                onClick={() => onSelectSession(s.id)}
                                className={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-xs font-medium transition-all ${
                                    isActive
                                        ? "bg-amber-500/10 dark:bg-zinc-800 text-amber-700 dark:text-emerald-400 font-bold border border-amber-500/30 dark:border-zinc-700 shadow-sm"
                                        : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-900 hover:text-black dark:hover:text-zinc-200"
                                }`}
                            >
                                <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                                    <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? "text-amber-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"}`} />

                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={editTitle}
                                            onChange={(e) => setEditTitle(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    handleSaveRename(s.id, e as any);
                                                } else if (e.key === "Escape") {
                                                    setEditingId(null);
                                                }
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="bg-white dark:bg-zinc-900 border border-amber-500 dark:border-emerald-500 text-black dark:text-white px-1.5 py-0.5 rounded text-xs w-full outline-none"
                                            autoFocus
                                        />
                                    ) : (
                                        <span className="truncate">{s.title || "محادثة جديدة"}</span>
                                    )}
                                </div>

                                {/* Session Actions */}
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {isEditing ? (
                                        <>
                                            <button
                                                onClick={(e) => handleSaveRename(s.id, e)}
                                                className="p-1 text-emerald-600 dark:text-emerald-400 hover:text-emerald-500"
                                            >
                                                <Check className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingId(null);
                                                }}
                                                className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-white"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                onClick={(e) => handleStartRename(s, e)}
                                                className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-white transition-colors"
                                                title="تعديل الاسم"
                                            >
                                                <Edit2 className="w-3 h-3" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onDeleteSession(s.id);
                                                }}
                                                className="p-1 text-zinc-400 hover:text-rose-500 transition-colors"
                                                title="حذف المحادثة"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </aside>
    );
}
