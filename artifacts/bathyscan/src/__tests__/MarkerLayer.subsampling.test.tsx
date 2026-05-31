/**
 * MarkerLayer — subsampling effect unit tests.
 *
 * Verifies that the component correctly writes subsampling state to
 * markerLayerStore for three scenarios:
 *   1. Subsampling active  (visible markers > clusterThreshold)
 *   2. Subsampling inactive (visible markers ≤ clusterThreshold)
 *   3. No markers / no terrain → store is cleared
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useMarkerLayerStore } from "@/lib/markerLayerStore";
import type { Marker, TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMarker(id: string, type = "custom"): Marker {
  return { id, type, datasetId: "ds-1", lat: 0, lon: 0, notes: null } as unknown as Marker;
}

const TERRAIN: TerrainData = {
  datasetId: "ds-1",
  minLon: 0, maxLon: 1, minLat: 0, maxLat: 1,
  minDepth: 0, maxDepth: 100, resolution: 2,
  depths: [0, -10, -10, -20],
} as unknown as TerrainData;

// ---------------------------------------------------------------------------
// Mocks — set up before MarkerLayer is imported
// ---------------------------------------------------------------------------

let mockMarkers: Marker[] = [];
let mockTerrain: TerrainData | null = TERRAIN;
let mockClusterThreshold = 0;
const mockVisibleMarkerTypes = ["custom", "waypoint", "hazard", "poi"];

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetMarkers: () => ({ data: mockMarkers }),
    getGetMarkersQueryKey: ({ datasetId }: { datasetId: string }) => ["markers", datasetId],
  }),
);

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: mockTerrain }),
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (sel: (s: {
    visibleMarkerTypes: string[];
    showMarkerLabels: boolean;
    markerClusterThreshold: number;
  }) => unknown) =>
    sel({
      visibleMarkerTypes: mockVisibleMarkerTypes,
      showMarkerLabels: false,
      markerClusterThreshold: mockClusterThreshold,
    }),
}));

vi.mock("@/components/MarkerSprite", () => ({
  MarkerSprite: () => null,
}));

// three is used only for the Group type annotation on the ref; no mock needed.

// ---------------------------------------------------------------------------
// Import component after mocks are hoisted
// ---------------------------------------------------------------------------

import { MarkerLayer } from "@/components/MarkerLayer";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function resetStore() {
  useMarkerLayerStore.getState().clear();
}

describe("MarkerLayer — subsampling effect wiring", () => {
  beforeEach(() => {
    resetStore();
    mockTerrain = TERRAIN;
    mockClusterThreshold = 0;
    mockMarkers = [];
  });

  it("sets isSubsampled=false when visible count is within the cluster threshold", async () => {
    mockMarkers = [makeMarker("m1"), makeMarker("m2"), makeMarker("m3")];
    mockClusterThreshold = 10; // threshold higher than marker count

    await act(async () => {
      render(<MarkerLayer />);
    });

    const s = useMarkerLayerStore.getState();
    expect(s.totalVisible).toBe(3);
    expect(s.renderedCount).toBe(3);
    expect(s.isSubsampled).toBe(false);
  });

  it("sets isSubsampled=true and reduces renderedCount when visible count exceeds threshold", async () => {
    mockMarkers = Array.from({ length: 10 }, (_, i) => makeMarker(`m${i}`));
    mockClusterThreshold = 3; // stride = ceil(10/3) = 4 → indices 0,4,8 → 3 rendered

    await act(async () => {
      render(<MarkerLayer />);
    });

    const s = useMarkerLayerStore.getState();
    expect(s.totalVisible).toBe(10);
    expect(s.renderedCount).toBe(3);
    expect(s.isSubsampled).toBe(true);
  });

  it("subsampling is inactive when clusterThreshold = 0 (disabled)", async () => {
    mockMarkers = Array.from({ length: 50 }, (_, i) => makeMarker(`m${i}`));
    mockClusterThreshold = 0; // 0 disables subsampling

    await act(async () => {
      render(<MarkerLayer />);
    });

    const s = useMarkerLayerStore.getState();
    expect(s.totalVisible).toBe(50);
    expect(s.renderedCount).toBe(50);
    expect(s.isSubsampled).toBe(false);
  });

  it("clears the store when terrain is null", async () => {
    // Pre-populate store to confirm clear() resets it.
    useMarkerLayerStore.getState().setSubsampleState(20, 5);
    mockTerrain = null;
    mockMarkers = Array.from({ length: 10 }, (_, i) => makeMarker(`m${i}`));
    mockClusterThreshold = 3;

    await act(async () => {
      render(<MarkerLayer />);
    });

    const s = useMarkerLayerStore.getState();
    expect(s.totalVisible).toBe(0);
    expect(s.renderedCount).toBe(0);
    expect(s.isSubsampled).toBe(false);
  });

  it("clears the store when the marker list is empty", async () => {
    useMarkerLayerStore.getState().setSubsampleState(20, 5);
    mockMarkers = [];
    mockClusterThreshold = 3;

    await act(async () => {
      render(<MarkerLayer />);
    });

    const s = useMarkerLayerStore.getState();
    expect(s.totalVisible).toBe(0);
    expect(s.renderedCount).toBe(0);
    expect(s.isSubsampled).toBe(false);
  });
});
