import React, { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../../contexts/AuthContext";
import { createSupabaseBrowserClient } from "../supabase/browser";

jest.mock("../supabase/browser", () => ({
  createSupabaseBrowserClient: jest.fn(),
}));

type AuthListener = (event: string, session: any) => void;

const baseUser = {
  id: "user-1",
  email: "user@example.com",
  app_metadata: { provider: "email" },
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-10-01T00:00:00Z",
};

function makeSession(accessToken: string, expiresAt = Math.floor(Date.now() / 1000) + 3600, user = baseUser) {
  return {
    access_token: accessToken,
    refresh_token: "refresh-token",
    expires_in: 3600,
    expires_at: expiresAt,
    token_type: "bearer",
    user,
  };
}

let listener: AuthListener | null = null;
let userEffectRuns = 0;
let ensureFresh: (() => Promise<boolean>) | null = null;
let mockClient: any;

function Probe() {
  const { user, session, ensureFreshSession } = useAuth();
  ensureFresh = ensureFreshSession;

  useEffect(() => {
    if (user) userEffectRuns += 1;
  }, [user]);

  return (
    <div>
      <span data-testid="user-email">{user?.email || "none"}</span>
      <span data-testid="token">{session?.access_token || "none"}</span>
    </div>
  );
}

beforeEach(() => {
  listener = null;
  userEffectRuns = 0;
  ensureFresh = null;

  mockClient = {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: makeSession("initial") }, error: null }),
      onAuthStateChange: jest.fn((cb: AuthListener) => {
        listener = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
      refreshSession: jest.fn(),
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signInWithOAuth: jest.fn(),
      signOut: jest.fn(),
    },
  };

  (createSupabaseBrowserClient as jest.Mock).mockReturnValue(mockClient);
});

it("keeps the user identity stable when only the auth token refreshes", async () => {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

  await screen.findByText("initial");
  expect(userEffectRuns).toBe(1);
  expect(listener).not.toBeNull();

  act(() => {
    listener?.(
      "TOKEN_REFRESHED",
      makeSession("rotated", Math.floor(Date.now() / 1000) + 3600, { ...baseUser }),
    );
  });

  await screen.findByText("rotated");
  expect(userEffectRuns).toBe(1);

  act(() => {
    listener?.(
      "USER_UPDATED",
      makeSession("updated", Math.floor(Date.now() / 1000) + 3600, {
        ...baseUser,
        email: "updated@example.com",
      }),
    );
  });

  await waitFor(() => expect(screen.getByTestId("user-email")).toHaveTextContent("updated@example.com"));
  expect(userEffectRuns).toBe(2);
});

it("single-flights a near-expiry session refresh", async () => {
  const nearExpiry = makeSession("near-expiry", Math.floor(Date.now() / 1000) + 30);
  mockClient.auth.getSession.mockResolvedValue({ data: { session: nearExpiry }, error: null });

  let resolveRefresh: ((value: any) => void) | null = null;
  mockClient.auth.refreshSession.mockReturnValue(
    new Promise((resolve) => {
      resolveRefresh = resolve;
    }),
  );

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

  await screen.findByText("near-expiry");
  expect(ensureFresh).not.toBeNull();

  const first = ensureFresh!();
  const second = ensureFresh!();
  expect(mockClient.auth.refreshSession).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveRefresh?.({
      data: { session: makeSession("fresh", Math.floor(Date.now() / 1000) + 3600) },
      error: null,
    });
    await Promise.all([first, second]);
  });

  await screen.findByText("fresh");
  expect(await first).toBe(true);
  expect(await second).toBe(true);
  expect(mockClient.auth.refreshSession).toHaveBeenCalledTimes(1);
});
