/**
 * settingsRouteAccessGate.test.tsx
 *
 * Route-level regression tests for the access gate on the /settings route.
 *
 * Background: the gate was originally only wired into HomeRoute, so a
 * pending or banned user who navigated directly to /settings saw the full
 * settings UI and still fired protected requests (settings sync). These
 * tests render the real SettingsRoute from App.tsx and verify:
 *
 *   1. 403 awaiting_approval → awaiting-approval screen; the Settings page
 *      never mounts and the server settings sync never runs.
 *   2. 403 account_banned → suspended screen; same non-mount guarantees.
 *   3. 200 (approved) → the Settings page renders normally (positive
 *      control that the gate does not break /settings for approved users).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// ── Hoisted spies ─────────────────────────────────────────────────────────────

const authorizedFetchMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<Response>>(),
);
const serverSettingsSyncSpy = vi.hoisted(() => vi.fn());
const paletteSuggestionSpy = vi.hoisted(() => vi.fn());

// ── Module mocks (before importing App.tsx) ───────────────────────────────────

vi.mock("@/lib/clerkCompat", () => ({
  useClerk: () => ({ signOut: vi.fn(), session: null }),
  useUser: () => ({
    user: { primaryEmailAddress: { emailAddress: "pending@example.com" } },
    isLoaded: true,
    isSignedIn: true,
  }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  // Render only the signed-in branch, exactly like a signed-in session.
  Show: ({ when, children }: { when: string; children: React.ReactNode }) =>
    when === "signed-in" ? <>{children}</> : null,
  SignIn: () => null,
  SignUp: () => null,
}));

vi.mock("@/lib/authorizedFetch", () => ({
  authorizedFetch: (...args: unknown[]) => authorizedFetchMock(...args),
}));

vi.mock("@/lib/devAuth", () => ({ DEV_AUTH_BYPASS: false }));

vi.mock("@/pages/Settings", () => ({
  Settings: () => <div data-testid="settings-page-stub" />,
}));

vi.mock("@/hooks/useServerSettingsSync", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useServerSettingsSync")>();
  return { ...actual, useServerSettingsSync: serverSettingsSyncSpy };
});

vi.mock("@/hooks/usePaletteSuggestion", () => ({
  usePaletteSuggestion: paletteSuggestionSpy,
}));

vi.mock("@/components/ShallowDatasetBanner", () => ({
  ShallowDatasetBanner: () => null,
}));

// ── Import under test — after all vi.mock() calls ────────────────────────────
import { SettingsRoute } from "@/App";

function jsonResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SettingsRoute — access gate on direct /settings navigation", () => {
  it("blocks a pending user with the awaiting-approval screen; Settings never mounts, sync never runs", async () => {
    authorizedFetchMock.mockResolvedValue(
      jsonResponse(403, { error: "awaiting_approval" }),
    );
    render(<SettingsRoute />);

    await waitFor(() =>
      expect(screen.getByTestId("access-gate-pending")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("settings-page-stub")).toBeNull();
    expect(serverSettingsSyncSpy).not.toHaveBeenCalled();
    expect(paletteSuggestionSpy).not.toHaveBeenCalled();
  });

  it("blocks a banned user with the suspended screen; Settings never mounts, sync never runs", async () => {
    authorizedFetchMock.mockResolvedValue(
      jsonResponse(403, { error: "account_banned" }),
    );
    render(<SettingsRoute />);

    await waitFor(() =>
      expect(screen.getByTestId("access-gate-banned")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("settings-page-stub")).toBeNull();
    expect(serverSettingsSyncSpy).not.toHaveBeenCalled();
    expect(paletteSuggestionSpy).not.toHaveBeenCalled();
  });

  it("renders the Settings page for an approved user (positive control)", async () => {
    authorizedFetchMock.mockResolvedValue(jsonResponse(200, {}));
    render(<SettingsRoute />);

    await waitFor(() =>
      expect(screen.getByTestId("settings-page-stub")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("access-gate-pending")).toBeNull();
    expect(screen.queryByTestId("access-gate-banned")).toBeNull();
  });
});
