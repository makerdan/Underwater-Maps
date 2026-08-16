/**
 * useGetMarkersWithOfflineFallback — offline IDB fallback for marker data.
 *
 * Covers:
 *  - When the main useGetMarkers query has data, that data is returned and the
 *    IDB pack is not consulted (no fallback in the happy path).
 *  - When the main query returns undefined (offline / SW cache evicted) AND an
 *    IDB pack with markersPack exists, the pack's markersPack is returned.
 *  - When the main query returns undefined AND no IDB pack exists for the
 *    dataset, undefined is returned (IDB cannot help).
 *  - When the main query returns undefined AND an IDB pack exists but has no
 *    markersPack (legacy pack saved before markers were bundled), [] is
 *    returned (same nil-check as `pack.markersPack ?? []`).
 *  - When datasetId is empty or the hook is disabled, data is undefined.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── idb-keyval mock ──────────────────────────────────────────────────────────

const idbStore = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  get: async (key: string) => idbStore.get(key),
  set: async (key: string, value: unknown) => { idbStore.set(key, value); },
  del: async (key: string) => { idbStore.delete(key); },
  keys: async () => [...idbStore.keys()],
}));

// ── api-client-react mock ────────────────────────────────────────────────────

// Mutable so each test can override what the "server" returns.
let mockMainData: import("@workspace/api-client-react").Marker[] | undefined =
  undefined;

vi.mock("@workspace/api-client-react", () => ({
  useGetMarkers: () => ({ data: mockMainData }),
  getGetMarkersQueryKey: ({ datasetId }: { datasetId: string }) => [
    "markers",
    datasetId,
  ],
}));

// ── imports after mocks ──────────────────────────────────────────────────────

import { useGetMarkersWithOfflineFallback } from "@/hooks/useGetMarkersWithOfflineFallback";
import type { Marker } from "@workspace/api-client-react";
import type { OfflinePack } from "@/lib/offlinePackStore";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

const PACK_KEY_PREFIX = "offline-pack-";

function seedPack(
  id: string,
  datasetId: string,
  markersPack?: Marker[],
): void {
  const pack: Partial<OfflinePack> = {
    id,
    datasetId,
    datasetName: "Test Dataset",
    bbox: { minLon: -70, maxLon: -69, minLat: 42, maxLat: 43 },
    centerLat: 42.5,
    centerLon: -69.5,
    savedAt: new Date().toISOString(),
    terrainUrl: `/api/datasets/${datasetId}/terrain`,
    overviewUrl: `/api/datasets/${datasetId}/overview`,
    tidePack: {
      station: "TEST",
      heightPredictions: [],
      currentPredictions: [],
      tidalExpiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      generatedAt: new Date().toISOString(),
    },
    weatherPack: { station: null, observation: null, snapshotAt: new Date().toISOString() },
    storageBytesEstimate: 1_000_000,
    ...(markersPack !== undefined ? { markersPack } : {}),
  };
  idbStore.set(`${PACK_KEY_PREFIX}${id}`, pack);
}

const MARKERS: Marker[] = [
  { id: "m1", datasetId: "ds-1", label: "Spot A", lat: 42.5, lon: -69.5, type: "custom" } as Marker,
  { id: "m2", datasetId: "ds-1", label: "Spot B", lat: 42.6, lon: -69.6, type: "custom" } as Marker,
];

// ── setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockMainData = undefined;
  idbStore.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Happy path — main query has data, IDB fallback not needed
// ─────────────────────────────────────────────────────────────────────────────

describe("useGetMarkersWithOfflineFallback — main query has data", () => {
  it("returns the live API data when main query succeeds", async () => {
    mockMainData = MARKERS;
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useGetMarkersWithOfflineFallback("ds-1", true),
      { wrapper: Wrapper },
    );
    // Main data is synchronous (mocked), so check immediately
    expect(result.current.data).toEqual(MARKERS);
  });

  it("returns live data even when an IDB pack also exists", async () => {
    mockMainData = MARKERS;
    // Seed a pack with DIFFERENT markers — live data must win
    seedPack("pack-1", "ds-1", [
      { id: "old-m1", datasetId: "ds-1", lat: 42.0, lon: -69.0, type: "custom" } as Marker,
    ]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useGetMarkersWithOfflineFallback("ds-1", true),
      { wrapper: Wrapper },
    );
    expect(result.current.data).toEqual(MARKERS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fallback path — main query has no data, IDB pack exists
// ─────────────────────────────────────────────────────────────────────────────

describe("useGetMarkersWithOfflineFallback — IDB fallback", () => {
  it("returns pack.markersPack when main query is undefined and pack exists", async () => {
    mockMainData = undefined;
    seedPack("pack-1", "ds-1", MARKERS);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useGetMarkersWithOfflineFallback("ds-1", true),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(MARKERS);
    });
  });

  it("returns [] when pack exists but has no markersPack (legacy pack)", async () => {
    mockMainData = undefined;
    // No markersPack field — simulates pre-bundling pack
    seedPack("pack-legacy", "ds-1");

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useGetMarkersWithOfflineFallback("ds-1", true),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });
  });

  it("returns undefined when main query is undefined and no IDB pack exists", async () => {
    mockMainData = undefined;
    // No pack in IDB for ds-1

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useGetMarkersWithOfflineFallback("ds-1", true),
      { wrapper: Wrapper },
    );

    // IDB query resolves null → undefined collapses out
    await waitFor(() => {
      // The IDB query should have settled — data stays undefined because no pack
      expect(result.current.data).toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Disabled / empty slot
// ─────────────────────────────────────────────────────────────────────────────

describe("useGetMarkersWithOfflineFallback — disabled or empty slot", () => {
  it("returns undefined when datasetId is empty string", async () => {
    mockMainData = undefined;
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useGetMarkersWithOfflineFallback("", false),
      { wrapper: Wrapper },
    );
    expect(result.current.data).toBeUndefined();
  });

  it("returns undefined when enabled is false", async () => {
    mockMainData = undefined;
    seedPack("pack-1", "ds-1", MARKERS);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useGetMarkersWithOfflineFallback("ds-1", false),
      { wrapper: Wrapper },
    );
    // Both queries disabled — data stays undefined
    expect(result.current.data).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multiple dataset packs — correct pack is selected by datasetId
// ─────────────────────────────────────────────────────────────────────────────

describe("useGetMarkersWithOfflineFallback — correct pack selected", () => {
  it("returns the pack for the requested datasetId, not another dataset's pack", async () => {
    mockMainData = undefined;
    const markersForDs2: Marker[] = [
      { id: "m-ds2", datasetId: "ds-2", lat: 40.0, lon: -70.0, type: "custom" } as Marker,
    ];
    seedPack("pack-ds1", "ds-1", MARKERS);
    seedPack("pack-ds2", "ds-2", markersForDs2);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useGetMarkersWithOfflineFallback("ds-2", true),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(markersForDs2);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate packs — newest savedAt wins (re-save creates a new IDB record)
// ─────────────────────────────────────────────────────────────────────────────

describe("useGetMarkersWithOfflineFallback — newest pack selected when duplicates exist", () => {
  it("returns the most-recently saved pack's markers when the same dataset was saved twice", async () => {
    mockMainData = undefined;

    const olderMarkers: Marker[] = [
      { id: "old-m1", datasetId: "ds-1", lat: 42.0, lon: -69.0, type: "custom" } as Marker,
    ];
    const newerMarkers: Marker[] = [
      { id: "new-m1", datasetId: "ds-1", lat: 42.5, lon: -69.5, type: "custom" } as Marker,
      { id: "new-m2", datasetId: "ds-1", lat: 42.6, lon: -69.6, type: "custom" } as Marker,
    ];

    // Seed older pack first (earlier savedAt)
    const olderPack: Partial<OfflinePack> = {
      id: "pack-old",
      datasetId: "ds-1",
      datasetName: "Test Dataset",
      bbox: { minLon: -70, maxLon: -69, minLat: 42, maxLat: 43 },
      centerLat: 42.5,
      centerLon: -69.5,
      savedAt: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
      terrainUrl: "/api/datasets/ds-1/terrain",
      overviewUrl: "/api/datasets/ds-1/overview",
      tidePack: { station: "T", heightPredictions: [], currentPredictions: [],
        tidalExpiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
        generatedAt: new Date().toISOString() },
      weatherPack: { station: null, observation: null, snapshotAt: new Date().toISOString() },
      storageBytesEstimate: 1_000_000,
      markersPack: olderMarkers,
    };
    const newerPack: Partial<OfflinePack> = {
      ...olderPack,
      id: "pack-new",
      savedAt: new Date().toISOString(), // now
      markersPack: newerMarkers,
    };
    idbStore.set(`${PACK_KEY_PREFIX}pack-old`, olderPack);
    idbStore.set(`${PACK_KEY_PREFIX}pack-new`, newerPack);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useGetMarkersWithOfflineFallback("ds-1", true),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(newerMarkers);
    });
  });
});
