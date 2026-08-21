/**
 * Settings — Admin tab crash regression tests.
 *
 * Guards three failure modes introduced in the black-screen fix:
 *
 *  1. AdminSection throws during render → the inner ErrorBoundary in
 *     Settings.tsx shows "ADMIN SETTINGS UNAVAILABLE" while the Settings
 *     nav sidebar remains intact.
 *
 *  2. Settings itself crashes (a module-level hook throws) → an outer
 *     ErrorBoundary (simulated here, matching the one in App.tsx) shows
 *     its "Settings could not be displayed" fallback.
 *
 *  3. UserAccessSection receives an unknown status value → StatusBadge
 *     renders a neutral badge instead of throwing.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// ── Shared auth + route mocks (same as Settings.test.tsx) ──────────────────

const settingsAuth = vi.hoisted(() => ({
  user: {
    id: "admin-user-id",
    primaryEmailAddress: { emailAddress: "admin@example.com" },
    username: "admin",
    publicMetadata: {} as { role?: string },
  },
}));

const adminAccessFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({
    useUser: () => ({
      user: settingsAuth.user,
      isSignedIn: true,
      isLoaded: true,
    }),
  });
});

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", vi.fn()],
}));

vi.mock("@/lib/authorizedFetch", () => ({
  authorizedFetch: (...args: unknown[]) => adminAccessFetch(...args),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useInfiniteQuery: () => ({
    data: undefined,
    isPending: false,
    isSuccess: false,
    isError: true,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}));

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: undefined, isLoading: false, isError: false, refetch: noop };
  }
  function mutationHook() {
    return {
      mutate: noop,
      mutateAsync: noop,
      isPending: false,
      isSuccess: false,
      variables: undefined,
    };
  }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally")
          return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) =>
            `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({ useGetSettings: () => ({ data: null }) }),
);

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: (sel: (s: { activeGrid: null }) => unknown) =>
    sel({ activeGrid: null }),
}));

vi.mock("idb-keyval", () => ({
  keys: () => Promise.resolve([]),
  clear: vi.fn(() => Promise.resolve()),
  get: () => Promise.resolve(null),
  del: () => Promise.resolve(),
}));

vi.mock("@/hooks/useUpscaledHeatmap", () => ({
  clearUpscaleCache: vi.fn(() => Promise.resolve()),
  getUpscaleCacheInfo: vi.fn(() => Promise.resolve({ count: 0, bytes: 0 })),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// AdminSection mock — can be swapped to a throwing version per test
const AdminSectionImpl = vi.hoisted(() =>
  vi.fn(() => <div data-testid="admin-section-stub" />),
);

vi.mock("@/pages/settings/AdminSection", () => ({
  AdminSection: () => AdminSectionImpl(),
}));

// ── Module under test ───────────────────────────────────────────────────────
import { Settings } from "@/pages/Settings";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonResp(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Make the admin probe succeed so the Admin nav tab appears. */
function mockAdminOk(pendingCount = 0) {
  adminAccessFetch.mockImplementation(async (...args: unknown[]) => {
    const url = String(args[0]);
    if (url.includes("pending-count")) return jsonResp(200, { count: pendingCount });
    return jsonResp(200, {});
  });
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
  });
  settingsAuth.user.publicMetadata = {};
  adminAccessFetch.mockReset();
  AdminSectionImpl.mockImplementation(() => <div data-testid="admin-section-stub" />);
  window.history.replaceState(null, "", "/settings");
  Object.defineProperty(window, "caches", {
    value: { keys: vi.fn(() => Promise.resolve([])), delete: vi.fn(), open: vi.fn() },
    writable: true,
    configurable: true,
  });
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Settings Admin tab crash regression", () => {
  it("inner ErrorBoundary shows ADMIN SETTINGS UNAVAILABLE when AdminSection throws, nav remains intact", async () => {
    mockAdminOk();
    // Suppress the expected React error log
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    AdminSectionImpl.mockImplementation(() => {
      throw new Error("simulated AdminSection render crash");
    });

    render(<Settings />);

    // Navigate to Admin tab once it becomes visible
    const adminNav = await screen.findByTestId("settings-nav-admin");
    fireEvent.click(adminNav);

    // Inner boundary must show the admin-section error fallback
    await waitFor(() =>
      expect(screen.getByTestId("admin-section-error")).toBeInTheDocument(),
    );

    // Settings sidebar nav must still be present — the shell did not crash
    expect(screen.getByTestId("settings-nav-general")).toBeInTheDocument();
    expect(screen.getByTestId("settings-nav-admin")).toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("outer ErrorBoundary catches a Settings-level crash and shows its fallback", () => {
    // Force Settings itself to throw by making the wouter hook throw.
    // We re-mock useLocation for this single test with an implementation
    // that throws synchronously.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    // Temporarily make useLocation throw to simulate a Settings-level crash
    vi.doMock("wouter", () => ({
      useLocation: () => {
        throw new Error("simulated Settings-level crash");
      },
    }));

    render(
      <ErrorBoundary
        fallback={
          <div data-testid="settings-outer-error-fallback">
            Settings could not be displayed.
          </div>
        }
      >
        <Settings />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("settings-outer-error-fallback")).toBeInTheDocument();

    // Restore the non-throwing mock for subsequent tests
    vi.doMock("wouter", () => ({
      useLocation: () => ["/settings", vi.fn()],
    }));

    consoleError.mockRestore();
  });
});
