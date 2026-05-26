import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildArgoQueryUrl,
  parseArgoRows,
  pickClosestArgoCast,
  fetchArgoProfile,
  __clearArgoCache,
} from "../argoErddap";

describe("buildArgoQueryUrl", () => {
  it("constructs a tabledap query with bbox + time-window constraints", () => {
    const url = buildArgoQueryUrl(55.69, -132.53, new Date("2026-05-01T00:00:00Z"));
    expect(url).toContain("erddap.ifremer.fr");
    expect(url).toContain("ArgoFloats.json");
    // bbox ±2°
    expect(url).toContain("latitude>=53.69");
    expect(url).toContain("latitude<=57.69");
    expect(url).toContain("longitude>=-134.53");
    expect(url).toContain("longitude<=-130.53");
    // 60-day window
    expect(url).toContain("time>=2026-03-02T00:00:00.000Z");
    expect(url).toContain("temp!=NaN");
    expect(url).toContain("pres!=NaN");
  });
});

describe("parseArgoRows", () => {
  it("returns row objects when the expected columns are present", () => {
    const json = {
      table: {
        columnNames: [
          "platform_number", "cycle_number", "time",
          "latitude", "longitude", "pres", "temp",
        ],
        rows: [
          ["5905012", 42, "2026-04-12T08:00:00Z", 55.7, -132.6, 5, 12.4],
          ["5905012", 42, "2026-04-12T08:00:00Z", 55.7, -132.6, 100, 6.5],
        ],
      },
    };
    const rows = parseArgoRows(json);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.platform).toBe("5905012");
    expect(rows[0]!.cycle).toBe(42);
    expect(rows[0]!.pres).toBe(5);
    expect(rows[1]!.temp).toBe(6.5);
  });

  it("rejects rows with non-finite or out-of-range values", () => {
    const json = {
      table: {
        columnNames: [
          "platform_number", "cycle_number", "time",
          "latitude", "longitude", "pres", "temp",
        ],
        rows: [
          ["5905012", 1, "2026-04-12T08:00:00Z", 55.7, -132.6, -5, 12.4],  // negative pressure
          ["5905012", 1, "2026-04-12T08:00:00Z", 55.7, -132.6, 50, 99],     // unrealistic temp
          ["5905012", 1, "2026-04-12T08:00:00Z", 55.7, -132.6, "NaN", 5],   // bad pres
          ["5905012", 1, "2026-04-12T08:00:00Z", 55.7, -132.6, 50, 5.5],    // good
        ],
      },
    };
    const rows = parseArgoRows(json);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.temp).toBe(5.5);
  });

  it("returns an empty array when required columns are missing", () => {
    expect(parseArgoRows({ table: { columnNames: ["pres"], rows: [[5]] } })).toEqual([]);
    expect(parseArgoRows({})).toEqual([]);
  });
});

describe("pickClosestArgoCast", () => {
  const makeRow = (
    platform: string, cycle: number, lat: number, lon: number,
    pres: number, temp: number, time = "2026-04-12T08:00:00Z",
  ) => ({ platform, cycle, time, lat, lon, pres, temp });

  it("returns null when no rows", () => {
    expect(pickClosestArgoCast([], 0, 0)).toBeNull();
  });

  it("groups by (platform, cycle) and picks the closest group", () => {
    const rows = [
      // Far cast — 3° east
      makeRow("AAA", 1, 55.7, -129.5, 0, 10),
      makeRow("AAA", 1, 55.7, -129.5, 100, 5),
      // Near cast — right at query point
      makeRow("BBB", 7, 55.7, -132.6, 0, 12),
      makeRow("BBB", 7, 55.7, -132.6, 50, 8),
      makeRow("BBB", 7, 55.7, -132.6, 200, 4),
    ];
    const cast = pickClosestArgoCast(rows, 55.7, -132.6);
    expect(cast).not.toBeNull();
    expect(cast!.platform).toBe("BBB");
    expect(cast!.cycle).toBe(7);
    expect(cast!.samples).toEqual([
      { depthM: 0, temperatureC: 12 },
      { depthM: 50, temperatureC: 8 },
      { depthM: 200, temperatureC: 4 },
    ]);
  });

  it("sorts samples shallow→deep and deduplicates near-identical depths", () => {
    const rows = [
      makeRow("X", 1, 0, 0, 100, 5),
      makeRow("X", 1, 0, 0, 0, 12),
      makeRow("X", 1, 0, 0, 0.1, 11.9), // dupe of 0
      makeRow("X", 1, 0, 0, 50, 8),
    ];
    const cast = pickClosestArgoCast(rows, 0, 0);
    expect(cast!.samples.map((s) => s.depthM)).toEqual([0, 50, 100]);
  });

  it("returns null when only one unique depth survives", () => {
    const rows = [makeRow("X", 1, 0, 0, 0, 12)];
    expect(pickClosestArgoCast(rows, 0, 0)).toBeNull();
  });
});

describe("fetchArgoProfile", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    __clearArgoCache();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
    __clearArgoCache();
  });

  function ok(body: unknown): Response {
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }

  it("returns a profile with attribution when ERDDAP has a usable cast", async () => {
    fetchSpy.mockResolvedValueOnce(ok({
      table: {
        columnNames: [
          "platform_number", "cycle_number", "time",
          "latitude", "longitude", "pres", "temp",
        ],
        rows: [
          ["5905012", 42, "2026-04-12T08:00:00Z", 55.7, -132.6, 0, 12.4],
          ["5905012", 42, "2026-04-12T08:00:00Z", 55.7, -132.6, 100, 6.5],
          ["5905012", 42, "2026-04-12T08:00:00Z", 55.7, -132.6, 500, 4.1],
        ],
      },
    }));
    const profile = await fetchArgoProfile(55.7, -132.6);
    expect(profile).not.toBeNull();
    expect(profile!.provider).toBe("argo");
    expect(profile!.source).toMatch(/Argo float 5905012 cycle 42/);
    expect(profile!.source).toMatch(/2026-04-12/);
    expect(profile!.sourceUrl).toContain("5905012");
    expect(profile!.timestamp).toBe("2026-04-12T08:00:00Z");
    expect(profile!.samples).toEqual([
      { depthM: 0, temperatureC: 12.4 },
      { depthM: 100, temperatureC: 6.5 },
      { depthM: 500, temperatureC: 4.1 },
    ]);
  });

  it("returns null on upstream non-OK response", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as unknown as Response);
    expect(await fetchArgoProfile(0, 0)).toBeNull();
  });

  it("returns null on network/timeout errors", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));
    expect(await fetchArgoProfile(0, 0)).toBeNull();
  });

  it("returns null when there are no rows in range", async () => {
    fetchSpy.mockResolvedValueOnce(ok({
      table: {
        columnNames: [
          "platform_number", "cycle_number", "time",
          "latitude", "longitude", "pres", "temp",
        ],
        rows: [],
      },
    }));
    expect(await fetchArgoProfile(0, 0)).toBeNull();
  });
});

describe("fetchArgoProfile caching", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    __clearArgoCache();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
    __clearArgoCache();
  });

  function ok(body: unknown): Response {
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }

  const goodBody = {
    table: {
      columnNames: [
        "platform_number", "cycle_number", "time",
        "latitude", "longitude", "pres", "temp",
      ],
      rows: [
        ["5905012", 42, "2026-04-12T08:00:00Z", 55.7, -132.6, 0, 12.4],
        ["5905012", 42, "2026-04-12T08:00:00Z", 55.7, -132.6, 100, 6.5],
      ],
    },
  };

  it("serves a second nearby request from cache without re-hitting ERDDAP", async () => {
    fetchSpy.mockResolvedValueOnce(ok(goodBody));
    const first = await fetchArgoProfile(55.70, -132.60);
    const second = await fetchArgoProfile(55.71, -132.59);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("caches negative results too (no rows in range)", async () => {
    const emptyBody = {
      table: {
        columnNames: [
          "platform_number", "cycle_number", "time",
          "latitude", "longitude", "pres", "temp",
        ],
        rows: [],
      },
    };
    fetchSpy.mockResolvedValueOnce(ok(emptyBody));
    expect(await fetchArgoProfile(10, 20)).toBeNull();
    expect(await fetchArgoProfile(10, 20)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the positive TTL (30 min) expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00Z"));
    fetchSpy.mockResolvedValueOnce(ok(goodBody));
    await fetchArgoProfile(55.7, -132.6);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Just before expiry — still cached.
    vi.setSystemTime(new Date("2026-05-01T00:29:00Z"));
    await fetchArgoProfile(55.7, -132.6);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Past expiry — re-fetches.
    vi.setSystemTime(new Date("2026-05-01T00:31:00Z"));
    fetchSpy.mockResolvedValueOnce(ok(goodBody));
    await fetchArgoProfile(55.7, -132.6);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("re-fetches negative results sooner than positive ones", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00Z"));
    const emptyBody = {
      table: {
        columnNames: [
          "platform_number", "cycle_number", "time",
          "latitude", "longitude", "pres", "temp",
        ],
        rows: [],
      },
    };
    fetchSpy.mockResolvedValueOnce(ok(emptyBody));
    expect(await fetchArgoProfile(10, 20)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Within 5-min negative TTL — still cached.
    vi.setSystemTime(new Date("2026-05-01T00:04:00Z"));
    expect(await fetchArgoProfile(10, 20)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Past negative TTL but well within positive TTL — re-fetches.
    vi.setSystemTime(new Date("2026-05-01T00:06:00Z"));
    fetchSpy.mockResolvedValueOnce(ok(emptyBody));
    expect(await fetchArgoProfile(10, 20)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("uses separate cache entries for distant coordinates", async () => {
    fetchSpy.mockResolvedValueOnce(ok(goodBody));
    fetchSpy.mockResolvedValueOnce(ok(goodBody));
    await fetchArgoProfile(55.7, -132.6);
    await fetchArgoProfile(10, 20);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
