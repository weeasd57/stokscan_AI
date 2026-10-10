import { createHash } from "node:crypto";
import { isChatAdminEmail } from "@/lib/chat-sharing";
import { isAllowedAdminEmail } from "@/lib/admin-auth-client";

export function canTraceChat(user: any): boolean {
    return Boolean(user?.id && (user.app_metadata?.role === "admin" || isChatAdminEmail(user.email) || isAllowedAdminEmail(user.email)));
}

/** Passive, per-request capture. Headers, keys, cookies and binary images are never captured. */
export function createDiagnosticTrace(enabled: boolean, limit = 256_000) {
    const entries: Array<{ type: string; captured_at: string; data: any; sha256: string }> = [];
    let chars = 0, truncated = false;
    const capture = (type: string, data: any) => {
        if (!enabled) return;
        try {
            const serialized = JSON.stringify(data);
            if (chars + serialized.length > limit) { truncated = true; return; }
            chars += serialized.length;
            entries.push({ type, captured_at: new Date().toISOString(), data: JSON.parse(serialized),
                sha256: createHash("sha256").update(serialized).digest("hex") });
        } catch { truncated = true; }
    };
    return { capture, snapshot: () => enabled ? { version: 1, complete: !truncated, characters: chars,
        deployment_sha: process.env.VERCEL_GIT_COMMIT_SHA || null, environment: process.env.VERCEL_ENV || "local",
        entries: entries.map(entry => ({ ...entry })) } : null };
}
