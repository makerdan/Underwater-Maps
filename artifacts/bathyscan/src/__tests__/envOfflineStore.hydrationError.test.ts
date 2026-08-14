/**
 * envOfflineStore — IDB hydration error regression tests.
 *
 * Covers Step 26: when idb-keyval.get() throws during loadFromIdb(),
 * the store must set idbHydrationError:true instead of silently acting empty.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── idb-keyval mock — starts with healthy stubs, overridden per-test ─────────
vi.mock("idb-keyval", () => ({
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
  keys: vi.fn().mockResolvedValue([]),
}));

// ── Module import after mock (module auto-calls loadFromIdb, but we re-call
//    it after overriding the mock to simulate boot-time IDB failure) ─────────
import { useEnvOfflineStore } from "@/lib/envOfflineStore";

beforeEach(() => {
  // Reset the store to a clean state before each test.
  useEnvOfflineStore.setState({
    envPack: null,
    isDownloading: false,
    downloadError: null,
    idbHydrationError: false,
  });
  vi.restoreAllMocks();
});

describe("envOfflineStore — loadFromIdb error handling", () => {
  it("sets idbHydrationError:true when idb get() throws", async () => {
    const idb = await import("idb-keyval");
    vi.mocked(idb.get).mockRejectedValueOnce(new Error("IDBDatabase: not available"));

    await useEnvOfflineStore.getState().loadFromIdb();

    expect(useEnvOfflineStore.getState().idbHydrationError).toBe(true);
  });

  it("leaves envPack null when idb get() throws", async () => {
    const idb = await import("idb-keyval");
    vi.mocked(idb.get).mockRejectedValueOnce(new Error("IDBDatabase: not available"));

    await useEnvOfflineStore.getState().loadFromIdb();

    expect(useEnvOfflineStore.getState().envPack).toBeNull();
  });

  it("does not set idbHydrationError when idb returns undefined (no pack saved)", async () => {
    const idb = await import("idb-keyval");
    vi.mocked(idb.get).mockResolvedValueOnce(undefined);

    await useEnvOfflineStore.getState().loadFromIdb();

    expect(useEnvOfflineStore.getState().idbHydrationError).toBe(false);
  });

  it("does not set idbHydrationError when idb returns a valid pack", async () => {
    const idb = await import("idb-keyval");
    const fakePack = {
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      centerLat: 57.05,
      centerLon: -135.33,
      coverageRadiusMiles: 15,
      tideStations: null,
      weatherStations: null,
      marineConditions: null,
      temperatureProfile: null,
      warnings: [],
    };
    vi.mocked(idb.get).mockResolvedValueOnce(fakePack);

    await useEnvOfflineStore.getState().loadFromIdb();

    expect(useEnvOfflineStore.getState().idbHydrationError).toBe(false);
    expect(useEnvOfflineStore.getState().envPack).toEqual(fakePack);
  });
});
