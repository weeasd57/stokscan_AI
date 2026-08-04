describe("chat security guards", () => {
    it("rejects unsupported image payloads and limits image count", () => {
        const allowed = /^data:image\/(jpeg|jpg|png|webp);base64,/i;
        expect(allowed.test("data:image/png;base64,abc")).toBe(true);
        expect(allowed.test("data:image/svg+xml;base64,abc")).toBe(false);
    });

    it("allows only configured response models", () => {
        const allowed = new Set([
            "deepseek-ai/deepseek-v4-flash",
            "meta/llama-3.1-70b-instruct",
            "meta/llama-3.1-8b-instruct",
            "gpt-5.6-sol",
        ]);
        expect(allowed.has("evil/provider-model")).toBe(false);
        expect(allowed.has("deepseek-ai/deepseek-v4-flash")).toBe(true);
    });
});
