"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@/contexts/ChatContext";

export default function AIScannerRedirectPage() {
    const router = useRouter();
    const { setIsOpen } = useChat();

    useEffect(() => {
        setIsOpen(true);
        router.replace("/scanner/backtests?chat=open");
    }, [router, setIsOpen]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
            <div className="flex flex-col items-center gap-2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                <p className="text-xs font-black uppercase tracking-widest text-zinc-500">جاري فتح الشات بوت التفاعلي...</p>
            </div>
        </div>
    );
}
