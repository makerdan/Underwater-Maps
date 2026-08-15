/**
 * "Clear all cache" scope regression tests (task: ClearAll safety).
 *
 * Guards the destructive-action boundary: clearTerrainCaches must delete ONLY
 * caches owned by the terrain-data feature (never offline packs, help packs,
 * or unrelated caches), and clearPendingSyncQueue must issue targeted deletes
 * instead of wiping the whole idb-keyval store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const idb = vi.hoisted(() => ({
  keys: vi.fn<() => Promise<unknown[]>>(() => Promise.resolve([])),
  del: vi.fn(() => Promise.resolve()),
  clear: vi.fn(() => Promise.resolve()),
  get: vi.fn(() => Promise.resolve(null)),
  set: vi.fn(() => Promise.resolve()),
}));
vi.mock("idb-keyval", () => idb);

import {
  isClearAllTargetCache,
  clearTerrainCaches,
  clearPendingSyncQueue,
} from "../constants";

const mockCachesDelete = vi.fn(() => Promise.resolve(true));
const mockCachesKeys = vi.fn<() => Promise<string[]>>(() => Promise.resolve([]));

function installCachesMock() {
  Object.defineProperty(window, "caches", {
    value: { keys: mockCachesKeys, delete: mockCachesDelete },
    writable: true,
    configurable: true,
  });
}

function removeCachesMock() {
  // Simulate a browser without Cache Storage.
  delete (window as { caches?: unknown }).caches;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  installCachesMock();
});

afterEach(() => {
  installCachesMock();
});

describe("isClearAllTargetCache", () => {
  it("matches feature-owned caches", () => {
    for (const name of [
      "api-terrain",
      "api-overview",
      "bathyscan-terrain-tiles",
      "bathyscan-satellite-tiles",
      "bathyscan-v1a2b3c-api-terrain",
      "bathyscan-v1a2b3c-api-overview",
      "bathyscan-v1a2b3c-api-datasets",
      // parity with the listCachedDatasets card filter
      "terrain-v1",
    ]) {
      expect(isClearAllTargetCache(name), name).toBe(true);
    }
  });

  it("never matches user-saved pack caches or unrelated caches", () => {
    for (const name of [
      "bathyscan-pack-terrain", // offline packs — user-saved
      "bathyscan-pack-help", // help content — user-saved
      "bathyscan-v1a2b3c-api-markers",
      "workbox-precache-v2-https://example.test/",
      "some-other-app-cache",
    ]) {
      expect(isClearAllTargetCache(name), name).toBe(false);
    }
  });
});

describe("clearTerrainCaches", () => {
  it("deletes only feature-owned caches", async () => {
    const names = [
      "bathyscan-v1a2b3c-api-terrain",
      "bathyscan-v1a2b3c-api-overview",
      "bathyscan-v1a2b3c-api-datasets",
      "bathyscan-v1a2b3c-api-markers",
      "bathyscan-terrain-tiles",
      "bathyscan-satellite-tiles",
      "bathyscan-pack-terrain",
      "bathyscan-pack-help",
      "workbox-precache-v2-https://example.test/",
    ];
    mockCachesKeys.mockResolvedValue(names);

    const result = await clearTerrainCaches();

    expect(result).toBe(true);
    const deleted = mockCachesDelete.mock.calls.map((c) => c[0]).sort();
    expect(deleted).toEqual(
      [
        "bathyscan-v1a2b3c-api-terrain",
        "bathyscan-v1a2b3c-api-overview",
        "bathyscan-v1a2b3c-api-datasets",
        "bathyscan-terrain-tiles",
        "bathyscan-satellite-tiles",
      ].sort(),
    );
    expect(deleted).not.toContain("bathyscan-pack-terrain");
    expect(deleted).not.toContain("bathyscan-pack-help");
  });

  it("returns false without touching anything when Cache Storage is unavailable", async () => {
    removeCachesMock();
    const result = await clearTerrainCaches();
    expect(result).toBe(false);
    expect(mockCachesDelete).not.toHaveBeenCalled();
  });
});

describe("clearPendingSyncQueue", () => {
  it("issues targeted IDB deletes for pending-marker keys only — never a full clear", async () => {
    idb.keys.mockResolvedValue([
      "pending-marker-1",
      "pending-marker-2",
      "offline-pack-abc",
      "offline-help-pack",
      "env-pack-v1",
      42, // non-string keys must be ignored
    ]);

    await clearPendingSyncQueue();

    expect(idb.clear).not.toHaveBeenCalled();
    const deleted = idb.del.mock.calls.map((c) => c[0]);
    expect(deleted.sort()).toEqual(["pending-marker-1", "pending-marker-2"]);
  });

  it("removes only pending-trail-* localStorage keys", async () => {
    idb.keys.mockResolvedValue([]);
    localStorage.setItem("pending-trail-1", "x");
    localStorage.setItem("pending-trail-2", "y");
    localStorage.setItem("bathyscan-settings", "keep");
    localStorage.setItem("unrelated", "keep");

    await clearPendingSyncQueue();

    expect(localStorage.getItem("pending-trail-1")).toBeNull();
    expect(localStorage.getItem("pending-trail-2")).toBeNull();
    expect(localStorage.getItem("bathyscan-settings")).toBe("keep");
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("works when Cache Storage is unavailable (independent stores)", async () => {
    removeCachesMock();
    idb.keys.mockResolvedValue(["pending-marker-1"]);
    localStorage.setItem("pending-trail-1", "x");

    await clearPendingSyncQueue();

    expect(idb.del).toHaveBeenCalledWith("pending-marker-1");
    expect(localStorage.getItem("pending-trail-1")).toBeNull();
  });
});
