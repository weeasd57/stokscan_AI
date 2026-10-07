/** @jest-environment jsdom */

import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import PricingClient from "../../app/pricing/PricingClient";

jest.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "test-user" } }),
}));
jest.mock("../../contexts/LanguageContext", () => ({
  useLanguage: () => ({ language: "en" }),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe("pricing entitlement refresh", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("updates Free to Pro when the window regains focus", async () => {
    let active = false;
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/payment/easykash/config")) {
        return { ok: true, json: async () => ({ enabled: true, plans: [] }) } as Response;
      }
      if (url.includes("/api/user/quota")) {
        return {
          ok: true,
          json: async () => ({ plan: { is_pro: active, current_period_end: active ? "2026-11-06T15:58:20Z" : null } }),
        } as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    render(<PricingClient />);
    await waitFor(() => expect(screen.getByText("Current Plan")).not.toBeNull());

    active = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(screen.getByText(/Your Pro subscription is active/)).not.toBeNull());
    expect(screen.getByText("Free plan available")).not.toBeNull();
    // The current pricing layout shows active entitlement in the status banner.
    // Verify the focus refresh rather than an obsolete button label.
    expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes("/api/user/quota"))).toHaveLength(2);
  });
});
