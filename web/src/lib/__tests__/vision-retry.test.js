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

function okResponse(payload) {
    return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
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
});
