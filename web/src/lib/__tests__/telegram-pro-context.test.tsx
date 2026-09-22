/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, loading: false }),
}));

import { TelegramProProvider, useTelegramPro } from "../../contexts/TelegramProContext";

function Probe() {
  const { invite, loading, refresh } = useTelegramPro();
  return (
    <div>
      <span>{loading ? "loading" : invite.invite_link || "ready"}</span>
      <button type="button" onClick={() => void refresh()}>refresh</button>
    </div>
  );
}

describe("TelegramProContext", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ is_pro: true, invite_link: "https://t.me/+cached" }),
    })) as any;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("loads once, ignores tab visibility changes, and refreshes only on demand", async () => {
    render(<TelegramProProvider><Probe /></TelegramProProvider>);

    await screen.findByText("https://t.me/+cached");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => Promise.resolve());
    expect(global.fetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "refresh" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });
});
