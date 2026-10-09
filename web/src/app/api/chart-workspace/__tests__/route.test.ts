/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET, PUT } from "../route";
import { createSupabaseServerClient } from "@/lib/supabase/server";
jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: jest.fn(),
}));
const workspace = {
  version: 1,
  layout: 1,
  activePanelId: "panel-1",
  syncTime: false,
  panels: [
    {
      id: "panel-1",
      symbol: "COMI",
      exchange: "EGX",
      timeframe: "1D",
      period: 250,
      strategyIds: ["smc"],
    },
  ],
};
const mockClient = (user: { id: string } | null) => {
  const chain: any = {
    select: jest.fn(),
    eq: jest.fn(),
    limit: jest.fn(),
    maybeSingle: jest
      .fn()
      .mockResolvedValue({ data: { workspace }, error: null }),
    upsert: jest.fn().mockResolvedValue({ error: null }),
  };
  for (const key of ["select", "eq", "limit"])
    chain[key].mockReturnValue(chain);
  const client = {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: jest.fn().mockReturnValue(chain),
  };
  (createSupabaseServerClient as jest.Mock).mockResolvedValue(client);
  return { client, chain };
};
const request = (value: unknown) =>
  new NextRequest("http://localhost/api/chart-workspace", {
    method: "PUT",
    body: JSON.stringify(value),
  });
describe("private chart workspace", () => {
  beforeEach(() => jest.clearAllMocks());
  it("rejects unauthenticated reads and writes before touching storage", async () => {
    const { client } = mockClient(null);
    expect(
      (await GET(new NextRequest("http://localhost/api/chart-workspace")))
        .status,
    ).toBe(401);
    expect((await PUT(request({ workspace }))).status).toBe(401);
    expect(client.from).not.toHaveBeenCalled();
  });
  it("bounds read to the authenticated owner and keeps response private", async () => {
    const { chain } = mockClient({ id: "owner" });
    const response = await GET(
      new NextRequest("http://localhost/api/chart-workspace"),
    );
    expect(chain.eq).toHaveBeenCalledWith("user_id", "owner");
    expect(chain.limit).toHaveBeenCalledWith(1);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).workspace).toEqual(workspace);
  });
  it("ignores attacker owner and validates symbols/strategy ids", async () => {
    const { chain } = mockClient({ id: "owner" });
    expect((await PUT(request({ workspace, user_id: "victim" }))).status).toBe(
      200,
    );
    expect(chain.upsert.mock.calls[0][0].user_id).toBe("owner");
    expect(
      (
        await PUT(
          request({
            workspace: {
              ...workspace,
              panels: [{ ...workspace.panels[0], strategyIds: ["invented"] }],
            },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await PUT(
          request({ workspace: { ...workspace, activePanelId: "missing" } }),
        )
      ).status,
    ).toBe(400);
    expect(chain.upsert).toHaveBeenCalledTimes(1);
  });
  it("reports storage failure without claiming a save", async () => {
    const { chain } = mockClient({ id: "owner" });
    chain.upsert.mockResolvedValue({ error: { code: "42P01" } });
    expect((await PUT(request({ workspace }))).status).toBe(503);
  });
  it("rejects corrupted drawings, overlays, numeric layouts and trade levels", async () => {
    const { chain } = mockClient({ id: "owner" });
    expect(
      (await PUT(request({ workspace: { ...workspace, layout: "1" } }))).status,
    ).toBe(400);
    for (const patch of [
      { drawings: [{ type: "rectangle", id: "bad" }] },
      { toolOverlays: { id: "bad" } },
      {
        toolOverlays: [
          {
            id: "bad",
            label: "bad",
            kind: "line",
            points: [{ time: 1, value: -1 }],
          },
        ],
      },
      {
        tradeSettings: {
          entry: 100,
          stop: 120,
          target: 110,
          capital: 50000,
          riskPct: 1,
        },
      },
      { strategyIds: ["smc", "smc"] },
      { toolbarHidden: "yes" },
      { hiddenStrategyIds: ["unknown"] },
      { hiddenDrawingIds: ["duplicate", "duplicate"] },
      {
        comparisonSettings: {
          strategyIds: ["smc"],
          initialCapital: 100000,
          commissionBps: 10,
          slippageBps: 10,
          lookback: 20,
          split: null,
          testWindow: "holdout",
        },
      },
    ])
      expect(
        (
          await PUT(
            request({
              workspace: {
                ...workspace,
                panels: [{ ...workspace.panels[0], ...patch }],
              },
            }),
          )
        ).status,
      ).toBe(400);
    expect(chain.upsert).not.toHaveBeenCalled();
  });
});
