export const CHAT_ADMIN_EMAILS = new Set([
    "user@gmail.com",
    "weeessd57@gmail.com",
]);

export function isChatAdminEmail(email: string | null | undefined): boolean {
    return Boolean(email && CHAT_ADMIN_EMAILS.has(email.trim().toLowerCase()));
}
