/**
 * Tests for the offline-pack fallback in FindDataPanel.
 *
 * When the device is offline, the Search tab shows the user's saved packs
 * instead of the catalog search results.
 *
 * Coverage:
 *   1. offline + two packs → two pack cards rendered
 *   2. offline + search query matching one pack → only that card shown
 *   3. offline + search query matching none → instructional empty state
 *   4. offline + no packs at all → instructional empty state
 *   5. online → listOfflinePacks never called; catalog query enabled normally
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act, waitFor } from "@testing-library/react";
import React from "react";
import { renderWithProviders } from "./setup";
import { FindDataPanel } from "@/components/FindDataPanel";
import type { OfflinePack } from "@/lib/offlinePackStore";

// ---------------------------------------------------------------------------
// Hoisted proxy factory
// ---------------------------------------------------------------------------
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return {
      data: undefined,
      isFetching: false,
      isLoading: false,
      isError: false,
      dataUpdatedAt: 0,
    };
  }
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
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k))
          return mutationHook;
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

/** Set to false in tests that need the offline branch. */
let mockIsOnline = true;

/** Offline packs returned by listOfflinePacks(). */
let mockPacks: OfflinePack[] = [];

/** Spy so tests can assert how many times listOfflinePacks was called. */
const mockListOfflinePacks = vi.fn(async () => mockPacks);
const mockRequestDatasetSwitch = vi.hoisted(() => vi.fn());
const mockSetDatasetId = vi.hoisted(() => vi.fn());

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
    useGetDatasetsCatalogSearch: () => ({
      data: [],
      isFetching: false,
      dataUpdatedAt: 0,
    }),
  }),
);

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (selector: (s: { isOnline: boolean }) => unknown) =>
    selector({ isOnline: mockIsOnline }),
}));

vi.mock("@/lib/offlinePackStore", () => ({
  listOfflinePacks: () => mockListOfflinePacks(),
}));

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: mockSetDatasetId,
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
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQueries: ({ queries }: { queries: unknown[] }) =>
    queries.map(() => ({
      data: undefined,
      isPending: true,
      isError: false,
      isSuccess: false,
    })),
}));

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: mockRequestDatasetSwitch,
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
// Fixtures
// ---------------------------------------------------------------------------

function makePack(overrides: Partial<OfflinePack> = {}): OfflinePack {
  return {
    id: "pack-1",
    datasetId: "ds-alpha",
    datasetName: "Alpha Survey",
    bbox: { minLon: -135.5, maxLon: -135.0, minLat: 57.0, maxLat: 57.5 },
    centerLat: 57.25,
    centerLon: -135.25,
    savedAt: "2026-08-01T10:00:00.000Z",
    terrainUrl: "/api/datasets/ds-alpha/terrain",
    overviewUrl: "/api/datasets/ds-alpha/overview",
    tidePack: {
      station: null,
      heightPredictions: [],
      currentPredictions: [],
      tidalExpiresAt: "2026-08-08T10:00:00.000Z",
      generatedAt: "2026-08-01T10:00:00.000Z",
    },
    weatherPack: {
      station: null,
      observation: null,
      snapshotAt: "2026-08-01T10:00:00.000Z",
    },
    storageBytesEstimate: 2_621_440,
    ...overrides,
  };
}

const PACK_A = makePack({
  id: "pack-a",
  datasetId: "ds-alpha",
  datasetName: "Alpha Survey",
  centerLat: 57.1234,
  centerLon: -135.5678,
});

const PACK_B = makePack({
  id: "pack-b",
  datasetId: "ds-bravo",
  datasetName: "Bravo Bathymetry",
  centerLat: 56.9876,
  centerLon: -134.4321,
});

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

describe("FindDataPanel — offline pack fallback", () => {
  beforeEach(() => {
    onClose.mockClear();
    mockListOfflinePacks.mockClear();
    mockRequestDatasetSwitch.mockReset();
    mockSetDatasetId.mockClear();
    mockIsOnline = true;
    mockPacks = [];
  });

  // ── 1. offline + two packs ──────────────────────────────────────────────
  it("shows a card for each saved pack when offline with two packs", async () => {
    mockIsOnline = false;
    mockPacks = [PACK_A, PACK_B];

    await act(async () => { renderPanel(); });

    await waitFor(() => {
      expect(screen.getByTestId("offline-packs-heading")).toBeInTheDocument();
      expect(screen.getByText("Alpha Survey")).toBeInTheDocument();
      expect(screen.getByText("Bravo Bathymetry")).toBeInTheDocument();
    });

    // Coordinates formatted to 4 decimal places
    expect(screen.getByText(/57\.1234°, -135\.5678°/)).toBeInTheDocument();
    // Both View buttons present
    expect(screen.getByTestId("offline-pack-view-ds-alpha")).toBeInTheDocument();
    expect(screen.getByTestId("offline-pack-view-ds-bravo")).toBeInTheDocument();

    // listOfflinePacks was called
    expect(mockListOfflinePacks).toHaveBeenCalledTimes(1);
  });

  // ── 2. offline + search filters packs ──────────────────────────────────
  it("filters pack cards by the search query (case-insensitive)", async () => {
    mockIsOnline = false;
    mockPacks = [PACK_A, PACK_B];

    await act(async () => { renderPanel(); });

    await waitFor(() => {
      expect(screen.getByText("Alpha Survey")).toBeInTheDocument();
    });

    // Type a query that only matches Pack B
    const input = screen.getByTestId("find-data-search-input");
    fireEvent.change(input, { target: { value: "bravo" } });

    // Pack A should disappear, Pack B should remain
    await waitFor(() => {
      expect(screen.queryByText("Alpha Survey")).not.toBeInTheDocument();
      expect(screen.getByText("Bravo Bathymetry")).toBeInTheDocument();
    });
  });

  // ── 3. offline + query matches none → empty state ───────────────────────
  it("shows the instructional empty state when the search query matches no packs", async () => {
    mockIsOnline = false;
    mockPacks = [PACK_A];

    await act(async () => { renderPanel(); });

    await waitFor(() => {
      expect(screen.getByText("Alpha Survey")).toBeInTheDocument();
    });

    // Type a query that matches nothing
    const input = screen.getByTestId("find-data-search-input");
    fireEvent.change(input, { target: { value: "zzznomatch" } });

    await waitFor(() => {
      expect(screen.queryByText("Alpha Survey")).not.toBeInTheDocument();
      expect(screen.getByTestId("offline-packs-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/No offline packs saved yet/i)).toBeInTheDocument();
    expect(screen.getByText(/⬇ Offline/)).toBeInTheDocument();
  });

  // ── 4. offline + no packs at all → empty state ──────────────────────────
  it("shows the instructional empty state when offline with no packs saved", async () => {
    mockIsOnline = false;
    mockPacks = [];

    await act(async () => { renderPanel(); });

    await waitFor(() => {
      expect(screen.getByTestId("offline-packs-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/No offline packs saved yet/i)).toBeInTheDocument();
    expect(screen.getByText(/⬇ Offline/)).toBeInTheDocument();
    // No pack cards should exist
    expect(screen.queryByTestId(/^offline-pack-card-/)).not.toBeInTheDocument();
  });

  // ── 5. online → listOfflinePacks not called; normal catalog path ────────
  it("does not call listOfflinePacks and uses catalog query when online", async () => {
    mockIsOnline = true;
    mockPacks = [PACK_A]; // would show if offline

    await act(async () => { renderPanel(); });

    // The offline heading must not appear
    expect(screen.queryByTestId("offline-packs-heading")).not.toBeInTheDocument();
    // Pack cards must not appear
    expect(screen.queryByText("Alpha Survey")).not.toBeInTheDocument();

    // listOfflinePacks must not have been called
    expect(mockListOfflinePacks).not.toHaveBeenCalled();

    // The normal "Type a query" placeholder should be present instead
    expect(
      screen.getByText("Type a query to discover datasets"),
    ).toBeInTheDocument();
  });

  it("closes the panel before applying a confirmed offline pack switch", async () => {
    mockIsOnline = false;
    mockPacks = [PACK_A];
    await act(async () => { renderPanel(); });
    await waitFor(() => {
      expect(screen.getByTestId("offline-pack-view-ds-alpha")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("offline-pack-view-ds-alpha"));

    expect(mockRequestDatasetSwitch).toHaveBeenCalledTimes(1);
    const { onConfirm } = mockRequestDatasetSwitch.mock.calls[0]![0] as {
      onConfirm: () => void;
    };
    onConfirm();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockSetDatasetId).toHaveBeenCalledWith("ds-alpha");
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetDatasetId.mock.invocationCallOrder[0]!,
    );
  });
});
