"use client";

import React, { useState } from "react";
import { Plus, MessageSquare, Trash2, Edit2, Check, X, PanelLeftClose, PanelLeft, Sparkles } from "lucide-react";

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
                className="hidden md:flex items-center gap-1.5 p-2 bg-[#FFE600] text-black font-black border-2 border-black shadow-[3px_3px_0_0_#000] dark:shadow-[3px_3px_0_0_#fff] hover:bg-amber-400 transition-all m-2 shrink-0 self-start text-xs uppercase cursor-pointer active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                title="فتح سجل المحادثات (Sidebar)"
            >
                <PanelLeft className="w-4 h-4 stroke-[2.5]" />
                <span className="text-[11px]">المحادثات</span>
            </button>
        );
    }

    return (
        <>
            {isOpen && (
                <div 
                    onClick={onToggle}
                    className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 md:hidden"
                />
            )}
            <aside className={`
                border-l-4 border-black dark:border-white flex flex-col h-full text-right select-none transition-all duration-200
                bg-[#fcfbfa] dark:bg-[#0c0d10] text-black dark:text-white
                max-md:fixed max-md:top-0 max-md:bottom-0 max-md:right-0 max-md:z-50 max-md:w-[280px] max-md:max-w-[85vw] max-md:shadow-[-6px_0_0_0_#000] dark:max-md:shadow-[-6px_0_0_0_#fff]
                md:relative md:w-64 md:z-auto shrink-0
            `}>
                {/* Top Header & New Chat Button */}
                <div className="p-3 border-b-4 border-black dark:border-white bg-[#FFE600] text-black flex items-center justify-between gap-2 shrink-0 shadow-[0_2px_0_0_#000]">
                    <button
                        onClick={() => {
                            onNewChat();
                            if (typeof window !== "undefined" && window.innerWidth < 768) {
                                onToggle();
                            }
                        }}
                        className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-emerald-400 hover:bg-emerald-300 text-black font-black text-xs uppercase rounded-none border-2 border-black shadow-[2.5px_2.5px_0_0_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all cursor-pointer"
                    >
                        <Plus className="w-4 h-4 stroke-[3]" />
                        <span>محادثة جديدة</span>
                    </button>
                    <button
                        onClick={onToggle}
                        className="p-1.5 bg-white dark:bg-zinc-900 border-2 border-black text-black dark:text-white hover:bg-amber-400 dark:hover:bg-amber-500 dark:hover:text-black shadow-[2px_2px_0_0_#000] dark:shadow-[2px_2px_0_0_#fff] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all cursor-pointer"
                        title="إغلاق القائمة"
                    >
                        <PanelLeftClose className="w-4 h-4 stroke-[2.5]" />
                    </button>
                </div>

                {/* Sub-header title */}
                <div className="px-3 py-2 border-b-2 border-black/20 dark:border-white/20 bg-amber-500/10 dark:bg-amber-500/5 flex items-center justify-between text-[11px] font-black uppercase text-zinc-700 dark:text-zinc-300">
                    <span className="flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                        سجل المحادثات
                    </span>
                    <span className="px-1.5 py-0.2 bg-black text-white dark:bg-white dark:text-black font-mono text-[10px]">
                        {sessions.length}
                    </span>
                </div>

                {/* Sessions List */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                    {sessions.length === 0 ? (
                        <div className="my-4 p-4 border-2 border-dashed border-black/30 dark:border-white/30 bg-amber-500/5 dark:bg-zinc-900/50 text-center flex flex-col items-center justify-center gap-2">
                            <div className="h-10 w-10 border-2 border-black dark:border-white bg-[#FFE600] flex items-center justify-center shadow-[2px_2px_0_0_#000] dark:shadow-[2px_2px_0_0_#fff] my-1">
                                <MessageSquare className="w-5 h-5 text-black stroke-[2.5]" />
                            </div>
                            <span className="font-black text-xs text-black dark:text-white">
                                لا توجد محادثات سابقة
                            </span>
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold leading-relaxed">
                                اضغط على زر "محادثة جديدة" للبدء في استفسار جديد.
                            </p>
                            <button
                                onClick={onNewChat}
                                className="mt-2 py-1.5 px-3 bg-emerald-400 hover:bg-emerald-300 text-black font-black text-[11px] border-2 border-black shadow-[2px_2px_0_0_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all cursor-pointer"
                            >
                                + بدء محادثة
                            </button>
                        </div>
                    ) : (
                        sessions.map((s) => {
                            const isActive = s.id === activeSessionId;
                            const isEditing = editingId === s.id;

                            return (
                                <div
                                    key={s.id}
                                    onClick={() => {
                                        onSelectSession(s.id);
                                        if (typeof window !== "undefined" && window.innerWidth < 768) {
                                            onToggle();
                                        }
                                    }}
                                    className={`group flex items-center justify-between p-2.5 rounded-none cursor-pointer text-xs font-bold transition-all border-2 border-black ${
                                        isActive
                                            ? "bg-[#FFE600] text-black shadow-[3px_3px_0_0_#000] dark:shadow-[3px_3px_0_0_#fff]"
                                            : "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-[2px_2px_0_0_#000] dark:shadow-[2px_2px_0_0_rgba(255,255,255,0.2)] hover:bg-amber-100 dark:hover:bg-zinc-800"
                                    }`}
                                >
                                    <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                                        <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 stroke-[2.5] ${isActive ? "text-black" : "text-amber-600 dark:text-amber-400"}`} />

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
                                                className="bg-white text-black border-2 border-black px-1.5 py-0.5 text-xs font-black w-full outline-none shadow-[2px_2px_0_0_#000]"
                                                autoFocus
                                            />
                                        ) : (
                                            <span className="truncate">{s.title || "محادثة جديدة"}</span>
                                        )}
                                    </div>

                                    {/* Session Actions */}
                                    <div className="flex items-center gap-1 opacity-90 group-hover:opacity-100 transition-opacity">
                                        {isEditing ? (
                                            <>
                                                <button
                                                    onClick={(e) => handleSaveRename(s.id, e)}
                                                    className="p-1 bg-emerald-400 border border-black text-black shadow-[1px_1px_0_0_#000] hover:bg-emerald-300"
                                                    title="حفظ"
                                                >
                                                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingId(null);
                                                    }}
                                                    className="p-1 bg-white border border-black text-black shadow-[1px_1px_0_0_#000] hover:bg-rose-400"
                                                    title="إلغاء"
                                                >
                                                    <X className="w-3.5 h-3.5 stroke-[3]" />
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={(e) => handleStartRename(s, e)}
                                                    className="p-1 bg-white dark:bg-zinc-800 border border-black dark:border-zinc-600 text-black dark:text-white shadow-[1px_1px_0_0_#000] dark:shadow-[1px_1px_0_0_#fff] hover:bg-amber-300 dark:hover:bg-amber-500 transition-colors"
                                                    title="تعديل الاسم"
                                                >
                                                    <Edit2 className="w-3 h-3 stroke-[2.5]" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onDeleteSession(s.id);
                                                    }}
                                                    className="p-1 bg-white dark:bg-zinc-800 border border-black dark:border-zinc-600 text-black dark:text-white shadow-[1px_1px_0_0_#000] dark:shadow-[1px_1px_0_0_#fff] hover:bg-rose-500 hover:text-white transition-colors"
                                                    title="حذف المحادثة"
                                                >
                                                    <Trash2 className="w-3 h-3 stroke-[2.5]" />
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
        </>
    );
}

