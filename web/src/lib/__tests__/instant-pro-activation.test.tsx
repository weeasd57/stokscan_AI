/** @jest-environment jsdom */

import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import PricingClient, { broadcastEntitlements } from "../../app/pricing/PricingClient";
import PlanQuotaCard from "../../app/profile/components/PlanQuotaCard";

jest.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "test-user-pro" } }),
}));
jest.mock("../../contexts/LanguageContext", () => ({
  useLanguage: () => ({ language: "en" }),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("instant pro activation", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
  });

  it("broadcasts entitlements across event and localStorage instantly", () => {
    const eventHandler = jest.fn();
    window.addEventListener("egx:entitlements-updated", eventHandler);

    broadcastEntitlements(true);

    expect(eventHandler).toHaveBeenCalledTimes(1);
    const customEvent = eventHandler.mock.calls[0][0] as CustomEvent;
    expect(customEvent.detail).toEqual({ is_pro: true });
    expect(localStorage.getItem("egx_pro_active")).toBe("true");
    expect(localStorage.getItem("egx_entitlements_timestamp")).toBeTruthy();

    window.removeEventListener("egx:entitlements-updated", eventHandler);
  });

  it("updates PlanQuotaCard immediately upon receiving egx:entitlements-updated event", async () => {
    let currentIsPro = false;
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/user/quota")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            plan: {
              is_pro: currentIsPro,
              plan_id: currentIsPro ? "pro" : "free",
              name: currentIsPro ? "Pro Plan" : "Free Plan",
            },
            quota: {
              chat_messages: { current: 1, limit: currentIsPro ? 100 : 5 },
              portfolio_stocks: { current: 0, limit: currentIsPro ? 50 : 3 },
              signals: { current: 0, limit: 10 },
            },
          }),
        } as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    render(<PlanQuotaCard />);
    await waitFor(() => expect(screen.getByText("FREE")).not.toBeNull());

    // User pays and upgrade is confirmed:
    currentIsPro = true;
    act(() => {
      window.dispatchEvent(new CustomEvent("egx:entitlements-updated", { detail: { is_pro: true } }));
    });

    // PlanQuotaCard updates to PRO immediately without full page reload or polling
    await waitFor(() => expect(screen.getByText("PRO")).not.toBeNull());
  });

  it("updates PlanQuotaCard immediately when cross-tab storage event fires", async () => {
    let currentIsPro = false;
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/user/quota")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            plan: {
              is_pro: currentIsPro,
              plan_id: currentIsPro ? "pro" : "free",
              name: currentIsPro ? "Pro Plan" : "Free Plan",
            },
            quota: {
              chat_messages: { current: 1, limit: currentIsPro ? 100 : 5 },
              portfolio_stocks: { current: 0, limit: currentIsPro ? 50 : 3 },
              signals: { current: 0, limit: 10 },
            },
          }),
        } as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    render(<PlanQuotaCard />);
    await waitFor(() => expect(screen.getByText("FREE")).not.toBeNull());

    // Storage event from another tab:
    currentIsPro = true;
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "egx_pro_active",
          newValue: "true",
        })
      );
    });

    await waitFor(() => expect(screen.getByText("PRO")).not.toBeNull());
  });
});
