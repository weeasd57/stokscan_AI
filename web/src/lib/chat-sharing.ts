export function isChatAdminEmail(email: string | null | undefined): boolean {
    if (!email) return false;
    // Keep the existing administrator accounts working when the deployment
    // does not define ADMIN_EMAILS. Environment values can extend this list.
    const configured = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.ADMIN_EMAILS || "")
        .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    const adminEmails = new Set([
        "weeeessd57@gmail.com",
        ...configured,
    ]);
    return adminEmails.has(email.trim().toLowerCase());
}
