export interface ChatRequestInput {
    message: string;
    history?: Array<{ role: string; content: string }>;
    images?: string[];
    model: string;
    sessionId: string;
    clientMessageId: string;
    chartContext?: unknown;
}
export function createChatRequest(input: ChatRequestInput): { method: string; headers: Record<string, string>; body: string };
