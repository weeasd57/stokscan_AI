import type { CorporateActionItem } from "../corporate-actions";

jest.mock("../web-search", () => ({ searchWeb: jest.fn() }));
jest.mock("../execution", () => ({ getExecutionSignal: jest.fn() }));

const NOW = new Date("2026-09-15T12:00:00Z");
const TTL = 6 * 60 * 60 * 1000;

function article(overrides: Partial<CorporateActionItem> = {}): CorporateActionItem {
    return {
        symbol: "COMI", exchange: "EGX", action_type: "dividend", action_type_ar: "توزيعات أرباح",
        title: "COMI declares dividend of 2 EGP", action_date: null, published_at: null,
        url: "https://example.com/dividend", source: "example.com", sentiment_score: null,
        sentiment_label: null, confidence: 0.9, details: null, origin: "scheduler", ...overrides,
    };
}

function webArticle(overrides: Record<string, unknown> = {}) {
    return { title: article().title, snippet: "", url: article().url, domain: "example.com", ...overrides };
}

function database(rows: CorporateActionItem[] = []) {
    const state = { rows, error: null as any, saveError: null as any, persist: true };
    function query(result: () => unknown) {
        const q: any = {
            select: jest.fn(() => q), in: jest.fn(() => q), or: jest.fn(() => q),
            order: jest.fn(() => q), limit: jest.fn(() => q), abortSignal: jest.fn(() => q),
            then: (resolve: any, reject: any) => Promise.resolve().then(result).then(resolve, reject),
        };
        return q;
    }
    const read = query(() => ({ data: state.rows, error: state.error }));
    const names = query(() => ({ data: [{ symbol: "COMI", name: "Commercial Bank" }], error: null }));
    const write = query(() => ({ error: state.saveError }));
    const upsert = jest.fn((newRows: any[]) => {
        if (state.persist && !state.saveError) state.rows.push(...newRows);
        return write;
    });
    const client = { from: jest.fn((table: string) => table === "stocks" ? names : { select: read.select, upsert }) };
    return { client, state, read, names, write, upsert };
}

describe("corporate-actions lookup cache and cancellation", () => {
    let getActions: typeof import("../corporate-actions").getCorporateActionsForSymbols;
    let format: typeof import("../corporate-actions").formatCorporateActionsSummary;
    let search: jest.Mock;
    let executionSignal: jest.Mock;

    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers().setSystemTime(NOW);
        jest.spyOn(console, "warn").mockImplementation(() => {});
        // Hard guard: this suite must never make a live request.
        jest.spyOn(global, "fetch").mockRejectedValue(new Error("Unexpected live fetch"));
        const module = require("../corporate-actions");
        getActions = module.getCorporateActionsForSymbols;
        format = module.formatCorporateActionsSummary;
        search = require("../web-search").searchWeb;
        search.mockResolvedValue([]);
        executionSignal = require("../execution").getExecutionSignal;
    });

    afterEach(() => {
        expect(global.fetch).not.toHaveBeenCalled();
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it("two turns reuse an undated successful lookup and its persisted DB row", async () => {
        const db = database();
        search.mockResolvedValue([webArticle()]);
        const first = await getActions(db.client, ["comi.CA", "COMI"]);
        const second = await getActions(db.client, ["COMI"]);
        expect(first).toMatchObject({ fromWeb: 1, savedToDatabase: 1 });
        expect(second).toMatchObject({ fromDatabase: 1, fromWeb: 0, savedToDatabase: 0 });
        expect(second.items).toHaveLength(1);
        expect(second.items[0].published_at).toBeNull();
        expect(db.upsert.mock.calls[0][0][0]).toMatchObject({
            published_at: null, details: { published_at_unknown: true, discovered_at: NOW.toISOString() },
        });
        expect(db.read.or).toHaveBeenCalledWith(expect.stringContaining("updated_at.gte."));
        expect(search).toHaveBeenCalledTimes(1);
        expect(db.upsert).toHaveBeenCalledTimes(1);
    });

    it("uses search TTL, not a fresh news/action/update date, and expires at six hours", async () => {
        const db = database([article({ published_at: NOW.toISOString(), action_date: "2026-09-30", updated_at: NOW.toISOString() })]);
        search.mockResolvedValue([webArticle()]);
        await getActions(db.client, ["COMI"]);
        jest.setSystemTime(NOW.getTime() + TTL - 1);
        await getActions(db.client, ["COMI"]);
        expect(search).toHaveBeenCalledTimes(1);
        jest.setSystemTime(NOW.getTime() + TTL);
        await getActions(db.client, ["COMI"]);
        expect(search).toHaveBeenCalledTimes(2);
        expect(db.upsert).not.toHaveBeenCalled();
    });

    it("negative-caches a successful empty lookup, but keeps querying DB and expires", async () => {
        const db = database();
        expect((await getActions(db.client, ["COMI"])).items).toEqual([]);
        db.state.rows = [article()];
        expect((await getActions(db.client, ["COMI"])).items).toHaveLength(1);
        expect(search).toHaveBeenCalledTimes(1);
        expect(db.read.select).toHaveBeenCalledTimes(2);
        expect(db.upsert).not.toHaveBeenCalled();
        jest.setSystemTime(NOW.getTime() + TTL);
        await getActions(db.client, ["COMI"]);
        expect(search).toHaveBeenCalledTimes(2);
    });

    it("caches successful searches whose results are unrelated, without marker rows", async () => {
        const db = database();
        search.mockResolvedValue([webArticle({ title: "Football results" })]);
        await getActions(db.client, ["COMI"]);
        await getActions(db.client, ["COMI"]);
        expect(search).toHaveBeenCalledTimes(1);
        expect(db.upsert).not.toHaveBeenCalled();
    });

    it("does not negative-cache query errors or use data returned alongside a DB error", async () => {
        const db = database([article()]);
        db.state.error = { message: "query unavailable" };
        search.mockRejectedValueOnce(new Error("network unavailable")).mockResolvedValueOnce([webArticle()]);
        const first = await getActions(db.client, ["COMI"]);
        const second = await getActions(db.client, ["COMI"]);
        expect(first.items).toEqual([]);
        expect(second.fromWeb).toBe(1);
        expect(search).toHaveBeenCalledTimes(2);
    });

    it("a DB failure does not prevent caching a successful web lookup", async () => {
        const db = database();
        db.state.error = { message: "DB unavailable" };
        search.mockResolvedValue([]);
        await getActions(db.client, ["COMI"]);
        db.state.error = null;
        db.state.rows = [article()];
        expect((await getActions(db.client, ["COMI"])).fromDatabase).toBe(1);
        expect(search).toHaveBeenCalledTimes(1);
    });

    it.each(["returned", "thrown"])("retains web results after a %s save error without claiming persistence", async kind => {
        const db = database();
        db.state.saveError = { message: "write denied" };
        if (kind === "thrown") db.upsert.mockImplementation(() => { throw new Error("write denied"); });
        search.mockResolvedValue([webArticle()]);
        const first = await getActions(db.client, ["COMI"]);
        const second = await getActions(db.client, ["COMI"]);
        expect(first).toMatchObject({ fromWeb: 1, savedToDatabase: 0 });
        expect(second).toMatchObject({ fromCache: 1, savedToDatabase: 0 });
        expect(second.items).toHaveLength(1);
        expect(format(first)).not.toContain("تم حفظ");
        expect(format(first)).not.toContain("وحفظه");
        expect(format(second)).toContain("نتائج بحث مخزنة مؤقتاً");
        expect(search).toHaveBeenCalledTimes(1);
    });

    it("normalizes legacy unknown dates and preserves genuinely known publication dates", async () => {
        const db = database([article({ published_at: NOW.toISOString(), details: { published_at_unknown: true } })]);
        search.mockResolvedValue([webArticle({ title: "COMI stock split", url: "https://example.com/split", published_at: "2026-09-10T08:00:00Z" })]);
        const result = await getActions(db.client, ["COMI"]);
        expect(result.items.find(i => i.action_type === "dividend")?.published_at).toBeNull();
        expect(result.items[0]).toMatchObject({ published_at: "2026-09-10T08:00:00.000Z", details: { published_at_unknown: false } });
        expect(format(result)).toContain("تاريخ النشر: غير محدد");
    });

    it.each([undefined, null, "invalid"])("does not fabricate a date for %s", async published_at => {
        search.mockResolvedValue([webArticle({ published_at })]);
        const result = await getActions(database().client, ["COMI"]);
        expect(result.items[0].published_at).toBeNull();
        expect(result.items[0].details?.published_at_unknown).toBe(true);
    });

    it("dedupes DB+web by canonical URL or headline across sources before saving/counting", async () => {
        const existing = article({ published_at: "2026-09-10T00:00:00Z" });
        const db = database([existing, { ...existing, url: "https://another-source.com/1" }]);
        search.mockResolvedValue([
            webArticle({ url: "https://www.example.com/dividend/?utm_source=search#top", title: "COMI dividend announcement" }),
            webArticle({ url: "https://third-source.com/dividend" }),
            webArticle({ title: "COMI stock split", url: "https://example.com/split" }),
            webArticle({ title: "COMI stock split", url: "https://another-source.com/split" }),
        ]);
        const result = await getActions(db.client, ["COMI"]);
        expect(result.items).toHaveLength(2);
        expect(result).toMatchObject({ fromDatabase: 1, fromWeb: 1, savedToDatabase: 1 });
        expect(db.upsert.mock.calls[0][0]).toHaveLength(1);
        expect(result.items[0].published_at).toBe(existing.published_at);
    });

    it("does not fill the search cache when web search is disabled", async () => {
        const db = database();
        await getActions(db.client, ["COMI"], { enableWebSearch: false });
        expect(search).not.toHaveBeenCalled();
        await getActions(db.client, ["COMI"]);
        expect(search).toHaveBeenCalledTimes(1);
    });

    it("keys cache by symbol and lookback", async () => {
        const db = database();
        await getActions(db.client, ["COMI"]);
        await getActions(db.client, ["COMI"], { lookbackDays: 30 });
        await getActions(db.client, ["ABUK"]);
        expect(search).toHaveBeenCalledTimes(3);
    });

    it("inherits execution cancellation before any DB or web work", async () => {
        const controller = new AbortController();
        controller.abort(new Error("parent cancelled"));
        executionSignal.mockReturnValue(controller.signal);
        const db = database();
        await expect(getActions(db.client, ["COMI"])).rejects.toThrow("parent cancelled");
        expect(db.client.from).not.toHaveBeenCalled();
        expect(search).not.toHaveBeenCalled();
    });

    it("passes an explicit signal through all DB queries and search instead of ambient signal", async () => {
        const controller = new AbortController();
        const ambient = new AbortController();
        ambient.abort();
        executionSignal.mockReturnValue(ambient.signal);
        const db = database();
        search.mockResolvedValue([webArticle()]);
        await getActions(db.client, ["COMI"], { signal: controller.signal });
        for (const q of [db.read, db.names, db.write]) expect(q.abortSignal).toHaveBeenCalledWith(controller.signal);
        expect(search).toHaveBeenCalledWith(expect.any(String), 5, 4500, controller.signal);
    });

    it("stops waiting for a stalled DB query on parent cancellation", async () => {
        const controller = new AbortController();
        const db = database();
        db.read.then = () => new Promise(() => {});
        const result = getActions(db.client, ["COMI"], { signal: controller.signal });
        const assertion = expect(result).rejects.toThrow("stop DB");
        controller.abort(new Error("stop DB"));
        await assertion;
        expect(search).not.toHaveBeenCalled();
    });

    it("does not save or cache results returned after cancellation", async () => {
        const controller = new AbortController();
        const db = database();
        search.mockImplementationOnce(async () => {
            controller.abort(new Error("stop search"));
            return [webArticle()];
        });
        await expect(getActions(db.client, ["COMI"], { signal: controller.signal })).rejects.toThrow("stop search");
        expect(db.upsert).not.toHaveBeenCalled();
        await getActions(db.client, ["COMI"]);
        expect(search).toHaveBeenCalledTimes(2);
    });
});
