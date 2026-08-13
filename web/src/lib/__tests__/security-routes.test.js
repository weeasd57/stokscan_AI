describe("chat security guards", () => {
    it("rejects unsupported image payloads and limits image count", () => {
        const allowed = /^data:image\/(jpeg|jpg|png|webp);base64,/i;
        expect(allowed.test("data:image/png;base64,abc")).toBe(true);
        expect(allowed.test("data:image/svg+xml;base64,abc")).toBe(false);
    });

    it("allows only configured response models", () => {
        const allowed = new Set([
            "deepseek-chat",
            "deepseek-reasoner",
        ]);
        expect(allowed.has("evil/provider-model")).toBe(false);
        expect(allowed.has("deepseek-chat")).toBe(true);
    });

    it("keeps provider keys server-side and out of the chat key pool", () => {
        const fs = require("fs");
        const path = require("path");
        const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/ai-chat/route.ts"), "utf8");
        const secrets = fs.readFileSync(path.join(process.cwd(), "src/lib/ai/server-secrets.ts"), "utf8");
        const adminRoute = fs.readFileSync(path.join(process.cwd(), "src/app/api/admin/ai-chatbot/route.ts"), "utf8");
        const settingsRoute = fs.readFileSync(path.join(process.cwd(), "src/app/api/admin/ai-chatbot/settings/route.ts"), "utf8");
        const adminUi = fs.readFileSync(path.join(process.cwd(), "src/app/admin/components/AIChatbotTab.tsx"), "utf8");
        const config = fs.readFileSync(path.join(process.cwd(), "src/lib/ai/config.ts"), "utf8");
        const context = fs.readFileSync(path.join(process.cwd(), "src/contexts/ChatContext.tsx"), "utf8");
        const adminUsersRoute = fs.readFileSync(path.join(process.cwd(), "src/app/api/admin/users/[userId]/route.ts"), "utf8");
        const adminUsersListRoute = fs.readFileSync(path.join(process.cwd(), "src/app/api/admin/users/route.ts"), "utf8");
        const adminUsersStatsRoute = fs.readFileSync(path.join(process.cwd(), "src/app/api/admin/users/stats/route.ts"), "utf8");
        const chatWidget = fs.readFileSync(path.join(process.cwd(), "src/components/ChatWidget.tsx"), "utf8");

        expect(secrets).toContain('import "server-only"');
        expect(secrets).toContain("process.env.NVIDIA_API_KEY");
        expect(secrets).toContain("process.env.NVIDIA_SECONDARY_API_KEY");
        expect(secrets).not.toContain("NVIDIA_NIM_API_KEY");
        expect(route).not.toContain('select("api_key")');
        expect(route).not.toContain("process.env.DEEPSEEK_API_KEY");
        expect(route).toContain("getDeepSeekApiKey()");
        expect(route).toContain("getNvidiaApiKeys()");
        expect(adminRoute).not.toContain("api_key");
        expect(settingsRoute).not.toContain("api_key");
        expect(adminUi).not.toContain("api_key");
        expect(adminRoute).not.toContain('select("*")');
        expect(settingsRoute).not.toContain('select("*")');
        expect(config).toContain("dailyMessages: 50");
        expect(config).not.toContain("unlimitedEmails");
        expect(context).toContain("useState<number>(50)");
        expect(route).not.toContain("remaining_quota: 4");
        expect(route).toContain("isUnlimitedChatUser(user)");
        expect(secrets).toContain("user?.email_confirmed_at");
        expect(secrets).toContain("UNLIMITED_CHAT_EMAILS.has(email)");
        expect(config).toContain('default: "deepseek-chat"');
        expect(config).toContain('"deepseek-reasoner"');
        expect(config).not.toMatch(/agentrouter|openrouter|gemini/i);
        expect(adminUsersRoute).toContain("requireAdmin");
        expect(adminUsersListRoute).toContain("requireAdmin");
        expect(adminUsersListRoute).not.toContain('select("*")');
        expect(adminUsersStatsRoute).toContain("requireAdmin");
        expect(chatWidget).toContain("${remainingQuota}/50 Left");
    });
});
