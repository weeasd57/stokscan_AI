export function isChatAdminEmail(email: string | null | undefined): boolean {
    if (!email) return false;
    const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    return adminEmails.includes(email.trim().toLowerCase());
}
