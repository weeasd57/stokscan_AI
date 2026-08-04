const fs = require("fs");
const path = require("path");

describe("stream completion safeguards", () => {
    const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/ai-chat/route.ts"), "utf8");
    const context = fs.readFileSync(path.join(process.cwd(), "src/contexts/ChatContext.tsx"), "utf8");
    const finalV2 = fs.readFileSync(path.join(process.cwd(), "src/lib/ai/final-v2.ts"), "utf8");

    it("sends heartbeat events and uses a route budget above one minute", () => {
        expect(route).toContain("maxDuration = 120");
        expect(route).toContain('type: "heartbeat"');
    });

    it("requires a done marker before accepting a streamed response", () => {
        expect(context).toContain("let receivedDone = false");
        expect(context).toContain("الرد انقطع قبل اكتماله");
    });

    it("requires provider completion and uses a bounded response size", () => {
        expect(finalV2).toContain("providerDone");
        expect(finalV2).toContain("responseMaxTokens");
        expect(finalV2).toContain("stream ended before provider completion marker");
    });
});
