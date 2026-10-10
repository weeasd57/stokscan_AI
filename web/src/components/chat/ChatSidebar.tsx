"use client";

import React, { useState } from "react";
import { Plus, MessageSquare, Trash2, Edit2, Check, X, PanelLeftClose, Sparkles } from "lucide-react";

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

    if (!isOpen) return null;

    return (
        <>
            {isOpen && (
                <div
                    onClick={onToggle}
                    className="fixed inset-0 bg-slate-950/55 backdrop-blur-sm z-40 md:hidden"
                    aria-hidden="true"
                />
            )}
            <aside aria-label="سجل المحادثات" className={`
                flex h-full min-h-0 shrink-0 flex-col select-none text-right text-slate-900 transition-all duration-200 dark:text-slate-100
                rounded-none border-0 bg-[#fffdf2] shadow-[-18px_0_45px_rgba(2,6,23,0.22)]
                max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-50 max-md:w-[290px] max-md:max-w-[88vw] max-md:pt-[env(safe-area-inset-top,0px)] max-md:pb-[env(safe-area-inset-bottom,0px)]
                dark:bg-[#09090b]
                md:relative md:w-[250px] md:rounded-[22px] md:border md:border-slate-200/80 md:bg-[#fffdf2] md:shadow-[0_18px_55px_rgba(2,6,23,0.16)] dark:md:border-white/10 dark:md:bg-[#09090b] dark:md:shadow-[0_22px_60px_rgba(0,0,0,0.34)] md:z-auto
            `}>
                {/* Top Header & New Chat Button */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 p-3 dark:border-white/10">
                    <button
                        onClick={() => {
                            onNewChat();
                            if (typeof window !== "undefined" && window.innerWidth < 768) {
                                onToggle();
                            }
                        }}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-300 via-yellow-200 to-sky-200 px-3 py-2.5 text-xs font-extrabold text-slate-900 shadow-sm transition hover:brightness-[1.03] active:scale-[0.98]"
                        aria-label="محادثة جديدة"
                    >
                        <Plus className="h-4 w-4" />
                        <span>محادثة جديدة</span>
                    </button>
                    <button
                        onClick={onToggle}
                        className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 active:scale-95 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                        title="إغلاق سجل المحادثات"
                        aria-label="إغلاق سجل المحادثات"
                    >
                        <PanelLeftClose className="h-[18px] w-[18px]" />
                    </button>
                </div>

                {/* Sub-header title */}
                <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-3 text-[11px] font-bold uppercase text-slate-500 dark:border-white/10 dark:text-slate-400">
                    <span className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                        سجل المحادثات
                    </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {sessions.length}
                    </span>
                </div>

                {/* Sessions List */}
                <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto p-3">
                    {sessions.length === 0 ? (
                            <div className="my-4 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-4 text-center dark:border-white/15 dark:bg-slate-900/50">
                            <div className="my-1 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-amber-200 to-sky-200 text-slate-700 dark:text-slate-900">
                                <MessageSquare className="h-5 w-5" />
                            </div>
                            <span className="font-black text-xs text-black dark:text-white">
                                لا توجد محادثات سابقة
                            </span>
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold leading-relaxed">
                                اضغط على زر "محادثة جديدة" للبدء في استفسار جديد.
                            </p>
                                <button
                                onClick={onNewChat}
                                className="mt-2 rounded-lg bg-gradient-to-r from-amber-300 to-sky-200 px-3 py-1.5 text-[11px] font-extrabold text-slate-900 shadow-sm transition hover:brightness-[1.03] active:scale-[0.98]"
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
                                    className={`group flex items-center justify-between rounded-xl border p-2.5 text-xs font-semibold transition-all ${
                                        isActive
                                            ? "border-sky-300 bg-sky-50 text-slate-900 shadow-sm dark:border-sky-400/40 dark:bg-sky-950/40 dark:text-white"
                                            : "border-slate-200 bg-white/75 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-slate-900/65 dark:text-slate-200 dark:hover:bg-slate-800"
                                    }`}
                                >
                                    <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                                        <MessageSquare className={`h-3.5 w-3.5 flex-shrink-0 ${isActive ? "text-sky-700 dark:text-sky-300" : "text-slate-400"}`} />

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

