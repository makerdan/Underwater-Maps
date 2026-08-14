/**
 * Tests for the offline-mid-search cancellation in FindDataPanel.
 *
 * When isOnline transitions false while a catalog search is in-flight the
 * component must immediately call queryClient.cancelQueries so that the
 * "Searching…" spinner disappears at once instead of hanging for up to 30 s.
 *
 * Coverage:
 *   1. cancelQueries is called when isOnline drops from true → false while
 *      a catalog search is fetching.
 *   2. "Searching…" is NOT shown after the device goes offline (even if the
 *      underlying hook still reports isFetching=true).
 *   3. "Offline — results unavailable" IS shown after the device goes offline.
 *   4. cancelQueries is NOT called when the component mounts already offline.
 *   5. cancelQueries is NOT called when the component mounts online and no
 *      transition occurs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, act } from "@testing-library/react";
import React from "react";
import { renderWithProviders } from "./setup";
import { FindDataPanel } from "@/components/FindDataPanel";

// ---------------------------------------------------------------------------
// Hoisted proxy factory
// ---------------------------------------------------------------------------
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function mutationHook() {
    return {
      mutate: noop,
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
      isSuccess: false,
      variables: undefined,
    };
  }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (
          typeof p === "symbol" ||
          p === "then" ||
          p === "catch" ||
          p === "finally"
        )
          return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return () => ({ data: undefined, isFetching: false, isLoading: false, isError: false, dataUpdatedAt: 0 });
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) =>
            `/api/mock/${(a as string[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

// ---------------------------------------------------------------------------
// Mutable state controlled by individual tests
// ---------------------------------------------------------------------------

/** Controlled online state. */
let mockIsOnline = true;

/** Whether the catalog search hook reports a fetch in progress. */
let mockIsFetching = false;

/** Spy on queryClient.cancelQueries. */
const mockCancelQueries = vi.fn().mockResolvedValue(undefined);

// ---------------------------------------------------------------------------
// vi.mock declarations
// ---------------------------------------------------------------------------

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetDatasetsMySaves: () => ({
      data: [],
      isFetching: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    }),
    // isFetching is read from the mutable let so individual tests can control it.
    useGetDatasetsCatalogSearch: () => ({
      data: [],
      isFetching: mockIsFetching,
      dataUpdatedAt: 0,
    }),
  }),
);

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (selector: (s: { isOnline: boolean }) => unknown) =>
    selector({ isOnline: mockIsOnline }),
}));

vi.mock("@/lib/offlinePackStore", () => ({
  listOfflinePacks: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: vi.fn(),
    setPendingExternalUserDatasetId: vi.fn(),
    setCatalogSourcedAt: vi.fn(),
  }),
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({
    useAuth: () => ({ isSignedIn: false, isLoaded: true }),
  });
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), cancelQueries: mockCancelQueries }),
  useQueries: ({ queries }: { queries: unknown[] }) =>
    queries.map(() => ({
      data: undefined,
      isPending: true,
      isError: false,
      isSuccess: false,
    })),
}));

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/CoordinateSearchForm", () => ({
  CoordinateSearchForm: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const onClose = vi.fn();

function renderPanel() {
  return renderWithProviders(<FindDataPanel onClose={onClose} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FindDataPanel — cancel in-flight search on offline transition", () => {
  beforeEach(() => {
    onClose.mockClear();
    mockCancelQueries.mockClear();
    mockIsOnline = true;
    mockIsFetching = false;
  });

  // ── 1. cancelQueries called on true → false transition while fetching ────
  it("calls cancelQueries when device goes offline while catalog search is fetching", async () => {
    mockIsOnline = true;
    mockIsFetching = true;

    const { rerender } = await act(async () => renderPanel());

    // Simulate the device going offline: update mock state and re-render so
    // the component's useOfflineStore selector returns the new value.
    mockIsOnline = false;
    await act(async () => {
      rerender(<FindDataPanel onClose={onClose} />);
    });

    // Both the catalog and NCEI cancel effects fire on the same transition.
    expect(mockCancelQueries).toHaveBeenCalledTimes(2);
    // At least one call must target the catalog search key.
    const callArgs = mockCancelQueries.mock.calls as [{ queryKey: unknown[] }][];
    const catalogCall = callArgs.find(([arg]) =>
      Array.isArray(arg.queryKey) && String(arg.queryKey[0]).includes("DatasetsCatalogSearch"),
    );
    expect(catalogCall).toBeDefined();
  });

  // ── 2. "Searching…" NOT shown after going offline ───────────────────────
  it("does not show 'Searching…' after the device goes offline", async () => {
    mockIsOnline = true;
    mockIsFetching = true;

    const { rerender } = await act(async () => renderPanel());

    // Confirm "Searching…" is visible while online and fetching.
    expect(screen.getByText("Searching…")).toBeInTheDocument();

    // Go offline.
    mockIsOnline = false;
    await act(async () => {
      rerender(<FindDataPanel onClose={onClose} />);
    });

    expect(screen.queryByText("Searching…")).not.toBeInTheDocument();
  });

  // ── 3. "Offline — results unavailable" shown after going offline ─────────
  it("shows the offline notice after the device goes offline", async () => {
    mockIsOnline = true;
    mockIsFetching = true;

    const { rerender } = await act(async () => renderPanel());

    mockIsOnline = false;
    await act(async () => {
      rerender(<FindDataPanel onClose={onClose} />);
    });

    expect(screen.getByText("Offline — results unavailable")).toBeInTheDocument();
  });

  // ── 4. cancelQueries NOT called when component mounts already offline ────
  it("does not call cancelQueries when component mounts in an already-offline state", async () => {
    mockIsOnline = false;
    mockIsFetching = false;

    await act(async () => renderPanel());

    expect(mockCancelQueries).not.toHaveBeenCalled();
  });

  // ── 5. cancelQueries NOT called when online and no transition ───────────
  it("does not call cancelQueries when the device stays online", async () => {
    mockIsOnline = true;
    mockIsFetching = true;

    const { rerender } = await act(async () => renderPanel());

    // Re-render without any state change — no transition occurred.
    await act(async () => {
      rerender(<FindDataPanel onClose={onClose} />);
    });

    expect(mockCancelQueries).not.toHaveBeenCalled();
  });
});
