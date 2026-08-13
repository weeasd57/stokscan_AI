import "server-only";

const PLACEHOLDER_VALUES = new Set([
    "your_deepseek_api_key_here",
    "deepseek-no-key",
]);

const UNLIMITED_CHAT_EMAILS = new Set([
    "weeessd57@gmail.com",
    "user@gmail.com",
    "weeasd57@gmail.com",
    "abdallahsaied912@gmail.com",
    "session.flow.test@example.com",
]);

export function getDeepSeekApiKey(): string | null {
    const key = (process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_OFFICIAL_API_KEY)?.trim();
    if (!key || PLACEHOLDER_VALUES.has(key.toLowerCase())) return null;
    return key;
}

export function getNvidiaApiKeys(): string[] {
    return Array.from(new Set([
        process.env.NVIDIA_API_KEY,
        process.env.NVIDIA_SECONDARY_API_KEY,
    ].map(key => key?.trim()).filter((key): key is string => Boolean(key))));
}

export function isUnlimitedChatUser(user: {
    email?: string | null;
    email_confirmed_at?: string | null;
} | null | undefined): boolean {
    const email = user?.email?.trim().toLowerCase();
    return Boolean(email && user?.email_confirmed_at && UNLIMITED_CHAT_EMAILS.has(email));
}
