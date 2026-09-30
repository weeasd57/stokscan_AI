"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import NotFound from "../not-found";
import { isAllowedAdminEmail, isLocalhost } from "@/lib/admin-auth-client";

export default function AdminAuthGuard({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // While determining auth or environment
    if (loading || !mounted) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
            </div>
        );
    }

    const isLocal = isLocalhost();
    const isAllowed = isLocal || (user && isAllowedAdminEmail(user.email));

    // If not allowed, log unauthorized attempt silently and show 404 Not Found
    if (!isAllowed) {
        if (typeof window !== "undefined") {
            const hasLogged = sessionStorage.getItem("admin_blocked_logged");
            if (!hasLogged) {
                sessionStorage.setItem("admin_blocked_logged", "1");
                fetch("/api/admin-access-log", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        eventType: "unauthorized_attempt",
                        userEmail: user?.email || "anonymous_visitor",
                        userId: user?.id || null,
                    }),
                }).catch(() => {});
            }
        }

        // Render 404 page directly so /admin appears non-existent to outsiders
        return <NotFound />;
    }

    return <>{children}</>;
}
