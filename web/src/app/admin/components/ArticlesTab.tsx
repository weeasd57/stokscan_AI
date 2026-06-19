"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Plus,
    Search,
    RefreshCw,
    Trash2,
    Edit3,
    X,
    Save,
    Check,
    AlertCircle,
    BookOpen
} from "lucide-react";
import { toast } from "sonner";

interface ArticleRow {
    id: string;
    title_en: string;
    title_ar: string;
    excerpt_en: string;
    excerpt_ar: string;
    content_en: string;
    content_ar: string;
    category_en: string;
    category_ar: string;
    author: string;
    image_url: string | null;
    slug: string | null;
    is_published: boolean;
    created_at: string;
    updated_at: string | null;
}

export default function ArticlesTab() {
    const [articles, setArticles] = useState<ArticleRow[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [pageSize] = useState(10);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    const [form, setForm] = useState({
        title_en: "",
        title_ar: "",
        excerpt_en: "",
        excerpt_ar: "",
        content_en: "",
        content_ar: "",
        category_en: "General",
        category_ar: "عام",
        author: "EGX Bots Team",
        image_url: "",
        slug: "",
        is_published: true,
    });

    const [saving, setSaving] = useState(false);

    const fetchArticles = useCallback(async () => {
        setLoading(true);
        try {
            const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY || "";
            const res = await fetch(`/api/admin/articles?page=${page}&page_size=${pageSize}&search=${encodeURIComponent(search)}`, {
                headers: { "X-Admin-Key": adminKey }
            });
            const data = await res.json();
            setArticles(data.articles || []);
            setTotal(data.total || 0);
        } catch (e) {
            toast.error("Failed to load articles");
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, search]);

    useEffect(() => {
        fetchArticles();
    }, [fetchArticles]);

    const handleCreateOpen = () => {
        setForm({
            title_en: "",
            title_ar: "",
            excerpt_en: "",
            excerpt_ar: "",
            content_en: "",
            content_ar: "",
            category_en: "General",
            category_ar: "عام",
            author: "EGX Bots Team",
            image_url: "",
            slug: "",
            is_published: true,
        });
        setIsCreateModalOpen(true);
    };

    const handleEditOpen = (art: ArticleRow) => {
        setEditingId(art.id);
        setForm({
            title_en: art.title_en,
            title_ar: art.title_ar,
            excerpt_en: art.excerpt_en,
            excerpt_ar: art.excerpt_ar,
            content_en: art.content_en,
            content_ar: art.content_ar,
            category_en: art.category_en,
            category_ar: art.category_ar,
            author: art.author,
            image_url: art.image_url || "",
            slug: art.slug || "",
            is_published: art.is_published,
        });
    };

    const saveArticle = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY || "";
            const payload = {
                ...form,
                image_url: form.image_url.trim() || null,
                slug: form.slug.trim() || null,
            };

            let res;
            if (editingId) {
                res = await fetch(`/api/admin/articles/${editingId}`, {
                    method: "PATCH",
                    headers: {
                        "content-type": "application/json",
                        "X-Admin-Key": adminKey
                    },
                    body: JSON.stringify(payload),
                });
            } else {
                res = await fetch("/api/admin/articles", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        "X-Admin-Key": adminKey
                    },
                    body: JSON.stringify(payload),
                });
            }

            if (!res.ok) throw new Error("Save failed");
            toast.success(editingId ? "Article updated successfully" : "Article created successfully");
            setEditingId(null);
            setIsCreateModalOpen(false);
            fetchArticles();
        } catch (e) {
            toast.error("Failed to save article");
        } finally {
            setSaving(false);
        }
    };

    const deleteArticle = async (id: string) => {
        if (!confirm("Are you sure you want to delete this article? This action cannot be undone.")) return;
        try {
            const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY || "";
            const res = await fetch(`/api/admin/articles/${id}`, {
                method: "DELETE",
                headers: { "X-Admin-Key": adminKey }
            });
            if (!res.ok) throw new Error("Delete failed");
            toast.success("Article deleted successfully");
            fetchArticles();
        } catch (e) {
            toast.error("Failed to delete article");
        }
    };

    const totalPages = Math.ceil(total / pageSize);

    return (
        <div className="p-4 md:p-6 space-y-6">
            <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] text-black dark:text-white">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <h2 className="text-xl font-black uppercase tracking-widest flex items-center gap-3">
                        <BookOpen className="w-6 h-6" />
                        ARTICLE MANAGEMENT
                    </h2>
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                                placeholder="Search articles..."
                                className="h-10 pl-9 pr-4 w-60 border-4 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 font-bold text-xs uppercase tracking-wider focus:outline-none"
                            />
                        </div>
                        <button
                            onClick={handleCreateOpen}
                            className="h-10 px-4 border-4 border-black dark:border-white bg-emerald-400 text-black font-black text-xs uppercase tracking-wider hover:bg-emerald-300 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none shadow-[2px_2px_0px_rgba(0,0,0,1)] flex items-center gap-2"
                        >
                            <Plus className="w-4 h-4" />
                            NEW ARTICLE
                        </button>
                        <button
                            onClick={fetchArticles}
                            className="h-10 px-4 border-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white font-black text-xs uppercase tracking-wider hover:bg-zinc-200 dark:hover:bg-zinc-700 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] flex items-center gap-2"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                            REFRESH
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                    </div>
                ) : articles.length === 0 ? (
                    <div className="p-12 text-center border-4 border-dashed border-black/45 dark:border-white/30 text-zinc-500 font-bold uppercase tracking-wider">
                        No articles found
                    </div>
                ) : (
                    <div className="overflow-x-auto border-4 border-black dark:border-white">
                        <table className="w-full text-left font-bold text-xs">
                            <thead className="bg-black dark:bg-zinc-900 text-white uppercase tracking-widest text-[10px] border-b-4 border-black dark:border-white">
                                <tr>
                                    <th className="p-4">Title (EN / AR)</th>
                                    <th className="p-4">Category</th>
                                    <th className="p-4">Author</th>
                                    <th className="p-4 text-center">Status</th>
                                    <th className="p-4 text-center">Created At</th>
                                    <th className="p-4 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y-2 divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-950">
                                {articles.map((art) => (
                                    <tr key={art.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                                        <td className="p-4 max-w-xs">
                                            <div className="font-black text-sm text-black dark:text-white truncate">{art.title_en}</div>
                                            <div className="font-medium text-xs text-zinc-500 truncate mt-0.5">{art.title_ar}</div>
                                        </td>
                                        <td className="p-4">
                                            <span className="px-2.5 py-1 border-2 border-black bg-purple-100 text-purple-700 text-[10px] font-black uppercase tracking-wider">
                                                {art.category_en}
                                            </span>
                                        </td>
                                        <td className="p-4 text-zinc-650 dark:text-zinc-400">{art.author}</td>
                                        <td className="p-4 text-center">
                                            {art.is_published ? (
                                                <span className="px-2.5 py-1 border-2 border-black bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase tracking-wider">
                                                    Published
                                                </span>
                                            ) : (
                                                <span className="px-2.5 py-1 border-2 border-black bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-wider">
                                                    Draft
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-4 text-center font-mono text-[10px] text-zinc-500">
                                            {new Date(art.created_at).toLocaleDateString()}
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => handleEditOpen(art)}
                                                    className="h-8 w-8 border-2 border-black bg-amber-300 text-black flex items-center justify-center shadow-[1px_1px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                                                    title="Edit Article"
                                                >
                                                    <Edit3 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => deleteArticle(art.id)}
                                                    className="h-8 w-8 border-2 border-black bg-red-400 text-black flex items-center justify-center shadow-[1px_1px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                                                    title="Delete Article"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between gap-4 mt-6">
                        <span className="font-mono text-[10px] text-zinc-500 uppercase font-black">
                            Showing page {page + 1} of {totalPages}
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                disabled={page === 0}
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                className="h-9 px-3 border-2 border-black dark:border-white bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 disabled:opacity-40 font-black text-xs uppercase"
                            >
                                Prev
                            </button>
                            <button
                                disabled={page >= totalPages - 1}
                                onClick={() => setPage(p => p + 1)}
                                className="h-9 px-3 border-2 border-black dark:border-white bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 disabled:opacity-40 font-black text-xs uppercase"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Create/Edit Modal */}
            {(isCreateModalOpen || editingId) && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]">
                    <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 text-black dark:text-white max-w-4xl w-full max-h-[90vh] flex flex-col shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)]">
                        <div className="border-b-4 border-black dark:border-white p-4 bg-black dark:bg-zinc-900 text-white flex items-center justify-between">
                            <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2">
                                <BookOpen className="w-5 h-5 text-teal-400" />
                                {editingId ? "Edit Article" : "Create New Article"}
                            </h3>
                            <button
                                onClick={() => { setEditingId(null); setIsCreateModalOpen(false); }}
                                className="p-1 border-2 border-white bg-red-500 hover:bg-red-600 text-white"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <form onSubmit={saveArticle} className="p-6 overflow-y-auto flex-1 space-y-6">
                            {/* Title fields */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-1 block">Title (English)</label>
                                    <input
                                        type="text"
                                        required
                                        value={form.title_en}
                                        onChange={(e) => setForm(f => ({ ...f, title_en: e.target.value }))}
                                        className="w-full h-10 px-3 border-4 border-black bg-zinc-50 dark:bg-zinc-900 font-bold text-sm text-black dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-1 block">Title (Arabic)</label>
                                    <input
                                        type="text"
                                        required
                                        dir="rtl"
                                        value={form.title_ar}
                                        onChange={(e) => setForm(f => ({ ...f, title_ar: e.target.value }))}
                                        className="w-full h-10 px-3 border-4 border-black bg-zinc-50 dark:bg-zinc-900 font-bold text-sm text-black dark:text-white"
                                    />
                                </div>
                            </div>

                            {/* Category, Author, Cover image */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-1 block">Category (English)</label>
                                    <input
                                        type="text"
                                        value={form.category_en}
                                        onChange={(e) => setForm(f => ({ ...f, category_en: e.target.value }))}
                                        className="w-full h-10 px-3 border-4 border-black bg-zinc-50 dark:bg-zinc-900 font-bold text-xs text-black dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-1 block">Category (Arabic)</label>
                                    <input
                                        type="text"
                                        dir="rtl"
                                        value={form.category_ar}
                                        onChange={(e) => setForm(f => ({ ...f, category_ar: e.target.value }))}
                                        className="w-full h-10 px-3 border-4 border-black bg-zinc-50 dark:bg-zinc-900 font-bold text-xs text-black dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-1 block">Author</label>
                                    <input
                                        type="text"
                                        value={form.author}
                                        onChange={(e) => setForm(f => ({ ...f, author: e.target.value }))}
                                        className="w-full h-10 px-3 border-4 border-black bg-zinc-50 dark:bg-zinc-900 font-bold text-xs text-black dark:text-white"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-1 block">Slug (Optional - auto generated if empty)</label>
                                    <input
                                        type="text"
                                        value={form.slug}
                                        onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))}
                                        placeholder="e.g. machine-learning-trading-bias"
                                        className="w-full h-10 px-3 border-4 border-black bg-zinc-50 dark:bg-zinc-900 font-bold text-xs text-black dark:text-white font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-1 block">Cover Image URL (Optional)</label>
                                    <input
                                        type="text"
                                        value={form.image_url}
                                        onChange={(e) => setForm(f => ({ ...f, image_url: e.target.value }))}
                                        placeholder="https://example.com/cover.png"
                                        className="w-full h-10 px-3 border-4 border-black bg-zinc-50 dark:bg-zinc-900 font-bold text-xs text-black dark:text-white"
                                    />
                                </div>
                            </div>

                            {/* Excerpts */}
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-1 block">Excerpt Summary (English)</label>
                                <textarea
                                    required
                                    rows={2}
                                    value={form.excerpt_en}
                                    onChange={(e) => setForm(f => ({ ...f, excerpt_en: e.target.value }))}
                                    className="w-full p-3 border-4 border-black bg-zinc-50 dark:bg-zinc-900 font-bold text-xs text-black dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-1 block">Excerpt Summary (Arabic)</label>
                                <textarea
                                    required
                                    rows={2}
                                    dir="rtl"
                                    value={form.excerpt_ar}
                                    onChange={(e) => setForm(f => ({ ...f, excerpt_ar: e.target.value }))}
                                    className="w-full p-3 border-4 border-black bg-zinc-50 dark:bg-zinc-900 font-bold text-xs text-black dark:text-white"
                                />
                            </div>

                            {/* Full Content */}
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-1 block">Full Content (English - HTML supported)</label>
                                <textarea
                                    required
                                    rows={8}
                                    value={form.content_en}
                                    onChange={(e) => setForm(f => ({ ...f, content_en: e.target.value }))}
                                    placeholder="<p>Write content here...</p><h3>Subheading</h3>"
                                    className="w-full p-3 border-4 border-black bg-zinc-50 dark:bg-zinc-900 font-medium text-sm text-black dark:text-white font-mono"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-1 block">Full Content (Arabic - HTML supported)</label>
                                <textarea
                                    required
                                    rows={8}
                                    dir="rtl"
                                    value={form.content_ar}
                                    onChange={(e) => setForm(f => ({ ...f, content_ar: e.target.value }))}
                                    placeholder="<p>اكتب المحتوى هنا...</p><h3>عنوان فرعي</h3>"
                                    className="w-full p-3 border-4 border-black bg-zinc-50 dark:bg-zinc-900 font-medium text-sm text-black dark:text-white font-mono"
                                />
                            </div>

                            {/* Status */}
                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="is_published"
                                    checked={form.is_published}
                                    onChange={(e) => setForm(f => ({ ...f, is_published: e.target.checked }))}
                                    className="w-5 h-5 border-4 border-black bg-zinc-50 accent-black cursor-pointer"
                                />
                                <label htmlFor="is_published" className="text-xs font-black uppercase tracking-wider cursor-pointer">
                                    Publish immediately (Visible on website)
                                </label>
                            </div>

                            {/* Save Button */}
                            <button
                                type="submit"
                                disabled={saving}
                                className="h-12 w-full neobrutal-btn neobrutal-bg-yellow font-black text-xs uppercase tracking-widest text-black flex items-center justify-center gap-2 relative overflow-hidden group"
                            >
                                {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                SAVE ARTICLE
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

interface Loader2Props {
    className?: string;
}

function Loader2({ className }: Loader2Props) {
    return <RefreshCw className={`animate-spin ${className}`} />;
}
