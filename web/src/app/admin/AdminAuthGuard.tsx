"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

export default function AdminAuthGuard({ children }: { children: React.ReactNode }) {
    const { session, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && !session) {
            router.push("/login");
        }
    }, [session, loading, router]);

    if (loading) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
            </div>
        );
    }

    if (!session) {
        return null;
    }

    return <>{children}</>;
}
