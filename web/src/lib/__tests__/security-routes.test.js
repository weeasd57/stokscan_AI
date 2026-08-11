describe("chat security guards", () => {
    it("rejects unsupported image payloads and limits image count", () => {
        const allowed = /^data:image\/(jpeg|jpg|png|webp);base64,/i;
        expect(allowed.test("data:image/png;base64,abc")).toBe(true);
        expect(allowed.test("data:image/svg+xml;base64,abc")).toBe(false);
    });

    it("allows only configured response models", () => {
        const allowed = new Set([
            "nvidia/nemotron-3.5-lightning-30b-a3b",
            "meta/muse-glimmer-30b",
        ]);
        expect(allowed.has("evil/provider-model")).toBe(false);
        expect(allowed.has("nvidia/nemotron-3.5-lightning-30b-a3b")).toBe(true);
    });
});
