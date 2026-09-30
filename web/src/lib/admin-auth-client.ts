/**
 * Client-safe admin authorization helpers (no server-only dependencies).
 */

const ALLOWED_ADMIN_HANDLES = ["weeeessd57", "weeessd57", "weeasd57", "weeeenew"];

export function isAllowedAdminEmail(email?: string | null): boolean {
    if (!email) return false;
    const clean = email.toLowerCase().trim();

    // Check configured environment list if available
    const configured = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

    if (configured.includes(clean)) return true;

    // Check specific known emails
    const explicitAdmins = [
        "weeeessd57@gmail.com",
        "weeessd57@gmail.com",
        "weeasd57@gmail.com",
        "weeeenew@gmail.com",
    ];
    if (explicitAdmins.includes(clean)) return true;

    // Check handle match
    return ALLOWED_ADMIN_HANDLES.some((handle) => clean.includes(handle));
}

export function isLocalhost(): boolean {
    if (typeof window === "undefined") return false;
    const host = window.location.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
}
