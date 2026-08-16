/**
 * offlinePackStore — dataset markers bundled into offline packs.
 *
 * Covers:
 *   - Markers fetched at save time are stored in the OfflinePack record and
 *     shipped to the SW via CACHE_PACK_MARKERS (persistent pack cache).
 *   - The marker URL byte-matches the generated API client's URL so the SW
 *     cache key lines up with runtime marker requests.
 *   - Marker fetch failure is best-effort: markersPack is [] and the save
 *     still completes (same policy as weather).
 *   - The storage estimate includes the serialized marker payload bytes.
 *   - deleteOfflinePack sends DELETE_PACK_CACHE including the marker URL.
 *   - Rollback after a post-terrain failure includes the marker URL.
 *   - Old packs without markersPack keep loading (graceful nil-check).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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
  deleteOfflinePack,
  listOfflinePacks,
  markersUrlForDataset,
  estimatePackStorageBytesFromBbox,
  type OfflinePack,
  type PackProgress,
} from "@/lib/offlinePackStore";
import { getGetMarkersUrl } from "@workspace/api-client-react";

// ── fixtures ────────────────────────────────────────────────────────────────

const MARKERS_PAYLOAD = [
  { id: "m1", datasetId: "ds-1", label: "Reef edge", lat: 42.5, lon: -69.5 },
  { id: "m2", datasetId: "ds-1", label: "Drop-off", lat: 42.6, lon: -69.6 },
];

const BBOX = { minLon: -70, maxLon: -69, minLat: 42, maxLat: 43 };

// ── SW / fetch stubs (same pattern as offlinePackStore.idbFailure.test.ts) ──

const swMessages: unknown[] = [];
const origNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

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

beforeEach(() => {
  store.clear();
});

function stubSw(): void {
  let capturedPort1: { onmessage: ((e: MessageEvent) => void) | null } | null = null;

  vi.stubGlobal("MessageChannel", function (this: unknown) {
    capturedPort1 = { onmessage: null };
    return { port1: capturedPort1, port2: {} };
  });

  const postMessageSpy = vi.fn().mockImplementation((msg: unknown) => {
    swMessages.push(msg);
    // Reply ok:true on next microtask (CACHE_PACK, CACHE_PACK_MARKERS,
    // and DELETE_PACK_CACHE all accept the same ack shape).
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
}

type MarkersBehaviour = "ok" | "http500" | "reject";

function stubFetch(markers: MarkersBehaviour): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/tidal/")) {
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
      if (u.includes("/api/markers")) {
        if (markers === "reject") return Promise.reject(new Error("network down"));
        if (markers === "http500") {
          return Promise.resolve({ ok: false, status: 500, text: async () => "boom" });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(MARKERS_PAYLOAD),
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

function findMessage<T extends { type: string }>(type: string): T | undefined {
  return swMessages.find(
    (m): m is T =>
      typeof m === "object" &&
      m !== null &&
      (m as Record<string, unknown>)["type"] === type,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// URL contract
// ─────────────────────────────────────────────────────────────────────────────

describe("markersUrlForDataset", () => {
  it("byte-matches the generated API client URL (SW cache-key contract)", () => {
    // If this drifts, the SW pack cache is keyed on a URL the app never
    // requests and offline markers silently disappear.
    expect(markersUrlForDataset("ds-1")).toBe(getGetMarkersUrl({ datasetId: "ds-1" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Save — markers success path
// ─────────────────────────────────────────────────────────────────────────────

describe("saveOfflinePack — markers success", () => {
  it("stores the fetched markers in the OfflinePack record", async () => {
    stubSw();
    stubFetch("ok");

    const pack = await saveOfflinePack({ id: "ds-1", name: "Dataset One", bbox: BBOX }, 3, () => {});

    expect(pack.markersPack).toEqual(MARKERS_PAYLOAD);
    const [persisted] = await listOfflinePacks();
    expect(persisted?.markersPack).toEqual(MARKERS_PAYLOAD);
  });

  it("sends CACHE_PACK_MARKERS with the exact marker URL and serialized body", async () => {
    stubSw();
    stubFetch("ok");

    await saveOfflinePack({ id: "ds-1", name: "Dataset One", bbox: BBOX }, 3, () => {});

    const msg = findMessage<{ type: string; markersUrl: string; body: string }>(
      "CACHE_PACK_MARKERS",
    );
    expect(msg).toBeDefined();
    // In vitest, import.meta.env.BASE_URL defaults to "/" so API_BASE is "".
    expect(msg?.markersUrl).toBe("/api/markers?datasetId=ds-1");
    expect(msg?.body).toBe(JSON.stringify(MARKERS_PAYLOAD));
  });

  it("adds the serialized marker byte length to the storage estimate", async () => {
    stubSw();
    stubFetch("ok");

    const pack = await saveOfflinePack({ id: "ds-1", name: "Dataset One", bbox: BBOX }, 3, () => {});

    const base = estimatePackStorageBytesFromBbox({ bbox: BBOX });
    const markerBytes = new TextEncoder().encode(JSON.stringify(MARKERS_PAYLOAD)).length;
    expect(pack.storageBytesEstimate).toBe(base + markerBytes);
  });

  it("emits a terminal done markers progress event without error", async () => {
    stubSw();
    stubFetch("ok");

    const events: PackProgress[] = [];
    await saveOfflinePack({ id: "ds-1", name: "Dataset One", bbox: BBOX }, 3, (p) => events.push(p));

    const terminal = events.filter((p) => p.step === "markers" && p.done);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]?.error).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Save — markers failure is best-effort
// ─────────────────────────────────────────────────────────────────────────────

describe.each<MarkersBehaviour>(["reject", "http500"])(
  "saveOfflinePack — markers failure (%s)",
  (behaviour) => {
    it("stores markersPack: [] and still completes the save", async () => {
      stubSw();
      stubFetch(behaviour);

      const pack = await saveOfflinePack(
        { id: "ds-1", name: "Dataset One", bbox: BBOX },
        3,
        () => {},
      );

      expect(pack.markersPack).toEqual([]);
      const [persisted] = await listOfflinePacks();
      expect(persisted?.markersPack).toEqual([]);
    });

    it("leaves the storage estimate at the bbox estimate (no marker bytes)", async () => {
      stubSw();
      stubFetch(behaviour);

      const pack = await saveOfflinePack(
        { id: "ds-1", name: "Dataset One", bbox: BBOX },
        3,
        () => {},
      );
      expect(pack.storageBytesEstimate).toBe(estimatePackStorageBytesFromBbox({ bbox: BBOX }));
    });

    it("does not send CACHE_PACK_MARKERS and emits a terminal done event without error", async () => {
      stubSw();
      stubFetch(behaviour);

      const events: PackProgress[] = [];
      await saveOfflinePack(
        { id: "ds-1", name: "Dataset One", bbox: BBOX },
        3,
        (p) => events.push(p),
      );

      expect(findMessage("CACHE_PACK_MARKERS")).toBeUndefined();
      const terminal = events.find((p) => p.step === "markers" && p.done);
      expect(terminal).toBeDefined();
      // Best-effort: the omission is surfaced in the label, never as an error.
      expect(terminal?.error).toBeUndefined();
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Rollback — post-terrain failure cleans up the marker cache entry
// ─────────────────────────────────────────────────────────────────────────────

describe("saveOfflinePack — rollback includes marker URL", () => {
  it("sends DELETE_PACK_CACHE with markersUrl when idb set() fails", async () => {
    stubSw();
    stubFetch("ok");
    const idb = await import("idb-keyval");
    vi.spyOn(idb, "set").mockRejectedValueOnce(new Error("QuotaExceededError"));

    await saveOfflinePack(
      { id: "ds-rollback", name: "Rollback Dataset", bbox: BBOX },
      3,
      () => {},
    ).catch(() => {});

    const msg = findMessage<{ type: string; markersUrl?: string }>("DELETE_PACK_CACHE");
    expect(msg).toBeDefined();
    expect(msg?.markersUrl).toBe("/api/markers?datasetId=ds-rollback");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Delete — pack deletion removes the cached marker response
// ─────────────────────────────────────────────────────────────────────────────

describe("deleteOfflinePack — marker cache cleanup", () => {
  it("sends DELETE_PACK_CACHE with terrain, overview, and marker URLs, then removes the record", async () => {
    stubSw();
    stubFetch("ok");

    const pack = await saveOfflinePack(
      { id: "ds-del", name: "Delete Me", bbox: BBOX },
      3,
      () => {},
    );
    swMessages.length = 0;

    await deleteOfflinePack(pack.id);

    const msg = findMessage<{
      type: string;
      terrainUrl: string;
      overviewUrl: string;
      markersUrl?: string;
    }>("DELETE_PACK_CACHE");
    expect(msg).toBeDefined();
    expect(msg?.terrainUrl).toBe("/api/datasets/ds-del/terrain");
    expect(msg?.overviewUrl).toBe("/api/datasets/ds-del/overview");
    expect(msg?.markersUrl).toBe("/api/markers?datasetId=ds-del");

    expect(await listOfflinePacks()).toHaveLength(0);
  });

  it("still deletes the IDB record when no SW is available", async () => {
    // jsdom navigator has no serviceWorker — deletePackCache early-returns.
    const legacy = makeLegacyPack("legacy-1");
    store.set("offline-pack-legacy-1", legacy);

    await deleteOfflinePack("legacy-1");
    expect(store.has("offline-pack-legacy-1")).toBe(false);
  });

  it("is a no-op message-wise when the pack record does not exist", async () => {
    stubSw();
    await deleteOfflinePack("does-not-exist");
    expect(findMessage("DELETE_PACK_CACHE")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Backwards compatibility — packs saved before markersPack existed
// ─────────────────────────────────────────────────────────────────────────────

function makeLegacyPack(id: string): OfflinePack {
  // Deliberately no markersPack field — shape of a pre-change pack.
  return {
    id,
    datasetId: `ds-${id}`,
    datasetName: `Dataset ${id}`,
    bbox: BBOX,
    centerLat: 42.5,
    centerLon: -69.5,
    savedAt: new Date().toISOString(),
    terrainUrl: `/api/datasets/ds-${id}/terrain`,
    overviewUrl: `/api/datasets/ds-${id}/overview`,
    tidePack: {
      station: "TEST",
      heightPredictions: [],
      currentPredictions: [],
      tidalExpiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      generatedAt: new Date().toISOString(),
    },
    weatherPack: { station: null, observation: null, snapshotAt: new Date().toISOString() },
    storageBytesEstimate: 1_000_000,
  };
}

describe("legacy packs without markersPack", () => {
  it("load without error and nil-check to an empty marker list", async () => {
    store.set("offline-pack-old", makeLegacyPack("old"));

    const packs = await listOfflinePacks();
    expect(packs).toHaveLength(1);
    expect(packs[0]?.markersPack).toBeUndefined();
    // The read-path convention for all consumers:
    expect(packs[0]?.markersPack ?? []).toEqual([]);
  });
});
