/**
 * envOfflineStore unit tests.
 *
 * Covers: CRUD operations, downloadEnvPack action (mock fetch),
 * clearEnvPack, loadFromIdb, isExpired selector.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { EnvPack } from "@/lib/envPackTypes";

// ── idb-keyval mock ──────────────────────────────────────────────────────────

const idbStore: Map<string, unknown> = new Map();

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (k: string) => idbStore.get(k) ?? undefined),
  set: vi.fn(async (k: string, v: unknown) => { idbStore.set(k, v); }),
  del: vi.fn(async (k: string) => { idbStore.delete(k); }),
}));

// ── Module import (after mocks) ───────────────────────────────────────────────

// We import the store AFTER the mock so idb-keyval is already stubbed.
// The store's module-level loadFromIdb() call in the real module fires during
// import; the IDB map starts empty so it's a no-op.
import {
  useEnvOfflineStore,
  ENV_PACK_IDB_KEY,
  getEnvPackTideStation,
  getEnvPackWeatherStation,
  getEnvPackTideHeight,
} from "@/lib/envOfflineStore";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePack(overrides: Partial<EnvPack> = {}): EnvPack {
  return {
    generatedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    centerLat: 57.05,
    centerLon: -135.33,
    coverageRadiusMiles: 15,
    tideStations: [
      {
        stationId: "9452210",
        name: "Juneau",
        lat: 58.3,
        lon: -134.41,
        distanceMiles: 8,
        windowStart: new Date(Date.now() - 3600_000).toISOString(),
        windowEnd: new Date(Date.now() + 14 * 24 * 3600_000).toISOString(),
        datum: "MLLW",
        units: "feet",
        predictions: [
          { t: new Date(Date.now() - 3600_000).toISOString(), v: 3.0 },
          { t: new Date(Date.now() + 3600_000).toISOString(), v: 6.0 },
        ],
        datums: null,
      },
    ],
    weatherStations: [
      {
        id: "PAJN",
        name: "Juneau",
        lat: 58.35,
        lon: -134.57,
        windSpeedKnots: 10,
        windDirDeg: 270,
        visibilityMiles: 10,
        ceilingFt: 3000,
        tempC: 8,
        observedAt: new Date(Date.now() - 3600_000).toISOString(),
        hourlyForecast: null,
      },
    ],
    marineConditions: {
      times: [new Date().toISOString()],
      seaSurfaceTemperatureC: [9.5],
      waveHeightM: [0.5],
      waveDirectionDeg: [200],
    },
    temperatureProfile: {
      available: true,
      samples: [
        { depthM: 0, temperatureC: 9.5 },
        { depthM: 10, temperatureC: 8.0 },
      ],
      source: "ROMS",
      sourceUrl: null,
      timestamp: new Date().toISOString(),
      provider: "HYCOM",
    },
    warnings: [],
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetStore() {
  idbStore.clear();
  useEnvOfflineStore.setState({
    envPack: null,
    isDownloading: false,
    downloadError: null,
    idbHydrationError: false,
    isHydrating: false,
    deleteError: null,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("envOfflineStore", () => {
  beforeEach(() => {
    resetStore();
    vi.restoreAllMocks();
  });

  describe("initial state", () => {
    it("starts with envPack null", () => {
      expect(useEnvOfflineStore.getState().envPack).toBeNull();
    });

    it("starts not downloading", () => {
      expect(useEnvOfflineStore.getState().isDownloading).toBe(false);
    });

    it("starts with no error", () => {
      expect(useEnvOfflineStore.getState().downloadError).toBeNull();
    });
  });

  describe("isExpired()", () => {
    it("returns false when no pack is stored", () => {
      expect(useEnvOfflineStore.getState().isExpired()).toBe(false);
    });

    it("returns false when the pack has not expired", () => {
      const pack = makePack();
      useEnvOfflineStore.setState({ envPack: pack });
      expect(useEnvOfflineStore.getState().isExpired()).toBe(false);
    });

    it("returns true when the pack's expiresAt is in the past", () => {
      const pack = makePack({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      useEnvOfflineStore.setState({ envPack: pack });
      expect(useEnvOfflineStore.getState().isExpired()).toBe(true);
    });
  });

  describe("loadFromIdb()", () => {
    it("populates envPack from IndexedDB", async () => {
      const pack = makePack();
      idbStore.set(ENV_PACK_IDB_KEY, pack);
      await useEnvOfflineStore.getState().loadFromIdb();
      expect(useEnvOfflineStore.getState().envPack).toEqual(pack);
    });

    it("leaves envPack null when IDB has nothing", async () => {
      await useEnvOfflineStore.getState().loadFromIdb();
      expect(useEnvOfflineStore.getState().envPack).toBeNull();
    });

    it("sets isHydrating true during hydration and false after", async () => {
      const pack = makePack();
      idbStore.set(ENV_PACK_IDB_KEY, pack);

      const hydratingStates: boolean[] = [];
      const unsub = useEnvOfflineStore.subscribe((s) =>
        hydratingStates.push(s.isHydrating),
      );

      const promise = useEnvOfflineStore.getState().loadFromIdb();
      expect(useEnvOfflineStore.getState().isHydrating).toBe(true);
      await promise;
      unsub();

      expect(hydratingStates).toContain(true);
      expect(useEnvOfflineStore.getState().isHydrating).toBe(false);
    });

    it("clears isHydrating even when hydration fails", async () => {
      const { get } = await import("idb-keyval");
      (get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("IDB unavailable"),
      );

      await useEnvOfflineStore.getState().loadFromIdb();

      expect(useEnvOfflineStore.getState().isHydrating).toBe(false);
      expect(useEnvOfflineStore.getState().idbHydrationError).toBe(true);
    });

    it("rejects a corrupt IDB payload, sets idbHydrationError, and wipes the key", async () => {
      idbStore.set(ENV_PACK_IDB_KEY, { generatedAt: 12345, warnings: "nope" });

      await useEnvOfflineStore.getState().loadFromIdb();

      const state = useEnvOfflineStore.getState();
      expect(state.envPack).toBeNull();
      expect(state.idbHydrationError).toBe(true);
      expect(idbStore.has(ENV_PACK_IDB_KEY)).toBe(false);
    });

    it("does not overwrite the in-memory pack while a download is in flight", async () => {
      const stale = makePack({
        generatedAt: new Date(Date.now() - 3600_000).toISOString(),
      });
      idbStore.set(ENV_PACK_IDB_KEY, stale);
      useEnvOfflineStore.setState({ isDownloading: true });

      await useEnvOfflineStore.getState().loadFromIdb();

      expect(useEnvOfflineStore.getState().envPack).toBeNull();
    });

    it("does not overwrite a fresher in-memory pack with an older IDB pack", async () => {
      const fresh = makePack({ generatedAt: new Date().toISOString() });
      const stale = makePack({
        generatedAt: new Date(Date.now() - 3600_000).toISOString(),
      });
      idbStore.set(ENV_PACK_IDB_KEY, stale);
      useEnvOfflineStore.setState({ envPack: fresh });

      await useEnvOfflineStore.getState().loadFromIdb();

      expect(useEnvOfflineStore.getState().envPack).toEqual(fresh);
    });

    it("replaces an older in-memory pack with a newer IDB pack", async () => {
      const older = makePack({
        generatedAt: new Date(Date.now() - 3600_000).toISOString(),
      });
      const newer = makePack({ generatedAt: new Date().toISOString() });
      idbStore.set(ENV_PACK_IDB_KEY, newer);
      useEnvOfflineStore.setState({ envPack: older });

      await useEnvOfflineStore.getState().loadFromIdb();

      expect(useEnvOfflineStore.getState().envPack).toEqual(newer);
    });
  });

  describe("downloadEnvPack()", () => {
    it("sets isDownloading during fetch, clears it after", async () => {
      const pack = makePack();
      const downloadStates: boolean[] = [];
      const unsub = useEnvOfflineStore.subscribe((s) =>
        downloadStates.push(s.isDownloading),
      );

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => pack,
      } as Response);

      await useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14);
      unsub();

      expect(downloadStates).toContain(true);
      expect(useEnvOfflineStore.getState().isDownloading).toBe(false);
    });

    it("saves pack to memory and IDB on success", async () => {
      const pack = makePack();
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => pack,
      } as Response);

      await useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14);

      expect(useEnvOfflineStore.getState().envPack).toEqual(pack);
      expect(idbStore.get(ENV_PACK_IDB_KEY)).toEqual(pack);
    });

    it("sets downloadError and throws on HTTP error", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      await expect(
        useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14),
      ).rejects.toThrow();

      expect(useEnvOfflineStore.getState().downloadError).toBeTruthy();
      expect(useEnvOfflineStore.getState().isDownloading).toBe(false);
    });

    it("maps a structured 503 to the 'No data available' message", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "no_data_available", warnings: ["all down"] }),
      } as Response);

      await expect(
        useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14),
      ).rejects.toThrow("No data available for this location");

      expect(useEnvOfflineStore.getState().downloadError).toMatch(
        /No data available for this location/,
      );
      expect(useEnvOfflineStore.getState().envPack).toBeNull();
    });

    it("rejects malformed server JSON without persisting it", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ generatedAt: 42, warnings: "not-an-array" }),
      } as Response);

      await expect(
        useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14),
      ).rejects.toThrow(/malformed/i);

      const state = useEnvOfflineStore.getState();
      expect(state.envPack).toBeNull();
      expect(state.downloadError).toMatch(/malformed/i);
      expect(idbStore.has(ENV_PACK_IDB_KEY)).toBe(false);
    });

    it("rejects a response missing required envelope fields (generatedAt/expiresAt)", async () => {
      const { generatedAt: _g, expiresAt: _e, ...noEnvelope } = makePack();
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => noEnvelope,
      } as Response);

      await expect(
        useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14),
      ).rejects.toThrow(/malformed/i);

      const state = useEnvOfflineStore.getState();
      expect(state.envPack).toBeNull();
      expect(state.downloadError).toMatch(/malformed/i);
      expect(idbStore.has(ENV_PACK_IDB_KEY)).toBe(false);
    });

    it("is a no-op when a download is already in flight (concurrent guard)", async () => {
      useEnvOfflineStore.setState({ isDownloading: true });
      global.fetch = vi.fn();

      await expect(
        useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14),
      ).resolves.toBeUndefined();

      expect(global.fetch).not.toHaveBeenCalled();
      // The in-flight download's state is untouched.
      expect(useEnvOfflineStore.getState().isDownloading).toBe(true);
    });

    it("sets downloadError and throws on network failure", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

      await expect(
        useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14),
      ).rejects.toThrow("Network failure");

      expect(useEnvOfflineStore.getState().downloadError).toBe("Network failure");
    });

    it("partial success — tides only — saves the pack without error", async () => {
      const pack = makePack({ weatherStations: null });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => pack,
      } as Response);

      await expect(
        useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14),
      ).resolves.toBeUndefined();

      expect(useEnvOfflineStore.getState().envPack).toEqual(pack);
      expect(useEnvOfflineStore.getState().downloadError).toBeNull();
    });

    it("partial success — weather only — saves the pack without error", async () => {
      const pack = makePack({ tideStations: null });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => pack,
      } as Response);

      await expect(
        useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14),
      ).resolves.toBeUndefined();

      expect(useEnvOfflineStore.getState().envPack).toEqual(pack);
      expect(useEnvOfflineStore.getState().downloadError).toBeNull();
    });

    it("marine-only pack — no tide/weather stations — still persists", async () => {
      const pack = makePack({
        tideStations: null,
        weatherStations: null,
        temperatureProfile: null,
        warnings: ["No tide stations found", "No weather stations found"],
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => pack,
      } as Response);

      await expect(
        useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14),
      ).resolves.toBeUndefined();

      expect(useEnvOfflineStore.getState().envPack).toEqual(pack);
      expect(useEnvOfflineStore.getState().downloadError).toBeNull();
      expect(idbStore.get(ENV_PACK_IDB_KEY)).toEqual(pack);
    });

    it("profile-only pack — everything else empty — still persists", async () => {
      const pack = makePack({
        tideStations: [],
        weatherStations: null,
        marineConditions: null,
        warnings: ["No stations nearby"],
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => pack,
      } as Response);

      await expect(
        useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14),
      ).resolves.toBeUndefined();

      expect(useEnvOfflineStore.getState().envPack).toEqual(pack);
    });

    it("total failure — all four sources empty — throws and sets downloadError", async () => {
      const pack = makePack({
        tideStations: null,
        weatherStations: null,
        marineConditions: null,
        temperatureProfile: null,
        warnings: ["No tide stations found", "No weather stations found"],
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => pack,
      } as Response);

      await expect(
        useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14),
      ).rejects.toThrow("No data available for this location");

      const state = useEnvOfflineStore.getState();
      expect(state.downloadError).toMatch(/No data available for this location/);
      expect(state.isDownloading).toBe(false);
      // Pack must NOT be saved to memory or IDB
      expect(state.envPack).toBeNull();
      expect(idbStore.has(ENV_PACK_IDB_KEY)).toBe(false);
    });

    it("warning-only case — empty arrays instead of null — also treated as total failure", async () => {
      const pack = makePack({
        tideStations: [],
        weatherStations: [],
        marineConditions: null,
        temperatureProfile: { available: false, samples: [], source: "none", sourceUrl: null, timestamp: null, provider: "none" },
        warnings: ["No stations nearby"],
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => pack,
      } as Response);

      await expect(
        useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14),
      ).rejects.toThrow("No data available for this location");

      expect(useEnvOfflineStore.getState().downloadError).toMatch(
        /No data available for this location/,
      );
      expect(useEnvOfflineStore.getState().envPack).toBeNull();
    });

    it("builds the correct URL", async () => {
      const pack = makePack();
      let capturedUrl = "";
      global.fetch = vi.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve({ ok: true, json: async () => pack } as Response);
      });

      await useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14);

      expect(capturedUrl).toContain("lat=57.05");
      expect(capturedUrl).toContain("lon=-135.33");
      expect(capturedUrl).toContain("radiusMiles=15");
      expect(capturedUrl).toContain("days=14");
      expect(capturedUrl).toContain("/api/env-pack");
    });
  });

  describe("clearEnvPack()", () => {
    it("removes pack from memory and IDB", async () => {
      const pack = makePack();
      idbStore.set(ENV_PACK_IDB_KEY, pack);
      useEnvOfflineStore.setState({ envPack: pack });

      await useEnvOfflineStore.getState().clearEnvPack();

      expect(useEnvOfflineStore.getState().envPack).toBeNull();
      expect(idbStore.has(ENV_PACK_IDB_KEY)).toBe(false);
    });

    it("resets downloadError", async () => {
      useEnvOfflineStore.setState({ downloadError: "Something went wrong" });
      await useEnvOfflineStore.getState().clearEnvPack();
      expect(useEnvOfflineStore.getState().downloadError).toBeNull();
    });

    it("sets deleteError, keeps the in-memory pack, and rethrows when IDB deletion fails", async () => {
      const pack = makePack();
      idbStore.set(ENV_PACK_IDB_KEY, pack);
      useEnvOfflineStore.setState({ envPack: pack });

      const { del } = await import("idb-keyval");
      (del as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("quota exceeded"),
      );

      await expect(useEnvOfflineStore.getState().clearEnvPack()).rejects.toThrow(
        "quota exceeded",
      );

      const state = useEnvOfflineStore.getState();
      expect(state.deleteError).toBe("quota exceeded");
      // The pack must stay in memory — the IDB copy was NOT deleted.
      expect(state.envPack).toEqual(pack);
      expect(idbStore.has(ENV_PACK_IDB_KEY)).toBe(true);
    });

    it("clears deleteError on a subsequent successful delete", async () => {
      const pack = makePack();
      idbStore.set(ENV_PACK_IDB_KEY, pack);
      useEnvOfflineStore.setState({ envPack: pack, deleteError: "old failure" });

      await useEnvOfflineStore.getState().clearEnvPack();

      expect(useEnvOfflineStore.getState().deleteError).toBeNull();
      expect(useEnvOfflineStore.getState().envPack).toBeNull();
    });
  });
});

// ── Pure helper tests ─────────────────────────────────────────────────────────

describe("getEnvPackTideStation", () => {
  it("returns first station", () => {
    const pack = makePack();
    const st = getEnvPackTideStation(pack);
    expect(st?.stationId).toBe("9452210");
  });

  it("returns null when tideStations is null", () => {
    const pack = makePack({ tideStations: null });
    expect(getEnvPackTideStation(pack)).toBeNull();
  });
});

describe("getEnvPackWeatherStation", () => {
  it("returns first weather station", () => {
    const pack = makePack();
    expect(getEnvPackWeatherStation(pack)?.id).toBe("PAJN");
  });

  it("returns null when weatherStations is null", () => {
    const pack = makePack({ weatherStations: null });
    expect(getEnvPackWeatherStation(pack)).toBeNull();
  });
});

describe("getEnvPackTideHeight", () => {
  it("interpolates height between two predictions", () => {
    const pack = makePack();
    const now = new Date();
    const height = getEnvPackTideHeight(pack, now);
    // Between 3.0 and 6.0 ft
    expect(height).toBeGreaterThanOrEqual(3.0);
    expect(height).toBeLessThanOrEqual(6.0);
  });

  it("returns 0 when no tide stations", () => {
    const pack = makePack({ tideStations: null });
    expect(getEnvPackTideHeight(pack, new Date())).toBe(0);
  });
});
