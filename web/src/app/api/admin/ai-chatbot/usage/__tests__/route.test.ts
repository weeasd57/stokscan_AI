import { NextRequest } from "next/server";
import { GET } from "../route";
import { requireAdmin } from "@/lib/admin-auth";
import { getSupabaseClient } from "@/lib/supabase/route-data";
jest.mock("@/lib/admin-auth", () => ({requireAdmin: jest.fn()}));
jest.mock("@/lib/supabase/route-data", () => ({getSupabaseClient: jest.fn()}));
const auth = requireAdmin as jest.Mock;
const client = getSupabaseClient as jest.Mock;
const row = (id: string, usage: any = {cost_usd: 0.001, total_tokens: 10}) => ({id, user_id: "user", session_id: "session", usage});
beforeEach(() => { jest.clearAllMocks(); auth.mockResolvedValue({user: {id: "admin"}}); });
test("rejects unauthorized requests before reading costs", async () => {
    auth.mockResolvedValue(new Response("unauthorized", {status: 401}));
    expect((await GET(new NextRequest("https://test/api/admin/ai-chatbot/usage"))).status).toBe(401);
    expect(client).not.toHaveBeenCalled();
});
test("paginates past the visible logs and flags historical unknown messages", async () => {
    const range = jest.fn().mockResolvedValueOnce({data: Array.from({length: 1000}, (_,i) => row(String(i)))}).mockResolvedValueOnce({data: [row("last", null)]});
    const query: any = {select: jest.fn(() => query), eq: jest.fn(() => query), lte: jest.fn(() => query), order: jest.fn(() => query), range};
    client.mockReturnValue({from: jest.fn(() => query)});
    const response = await GET(new NextRequest("https://test/api/admin/ai-chatbot/usage"));
    const json = await response.json();
    expect(json.complete).toBe(true);
    expect(json.users.user).toMatchObject({messages: 1001, unpriced_messages: 1, total_tokens: 10000});
    expect(json.users.user.cost_usd).toBeCloseTo(1);
    expect(range.mock.calls).toEqual([[0,999], [1000,1999]]);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
test("query failure does not return a misleading zero total", async () => {
    const query: any = {select: () => query, eq: () => query, lte: () => query, order: () => query, range: async () => ({error: {message: "db error"}})};
    client.mockReturnValue({from: () => query});
    expect((await GET(new NextRequest("https://test/api/admin/ai-chatbot/usage"))).status).toBe(500);
});
