import { createChatMessageTimestamps, orderChatMessages } from "../chat-order";

describe("chat history order", () => {
    test("persists the answer after the request even when the database clock falls in one millisecond", () => {
        const pair = createChatMessageTimestamps(1000, 1000);
        expect(Date.parse(pair.user)).toBe(1000);
        expect(Date.parse(pair.assistant)).toBe(1001);
    });

    test("places the user's question before its answer when database timestamps are equal", () => {
        const messages = [
            { id: "assistant-id", role: "assistant", timestamp: 1000, content: "answer" },
            { id: "user-id", role: "user", timestamp: 1000, content: "question" },
        ];

        expect(orderChatMessages(messages).map(message => message.id)).toEqual(["user-id", "assistant-id"]);
    });

    test("keeps chronological order and preserves same-role insertion order", () => {
        const messages = [
            { id: "later", role: "user", timestamp: 2000 },
            { id: "same-a", role: "user", timestamp: 1000 },
            { id: "same-b", role: "user", timestamp: 1000 },
        ];

        expect(orderChatMessages(messages).map(message => message.id)).toEqual(["same-a", "same-b", "later"]);
    });
});
