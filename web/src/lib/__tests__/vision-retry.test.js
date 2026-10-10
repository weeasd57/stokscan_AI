const { analyzeImage } = require("../ai/vision");

const VALID_VISION = {
    image_type: "table",
    symbols: [
        { symbol: "COMI", name: "Commercial International Bank", visible_values: { price: 85.5, change_pct: 1.2, quantity: 100 } },
    ],
    technical_observations: [],
    market_depth: { total_bid: null, total_ask: null, spread: null },
    user_relevant_summary: "جدول أسعار",
    uncertainties: [],
    confidence: 0.9,
};

function okResponse(payload, finishReason = "stop") {
    return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(payload) } }] }),
    };
}

describe("analyzeImage key retry", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it("retries with the second key after the first attempt times out", async () => {
        const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
        const fetchMock = jest.fn()
            .mockRejectedValueOnce(abortError)
            .mockResolvedValueOnce(okResponse(VALID_VISION));
        global.fetch = fetchMock;

        const result = await analyzeImage("data:image/jpeg;base64,AAAA", "اقرأ الصورة", ["key-one", "key-two"], "msg-1");

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer key-one");
        expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer key-two");
        expect(result.error).toBeNull();
        expect(result.vision?.symbols.map(s => s.symbol)).toEqual(["COMI"]);
    });

    it("retries with the second key after an HTTP failure", async () => {
        const fetchMock = jest.fn()
            .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
            .mockResolvedValueOnce(okResponse(VALID_VISION));
        global.fetch = fetchMock;

        const result = await analyzeImage("data:image/jpeg;base64,AAAA", "اقرأ الصورة", ["key-one", "key-two"], "msg-2");

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result.error).toBeNull();
        expect(result.vision?.symbols).toHaveLength(1);
    });

    it("reports the failure when both keys fail", async () => {
        const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        global.fetch = fetchMock;

        const result = await analyzeImage("data:image/jpeg;base64,AAAA", "اقرأ الصورة", ["key-one", "key-two"], "msg-3");

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result.vision).toBeNull();
        expect(result.error).toBe("vision_http_500");
    });

    it("records provider usage even when vision output is truncated", async () => {
        const captures = [];
        const trace = jest.fn();
        const onCall = jest.fn(() => { const capture = jest.fn(); captures.push(capture); return capture; });
        const payload = {choices: [{finish_reason: "length", message: {content: "incomplete"}}], usage: {prompt_tokens: 100, completion_tokens: 1800, total_tokens: 1900}};
        global.fetch = jest.fn().mockResolvedValueOnce({ok: true, json: async () => payload}).mockResolvedValueOnce(okResponse(VALID_VISION));
        await analyzeImage("data:image/jpeg;base64,AAAA", "اقرأ الصورة", ["key-one", "key-two"], "usage-test", onCall, trace);
        expect(onCall).toHaveBeenCalledTimes(2);
        expect(captures[0]).toHaveBeenCalledWith(payload);
        expect(trace.mock.calls.some(([type,data]) => type === "provider_response" && data.choices[0].finish_reason === "length")).toBe(true);
        expect(JSON.stringify(trace.mock.calls)).not.toContain("key-one");
        expect(captures[1]).toHaveBeenCalledTimes(1);
    });

    it("preserves separate screenshots and retries an explicitly truncated result", async () => {
        const truncated = okResponse({ image_type: "table", symbols: [], technical_observations: [] }, "length");
        const fetchMock = jest.fn().mockResolvedValueOnce(truncated).mockResolvedValueOnce(okResponse(VALID_VISION));
        global.fetch = fetchMock;

        const result = await analyzeImage(["data:image/jpeg;base64,AAAA", "data:image/jpeg;base64,BBBB"], "حلل الصورتين", ["key-one", "key-two"], "msg-4");

        const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(firstBody.messages[1].content.filter(part => part.type === "image_url")).toHaveLength(2);
        expect(firstBody.messages[1].content.filter(part => part.type === "image_url").every(part => part.image_url.detail === "high")).toBe(true);
        expect(firstBody.max_tokens).toBe(1800);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result.error).toBeNull();
        expect(result.vision?.symbols.map(s => s.symbol)).toEqual(["COMI"]);
    });
});
