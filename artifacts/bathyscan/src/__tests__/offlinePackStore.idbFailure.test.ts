/**
 * offlinePackStore — IDB write failure + expiry-filter regression tests.
 *
 * Covers:
 *   - Step 24: IDB set() rejection → user-readable error, terrain cache cleanup, no IDB artifact
 *   - Step 25: getPackForLocation ignores expired packs, prefers a fresh far pack over an expired near one
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── idb-keyval mock ─────────────────────────────────────────────────────────
const store = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  get: async (key: string) => store.get(key),
  set: async (key: string, value: unknown) => { store.set(key, value); },
  del: async (key: string) => { store.delete(key); },
  keys: async () => [...store.keys()],
}));

// ── imports after mocks ─────────────────────────────────────────────────────
import {
  saveOfflinePack,
  listOfflinePacks,
  getPackForLocation,
  isPackExpired,
  type OfflinePack,
  type PackProgress,
} from "@/lib/offlinePackStore";

// ── helpers ─────────────────────────────────────────────────────────────────
function makePack(id: string, opts: {
  centerLat?: number;
  centerLon?: number;
  tidalExpiresAt?: string;
} = {}): OfflinePack {
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
      heightPredictions: [],
      currentPredictions: [],
      tidalExpiresAt: opts.tidalExpiresAt ?? new Date(Date.now() + 7 * 86400_000).toISOString(),
      generatedAt: new Date().toISOString(),
    },
    weatherPack: { station: null, observation: null, snapshotAt: new Date().toISOString() },
    storageBytesEstimate: 1_000_000,
  };
}

beforeEach(() => {
  store.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 24 — IDB write failure
// ─────────────────────────────────────────────────────────────────────────────

describe("saveOfflinePack — IDB set() failure", () => {
  const origNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const swMessages: unknown[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (origNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", origNavigatorDescriptor);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).navigator;
    }
    swMessages.length = 0;
  });

  function stubSwAndFetch(): void {
    let capturedPort1: { onmessage: ((e: MessageEvent) => void) | null } | null = null;

    vi.stubGlobal("MessageChannel", function (this: unknown) {
      capturedPort1 = { onmessage: null };
      return { port1: capturedPort1, port2: {} };
    });

    const postMessageSpy = vi.fn().mockImplementation((msg: unknown) => {
      swMessages.push(msg);
      // Reply ok:true on next microtask (works for both CACHE_PACK and DELETE_PACK_CACHE).
      Promise.resolve().then(() => {
        capturedPort1?.onmessage?.({ data: { ok: true } } as MessageEvent);
      });
    });

    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          ready: Promise.resolve({ active: { postMessage: postMessageSpy } }),
        },
      },
      configurable: true,
      writable: true,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/tidal/")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              station: "TEST",
              heightPredictions: [],
              currentPredictions: [],
              tidalExpiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
              generatedAt: new Date().toISOString(),
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            station: null,
            observation: null,
            snapshotAt: new Date().toISOString(),
          }),
        });
      }),
    );
  }

  it("throws a user-readable error when idb set() rejects", async () => {
    stubSwAndFetch();
    const idb = await import("idb-keyval");
    vi.spyOn(idb, "set").mockRejectedValueOnce(new Error("QuotaExceededError"));

    const events: PackProgress[] = [];
    await expect(
      saveOfflinePack(
        { id: "ds-idb-fail", name: "IDB Fail Dataset" },
        3,
        (p) => events.push(p),
      ),
    ).rejects.toThrow(/storage/i);
  });

  it("emits a saving step error event when idb set() rejects", async () => {
    stubSwAndFetch();
    const idb = await import("idb-keyval");
    vi.spyOn(idb, "set").mockRejectedValueOnce(new Error("QuotaExceededError"));

    const events: PackProgress[] = [];
    await saveOfflinePack(
      { id: "ds-idb-fail-event", name: "IDB Fail Event Dataset" },
      3,
      (p) => events.push(p),
    ).catch(() => {});

    const savingError = events.find((p) => p.step === "saving" && p.error !== undefined);
    expect(savingError).toBeDefined();
    expect(savingError?.error).toMatch(/storage/i);
  });

  it("sends DELETE_PACK_CACHE to the SW when idb set() fails (terrain cleanup)", async () => {
    stubSwAndFetch();
    const idb = await import("idb-keyval");
    vi.spyOn(idb, "set").mockRejectedValueOnce(new Error("QuotaExceededError"));

    await saveOfflinePack(
      { id: "ds-idb-cleanup", name: "IDB Cleanup Dataset" },
      3,
      () => {},
    ).catch(() => {});

    await vi.waitFor(() =>
      expect(
        swMessages.find(
          (m): m is { type: string } =>
            typeof m === "object" &&
            m !== null &&
            (m as Record<string, unknown>)["type"] === "DELETE_PACK_CACHE",
        ),
      ).toBeDefined(),
    );
    const deleteMsg = swMessages.find(
      (m): m is { type: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as Record<string, unknown>)["type"] === "DELETE_PACK_CACHE",
    );
    expect(deleteMsg).toBeDefined();
  });

  it("sends DELETE_PACK_CACHE with the exact terrainUrl and overviewUrl that were cached", async () => {
    stubSwAndFetch();
    const idb = await import("idb-keyval");
    vi.spyOn(idb, "set").mockRejectedValueOnce(new Error("QuotaExceededError"));

    const datasetId = "ds-url-payload-check";

    await saveOfflinePack(
      { id: datasetId, name: "URL Payload Check Dataset" },
      3,
      () => {},
    ).catch(() => {});

    await vi.waitFor(() =>
      expect(
        swMessages.find(
          (m): m is { type: string; terrainUrl: string; overviewUrl: string } =>
            typeof m === "object" &&
            m !== null &&
            (m as Record<string, unknown>)["type"] === "DELETE_PACK_CACHE",
        ),
      ).toBeDefined(),
    );
    const deleteMsg = swMessages.find(
      (m): m is { type: string; terrainUrl: string; overviewUrl: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as Record<string, unknown>)["type"] === "DELETE_PACK_CACHE",
    );

    expect(deleteMsg).toBeDefined();
    // The store builds URLs as: `${API_BASE}/api/datasets/${id}/terrain`
    // In vitest, import.meta.env.BASE_URL defaults to "/" so API_BASE is "".
    expect(deleteMsg?.terrainUrl).toBe(`/api/datasets/${datasetId}/terrain`);
    expect(deleteMsg?.overviewUrl).toBe(`/api/datasets/${datasetId}/overview`);
  });

  it("sends CACHE_PACK with the exact terrainUrl and overviewUrl for the dataset", async () => {
    stubSwAndFetch();
    // Do NOT mock idb.set() to fail — let the save succeed so we can inspect CACHE_PACK.

    const datasetId = "ds-cache-pack-url-check";

    await saveOfflinePack(
      { id: datasetId, name: "CACHE_PACK URL Check Dataset" },
      3,
      () => {},
    );

    const cacheMsg = swMessages.find(
      (m): m is { type: string; terrainUrl: string; overviewUrl: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as Record<string, unknown>)["type"] === "CACHE_PACK",
    );

    expect(cacheMsg).toBeDefined();
    // The store builds URLs as: `${API_BASE}/api/datasets/${id}/terrain`
    // In vitest, import.meta.env.BASE_URL defaults to "/" so API_BASE is "".
    expect(cacheMsg?.terrainUrl).toBe(`/api/datasets/${datasetId}/terrain`);
    expect(cacheMsg?.overviewUrl).toBe(`/api/datasets/${datasetId}/overview`);
  });

  it("leaves no pack record in IDB when set() rejects", async () => {
    stubSwAndFetch();
    const idb = await import("idb-keyval");
    vi.spyOn(idb, "set").mockRejectedValueOnce(new Error("QuotaExceededError"));

    await saveOfflinePack(
      { id: "ds-idb-no-leak", name: "IDB No Leak Dataset" },
      3,
      () => {},
    ).catch(() => {});

    const packs = await listOfflinePacks();
    expect(packs).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 25 — getPackForLocation expiry filter
// ─────────────────────────────────────────────────────────────────────────────

describe("getPackForLocation — expired packs are excluded", () => {
  it("returns a fresh far pack over an expired nearby pack", async () => {
    const { set } = await import("idb-keyval");

    // Expired pack right at the query point (would win by distance without the filter)
    const expiredNear = makePack("expired-near", {
      centerLat: 42.5,
      centerLon: -69.5,
      tidalExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    // Fresh pack ~160 km away — within the 200 km threshold
    const freshFar = makePack("fresh-far", {
      centerLat: 43.9,
      centerLon: -70.5,
      tidalExpiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    });

    await set("offline-pack-expired-near", expiredNear);
    await set("offline-pack-fresh-far", freshFar);

    // Sanity: verify the expired one is actually expired
    expect(isPackExpired(expiredNear)).toBe(true);
    expect(isPackExpired(freshFar)).toBe(false);

    const result = await getPackForLocation(42.5, -69.5);
    expect(result?.id).toBe("fresh-far");
  });

  it("returns null when the only pack within 200 km is expired", async () => {
    const { set } = await import("idb-keyval");

    const expired = makePack("expired-only", {
      centerLat: 42.5,
      centerLon: -69.5,
      tidalExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await set("offline-pack-expired-only", expired);

    const result = await getPackForLocation(42.5, -69.5);
    expect(result).toBeNull();
  });

  it("returns a fresh pack at the same location when not expired", async () => {
    const { set } = await import("idb-keyval");

    const fresh = makePack("fresh-near", {
      centerLat: 42.5,
      centerLon: -69.5,
      tidalExpiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    });
    await set("offline-pack-fresh-near", fresh);

    const result = await getPackForLocation(42.5, -69.5);
    expect(result?.id).toBe("fresh-near");
  });

  it("returns null when store is empty", async () => {
    const result = await getPackForLocation(42.5, -69.5);
    expect(result).toBeNull();
  });
});
