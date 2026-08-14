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
        status: 503,
      } as Response);

      await expect(
        useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14),
      ).rejects.toThrow();

      expect(useEnvOfflineStore.getState().downloadError).toBeTruthy();
      expect(useEnvOfflineStore.getState().isDownloading).toBe(false);
    });

    it("sets downloadError and throws on network failure", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

      await expect(
        useEnvOfflineStore.getState().downloadEnvPack(57.05, -135.33, 15, 14),
      ).rejects.toThrow("Network failure");

      expect(useEnvOfflineStore.getState().downloadError).toBe("Network failure");
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
