import { NextRequest } from "next/server";
import { POST } from "../../app/api/analytics/events/route";
import { getViewerIdentity } from "../supabase/viewer-context";
import { getSupabaseServiceClient } from "../supabase/route-data";

jest.mock("../supabase/viewer-context", () => ({ getViewerIdentity: jest.fn() }));
jest.mock("../supabase/route-data", () => ({ getSupabaseServiceClient: jest.fn() }));

const viewerIdentity = getViewerIdentity as jest.Mock;
const serviceClient = getSupabaseServiceClient as jest.Mock;

beforeEach(() => jest.clearAllMocks());

function request(body: Record<string, unknown>) {
  return new NextRequest("https://egxbots.example/api/analytics/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

it("rejects telemetry before opening the service client when identity is not verified", async () => {
  viewerIdentity.mockResolvedValue({ authenticated: false, userId: null });

  const response = await POST(request({ event_name: "page_view", path: "/profile" }));

  expect(response.status).toBe(401);
  expect(serviceClient).not.toHaveBeenCalled();
});

it("writes telemetry only for the verified user id", async () => {
  viewerIdentity.mockResolvedValue({ authenticated: true, userId: "owner-A" });
  const insert = jest.fn(async () => ({ error: null }));
  const from = jest.fn(() => ({ insert }));
  serviceClient.mockReturnValue({ from });

  const response = await POST(request({
    user_id: "victim",
    event_name: "feature_use",
    path: "/scanner/backtests?tab=similarity",
    session_id: "browser-session",
    metadata: { feature: "similarity", ignored_nested: { x: 1 } },
  }));

  expect(response.status).toBe(200);
  expect(from).toHaveBeenCalledWith("user_activity_events");
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({
    user_id: "owner-A",
    event_name: "feature_use",
    path: "/scanner/backtests?tab=similarity",
    session_id: "browser-session",
    metadata: { feature: "similarity" },
  }));
});
