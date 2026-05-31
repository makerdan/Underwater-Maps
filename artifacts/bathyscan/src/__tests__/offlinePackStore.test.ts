/**
 * offlinePackStore unit tests.
 *
 * Tests for the pure interpolation helpers and the pack CRUD logic.
 * idb-keyval is mocked via vitest so no real IndexedDB is required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── idb-keyval mock ────────────────────────────────────────────────────────
const store = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  get: async (key: string) => store.get(key),
  set: async (key: string, value: unknown) => { store.set(key, value); },
  del: async (key: string) => { store.delete(key); },
  keys: async () => [...store.keys()],
}));

// ── import after mock registration ────────────────────────────────────────
import {
  getOfflineTideValue,
  getPackForLocation,
  listOfflinePacks,
  deleteOfflinePack,
  getExpiringPacks,
  type OfflinePack,
  type TideHeightPrediction,
} from "@/lib/offlinePackStore";

// ── helpers ───────────────────────────────────────────────────────────────
function makeHeightPred(isoTime: string, v: number): TideHeightPrediction {
  return { t: isoTime, v };
}

function makePack(
  id: string,
  opts: {
    centerLat?: number;
    centerLon?: number;
    tidalExpiresAt?: string;
    heightPredictions?: TideHeightPrediction[];
  } = {},
): OfflinePack {
  return {
    id,
    datasetId: `ds-${id}`,
    datasetName: `Dataset ${id}`,
    bbox: { minLon: -70, maxLon: -69, minLat: 42, maxLat: 43 },
    centerLat: opts.centerLat ?? 42.5,
    centerLon: opts.centerLon ?? -69.5,
    savedAt: new Date().toISOString(),
    terrainUrl: `/api/terrain/${id}`,
    overviewUrl: `/api/overview/${id}`,
    tidePack: {
      station: "TEST",
      heightPredictions: opts.heightPredictions ?? [],
      currentPredictions: [],
      tidalExpiresAt: opts.tidalExpiresAt ?? new Date(Date.now() + 7 * 86400_000).toISOString(),
      generatedAt: new Date().toISOString(),
    },
    weatherPack: {
      station: "TEST",
      observation: null,
      snapshotAt: new Date().toISOString(),
    },
    storageBytesEstimate: 1_000_000,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  store.clear();
});

describe("getOfflineTideValue — height interpolation", () => {
  it("returns 0 when no predictions", () => {
    const pack = makePack("a", { heightPredictions: [] });
    const val = getOfflineTideValue(pack, new Date());
    expect(val.tideHeight).toBe(0);
    expect(val.source).toBe("pack");
  });

  it("returns the only prediction when exactly one exists", () => {
    const t = "2026-01-01T12:00:00Z";
    const pack = makePack("a", { heightPredictions: [makeHeightPred(t, 2.5)] });
    const val = getOfflineTideValue(pack, new Date(t));
    expect(val.tideHeight).toBe(2.5);
  });

  it("interpolates between two bracket predictions", () => {
    const base = new Date("2026-01-01T12:00:00Z").getTime();
    const preds: TideHeightPrediction[] = [
      { t: new Date(base).toISOString(), v: 1.0 },
      { t: new Date(base + 60 * 60_000).toISOString(), v: 3.0 },
    ];
    const pack = makePack("a", { heightPredictions: preds });
    // midpoint → should be linearly interpolated to 2.0
    const mid = new Date(base + 30 * 60_000);
    const val = getOfflineTideValue(pack, mid);
    expect(val.tideHeight).toBeCloseTo(2.0, 4);
  });

  it("clamps to earliest prediction for times before range", () => {
    const base = new Date("2026-01-01T12:00:00Z").getTime();
    const preds: TideHeightPrediction[] = [
      { t: new Date(base).toISOString(), v: 1.5 },
      { t: new Date(base + 3600_000).toISOString(), v: 2.5 },
    ];
    const pack = makePack("a", { heightPredictions: preds });
    const before = new Date(base - 3600_000);
    const val = getOfflineTideValue(pack, before);
    expect(val.tideHeight).toBe(1.5);
  });

  it("clamps to latest prediction for times after range", () => {
    const base = new Date("2026-01-01T12:00:00Z").getTime();
    const preds: TideHeightPrediction[] = [
      { t: new Date(base).toISOString(), v: 1.0 },
      { t: new Date(base + 3600_000).toISOString(), v: 3.0 },
    ];
    const pack = makePack("a", { heightPredictions: preds });
    const after = new Date(base + 7200_000);
    const val = getOfflineTideValue(pack, after);
    expect(val.tideHeight).toBe(3.0);
  });
});

describe("listOfflinePacks / deleteOfflinePack", () => {
  it("lists all packs stored with the prefix key", async () => {
    const { set } = await import("idb-keyval");
    await set("offline-pack-aaa", makePack("aaa"));
    await set("offline-pack-bbb", makePack("bbb"));
    await set("something-else", { junk: true });

    const packs = await listOfflinePacks();
    expect(packs).toHaveLength(2);
    expect(packs.map((p) => p.id).sort()).toEqual(["aaa", "bbb"]);
  });

  it("deleteOfflinePack removes only that key", async () => {
    const { set } = await import("idb-keyval");
    await set("offline-pack-x1", makePack("x1"));
    await set("offline-pack-x2", makePack("x2"));

    await deleteOfflinePack("x1");

    const packs = await listOfflinePacks();
    expect(packs).toHaveLength(1);
    expect(packs[0]!.id).toBe("x2");
  });
});

describe("getPackForLocation", () => {
  it("returns null when no packs exist", async () => {
    const result = await getPackForLocation(42.5, -69.5);
    expect(result).toBeNull();
  });

  it("returns the nearest pack within 200 km threshold", async () => {
    const { set } = await import("idb-keyval");
    // Pack at 42.5 N, 69.5 W — exactly the query point
    await set("offline-pack-near", makePack("near", { centerLat: 42.5, centerLon: -69.5 }));
    // Pack far away (Hawaii)
    await set("offline-pack-far", makePack("far", { centerLat: 21.0, centerLon: -157.0 }));

    const result = await getPackForLocation(42.5, -69.5);
    expect(result?.id).toBe("near");
  });

  it("returns null if no pack is within the 200 km threshold", async () => {
    const { set } = await import("idb-keyval");
    await set("offline-pack-far", makePack("far", { centerLat: 21.0, centerLon: -157.0 }));

    const result = await getPackForLocation(42.5, -69.5);
    expect(result).toBeNull();
  });
});

describe("getExpiringPacks", () => {
  it("returns packs expiring within the given hours window", async () => {
    const { set } = await import("idb-keyval");
    const soonIso = new Date(Date.now() + 24 * 3600_000).toISOString();   // 24 h away
    const laterIso = new Date(Date.now() + 10 * 86400_000).toISOString(); // 10 days away

    await set("offline-pack-soon", makePack("soon", { tidalExpiresAt: soonIso }));
    await set("offline-pack-later", makePack("later", { tidalExpiresAt: laterIso }));

    const expiring = await getExpiringPacks(48);
    expect(expiring).toHaveLength(1);
    expect(expiring[0]!.id).toBe("soon");
  });

  it("returns empty array when no packs are stored", async () => {
    const expiring = await getExpiringPacks(48);
    expect(expiring).toHaveLength(0);
  });
});
