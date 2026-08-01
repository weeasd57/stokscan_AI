import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }) {
    const post = await loadPost(params.slug);
    const title = post?.title || "تحليل من EGX Bots";
    const description = post?.question || "تحليل سوق من EGX Bots";
    return {
        title,
        description,
        openGraph: {
            title,
            description,
            type: "article",
            url: `/blogs/chat/${params.slug}`,
        },
        twitter: { card: "summary", title, description },
    };
}

async function loadPost(slug: string) {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase
        .from("shared_chat_posts")
        .select("slug, question, answer, title, created_at")
        .eq("slug", slug)
        .eq("is_published", true)
        .maybeSingle();
    return data;
}

export default async function SharedChatPage({ params }: { params: { slug: string } }) {
    const post = await loadPost(params.slug);
    if (!post) notFound();

    return (
        <main dir="rtl" className="min-h-screen bg-[#FFE600] px-4 py-10 text-black">
            <article className="mx-auto max-w-4xl border-4 border-black bg-white p-6 shadow-[8px_8px_0_0_#000] sm:p-10">
                <div className="mb-8 border-b-4 border-black pb-5">
                    <p className="mb-3 font-mono text-xs font-black uppercase tracking-widest">EGX Bots Blog</p>
                    <h1 className="text-2xl font-black sm:text-4xl">{post.title}</h1>
                    <p className="mt-3 text-sm text-zinc-600">{new Date(post.created_at).toLocaleDateString("ar-EG")}</p>
                </div>
                <section className="mb-8 border-2 border-black bg-cyan-100 p-4">
                    <h2 className="mb-2 font-black">السؤال</h2>
                    <p className="whitespace-pre-wrap leading-8">{post.question}</p>
                </section>
                <section>
                    <h2 className="mb-3 text-xl font-black">الإجابة</h2>
                    <div className="whitespace-pre-wrap leading-8">{post.answer}</div>
                </section>
                <footer className="mt-10 border-t-4 border-black pt-4 text-xs text-zinc-600">
                    تحليل آلي مبني على البيانات المتاحة من EGX Bots، وليس توصية استثمارية.
                </footer>
            </article>
        </main>
    );
}
