/**
 * RoutesPanel — rename PATCH error handling.
 *
 * Covers:
 * - When the rename PATCH returns a non-2xx status, a "Couldn't rename" toast
 *   is shown and the original route name remains displayed (no optimistic
 *   commit).
 * - Happy path: successful rename invalidates the query (no toast fired).
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Stable toast spy ──────────────────────────────────────────────────────────
const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── authorizedFetch mock ──────────────────────────────────────────────────────
const authorizedFetchMock = vi.hoisted(() => vi.fn<typeof import("@/lib/authorizedFetch").authorizedFetch>());
vi.mock("@/lib/authorizedFetch", () => ({
  authorizedFetch: authorizedFetchMock,
}));

// ── Static mocks ──────────────────────────────────────────────────────────────
vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({ isSignedIn: true, isLoaded: true }),
}));

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ datasetId: "ds-test", terrain: null }),
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const state = { units: "metric" as const };
  const useSettingsStore = Object.assign(
    (sel: (s: typeof state) => unknown) => sel(state),
    {
      getState: () => state,
      setState: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      persist: { hasHydrated: () => true, onFinishHydration: vi.fn() },
    },
  );
  return { ...actual, useSettingsStore };
});

vi.mock("@/lib/panelCollapseStore", () => ({
  usePanelCollapseStore: (
    sel: (s: { collapsed: Record<string, boolean>; toggle: () => void }) => unknown,
  ) => sel({ collapsed: { routes: false }, toggle: vi.fn() }),
}));

vi.mock("@/lib/flyRouteStore", () => ({
  useFlyRouteStore: (sel: (s: { active: boolean }) => unknown) =>
    sel({ active: false }),
}));

vi.mock("@/lib/depthProfileStore", () => ({
  useDepthProfileStore: (sel: (s: { pushProfile: () => void }) => unknown) =>
    sel({ pushProfile: vi.fn() }),
  buildPathProfile: vi.fn(),
  depthMetresToWorldY: vi.fn(() => 0),
}));

vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: (
    sel: (s: { zoneMap: Map<string, unknown> }) => unknown,
  ) => sel({ zoneMap: new Map() }),
}));

vi.mock("@/lib/terrain", () => ({
  lonLatToWorldXZ: vi.fn(() => ({ x: 0, z: 0 })),
}));

vi.mock("@/lib/units", () => ({
  formatDistance: vi.fn(() => "1.2 km"),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => React.createElement("button", { onClick }, children),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) =>
    React.createElement("button", null, children),
}));

// ── Import under test ─────────────────────────────────────────────────────────
import { RoutesPanel } from "@/components/RoutesPanel";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ROUTE = {
  id: "route-1",
  name: "My Route",
  datasetId: "ds-test",
  waypointCount: 3,
  totalDistanceM: 1200,
  waypoints: [],
  createdAt: "2026-01-01T00:00:00Z",
};

function makeJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function renderWithClient() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const utils = render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(RoutesPanel),
    ),
  );
  return { ...utils, qc };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
});

describe("RoutesPanel — rename PATCH error", () => {
  it("shows a 'Couldn't rename' toast when the PATCH returns a non-2xx status", async () => {
    authorizedFetchMock.mockImplementation(
      (_url: RequestInfo | URL, opts?: RequestInit) => {
        const method = opts?.method ?? "GET";
        if (method === "GET") return Promise.resolve(makeJsonResponse([ROUTE]));
        if (method === "PATCH") return Promise.resolve(makeJsonResponse({ error: "internal" }, 500));
        return Promise.resolve(makeJsonResponse(null, 204));
      },
    );

    renderWithClient();

    // Wait for the route name to appear (query resolved)
    await waitFor(() => screen.getByText("My Route"));

    // Click the route name to enter edit mode
    fireEvent.click(screen.getByText("My Route"));

    // Change the name and commit via Enter
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "New Name" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // toast must be called with the user-friendly message
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't rename",
          description: "Please try again.",
          variant: "destructive",
        }),
      );
    });
  });

  it("keeps the original name displayed after a failed rename (no optimistic commit)", async () => {
    authorizedFetchMock.mockImplementation(
      (_url: RequestInfo | URL, opts?: RequestInit) => {
        const method = opts?.method ?? "GET";
        if (method === "GET") return Promise.resolve(makeJsonResponse([ROUTE]));
        if (method === "PATCH") return Promise.resolve(makeJsonResponse({ error: "internal" }, 500));
        return Promise.resolve(makeJsonResponse(null, 204));
      },
    );

    renderWithClient();

    await waitFor(() => screen.getByText("My Route"));

    fireEvent.click(screen.getByText("My Route"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "New Name" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // After error, original name must remain in the list
    await waitFor(() => {
      expect(screen.getByText("My Route")).toBeTruthy();
    });
    expect(screen.queryByText("New Name")).toBeNull();
  });

  it("does NOT toast on a successful rename", async () => {
    const updatedRoute = { ...ROUTE, name: "New Name" };
    authorizedFetchMock.mockImplementation(
      (_url: RequestInfo | URL, opts?: RequestInit) => {
        const method = opts?.method ?? "GET";
        if (method === "GET") return Promise.resolve(makeJsonResponse([updatedRoute]));
        if (method === "PATCH") return Promise.resolve(makeJsonResponse(updatedRoute, 200));
        return Promise.resolve(makeJsonResponse(null, 204));
      },
    );

    renderWithClient();

    await waitFor(() => screen.getByText("New Name"));

    fireEvent.click(screen.getByText("New Name"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Renamed" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // Give time for any potential onError to fire
    await new Promise((r) => setTimeout(r, 50));

    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't rename" }),
    );
  });
});
