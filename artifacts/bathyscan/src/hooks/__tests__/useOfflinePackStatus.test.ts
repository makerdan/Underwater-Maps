/**
 * useOfflinePackStatus — status derivation + rollup unit tests
 *
 * Covers:
 *   - derivePackStatusMap: fresh vs expired packs, newest-pack-wins per dataset
 *   - rollupPackStatus: none / partial / stale / downloaded semantics
 *   - useOfflinePackStatuses: initial load, refresh on pack-store notification,
 *     and IDB failure resolving to an empty map
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  derivePackStatusMap,
  rollupPackStatus,
  useOfflinePackStatuses,
  type PackStatus,
} from "@/hooks/useOfflinePackStatus";
import type { OfflinePack } from "@/lib/offlinePackStore";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockListOfflinePacks, listeners } = vi.hoisted(() => {
  const mockListOfflinePacks = vi.fn();
  const listeners = new Set<() => void>();
  return { mockListOfflinePacks, listeners };
});

vi.mock("@/lib/offlinePackStore", () => ({
  listOfflinePacks: mockListOfflinePacks,
  subscribeOfflinePacks: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = Date.parse("2026-08-17T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function pack(
  datasetId: string,
  { savedAt = NOW - DAY, expiresAt = NOW + 7 * DAY }: { savedAt?: number; expiresAt?: number } = {},
): OfflinePack {
  return {
    id: `pack-${datasetId}-${savedAt}`,
    datasetId,
    datasetName: `Dataset ${datasetId}`,
    bbox: { minLon: -70, maxLon: -69, minLat: 43, maxLat: 44 },
    centerLat: 43.5,
    centerLon: -69.5,
    savedAt: new Date(savedAt).toISOString(),
    terrainUrl: `/api/datasets/${datasetId}/terrain`,
    overviewUrl: `/api/datasets/${datasetId}/overview`,
    tidePack: {
      station: null,
      heightPredictions: [],
      currentPredictions: [],
      tidalExpiresAt: new Date(expiresAt).toISOString(),
      generatedAt: new Date(savedAt).toISOString(),
    },
    weatherPack: { station: null, observation: null, snapshotAt: new Date(savedAt).toISOString() },
    storageBytesEstimate: 2_500_000,
  } as unknown as OfflinePack;
}

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  mockListOfflinePacks.mockResolvedValue([]);
});

// ── derivePackStatusMap ───────────────────────────────────────────────────────

describe("derivePackStatusMap", () => {
  it("marks a fresh pack downloaded and an expired pack stale", () => {
    const map = derivePackStatusMap(
      [pack("fresh"), pack("old", { expiresAt: NOW - 1000 })],
      NOW,
    );
    expect(map.get("fresh")).toBe("downloaded");
    expect(map.get("old")).toBe("stale");
    expect(map.get("missing")).toBeUndefined();
  });

  it("newest pack wins when a dataset has several saves", () => {
    // Older pack fresh, newer pack expired → status must follow the NEWER one.
    const map = derivePackStatusMap(
      [
        pack("d", { savedAt: NOW - 3 * DAY, expiresAt: NOW + 7 * DAY }),
        pack("d", { savedAt: NOW - DAY, expiresAt: NOW - 1000 }),
      ],
      NOW,
    );
    expect(map.get("d")).toBe("stale");
  });

  it("returns an empty map for no packs", () => {
    expect(derivePackStatusMap([], NOW).size).toBe(0);
  });
});

// ── rollupPackStatus ──────────────────────────────────────────────────────────

describe("rollupPackStatus", () => {
  const cases: [PackStatus[], string][] = [
    [[], "none"],
    [["none", "none"], "none"],
    [["downloaded", "downloaded"], "downloaded"],
    [["downloaded", "stale"], "stale"],
    [["stale", "stale"], "stale"],
    [["downloaded", "none"], "partial"],
    [["stale", "none"], "partial"],
    [["downloaded", "stale", "none"], "partial"],
  ];
  it.each(cases)("%j → %s", (statuses, expected) => {
    expect(rollupPackStatus(statuses)).toBe(expected);
  });
});

// ── useOfflinePackStatuses ────────────────────────────────────────────────────

describe("useOfflinePackStatuses", () => {
  it("loads statuses on mount", async () => {
    mockListOfflinePacks.mockResolvedValue([pack("a")]);
    const { result } = renderHook(() => useOfflinePackStatuses());
    await waitFor(() => expect(result.current.get("a")).toBe("downloaded"));
  });

  it("refreshes when the pack store notifies (save/delete)", async () => {
    mockListOfflinePacks.mockResolvedValue([]);
    const { result } = renderHook(() => useOfflinePackStatuses());
    await waitFor(() => expect(mockListOfflinePacks).toHaveBeenCalled());
    expect(result.current.size).toBe(0);

    // A pack is saved elsewhere → listener fires → statuses refresh.
    mockListOfflinePacks.mockResolvedValue([pack("b")]);
    await act(async () => {
      for (const l of listeners) l();
    });
    await waitFor(() => expect(result.current.get("b")).toBe("downloaded"));
  });

  it("resolves to an empty map when IDB is unavailable", async () => {
    mockListOfflinePacks.mockRejectedValue(new Error("IDB blocked"));
    const { result } = renderHook(() => useOfflinePackStatuses());
    await waitFor(() => expect(mockListOfflinePacks).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
  });

  it("unsubscribes on unmount", async () => {
    const { unmount } = renderHook(() => useOfflinePackStatuses());
    await waitFor(() => expect(listeners.size).toBe(1));
    unmount();
    expect(listeners.size).toBe(0);
  });
});
