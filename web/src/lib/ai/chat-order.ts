/** Stable ordering for persisted and optimistic chat history. */
export interface OrderedChatMessage {
    role: string;
    timestamp: number;
}

export function createChatMessageTimestamps(requestStartedAt: number, responseFinishedAt = Date.now()) {
    return {
        user: new Date(requestStartedAt).toISOString(),
        assistant: new Date(Math.max(responseFinishedAt, requestStartedAt + 1)).toISOString(),
    };
}

const ROLE_ORDER: Record<string, number> = {
    user: 0,
    assistant: 1,
};

export function orderChatMessages<T extends OrderedChatMessage>(messages: T[]): T[] {
    return messages
        .map((message, index) => ({ message, index }))
        .sort((a, b) => {
            const timeDelta = a.message.timestamp - b.message.timestamp;
            if (timeDelta !== 0) return timeDelta;
            const roleDelta = (ROLE_ORDER[a.message.role] ?? 2) - (ROLE_ORDER[b.message.role] ?? 2);
            return roleDelta || a.index - b.index;
        })
        .map(({ message }) => message);
}
