import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock cacheRegistry so the module-level registerCache() call is a no-op
// ---------------------------------------------------------------------------
vi.mock("../cacheRegistry.js", () => ({ registerCache: vi.fn() }));

// ---------------------------------------------------------------------------
// DB mock — mutable state lets each test control what the DB returns
// ---------------------------------------------------------------------------
type DbRow = {
  datasetId: string;
  observation: unknown;
  fetchedAt: Date;
};
const dbState: {
  selectRows: DbRow[];
  insertedRows: Array<{ datasetId: string; observation: unknown; fetchedAt: Date }>;
} = { selectRows: [], insertedRows: [] };

vi.mock("@workspace/db", () => {
  const rawsObservationCacheTable = {
    __tableName: "raws_observation_cache",
    datasetId: "dataset_id",
  };

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(dbState.selectRows),
        }),
      }),
    }),
    insert: () => ({
      values: (row: { datasetId: string; observation: unknown; fetchedAt: Date }) => ({
        onConflictDoUpdate: ({ set }: { set: { observation: unknown; fetchedAt: Date } }) => {
          dbState.insertedRows.push({
            datasetId: row.datasetId,
            observation: set.observation,
            fetchedAt: set.fetchedAt,
          });
          return Promise.resolve([]);
        },
      }),
    }),
  };

  return { db, rawsObservationCacheTable };
});

// ---------------------------------------------------------------------------
// Module under test (imported after mocks are registered)
// ---------------------------------------------------------------------------
import { fetchRawsObservation, __clearRawsObsCache } from "../rawsErddap";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeInfoResponse(varNames: string[]) {
  return {
    table: {
      columnNames: ["Row Type", "Variable Name"],
      rows: varNames.map((name) => ["variable", name]),
    },
  };
}

function makeObsResponse(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    time: "2026-05-31T10:00:00Z",
    air_temperature: 22.5,
    wind_speed: 3.1,
    wind_from_direction: 270,
    wind_speed_of_gust: 5.0,
    relative_humidity: 55.0,
    ...overrides,
  };
  const cols = Object.keys(data);
  return { table: { columnNames: cols, rows: [cols.map((k) => data[k])] } };
}

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function jsonFail(status = 503): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

/** Build a DbRow for use in dbState.selectRows */
function makeDbRow(ageMs: number): DbRow {
  return {
    datasetId: "raws_test",
    observation: {
      time: "2026-05-31T09:00:00Z",
      airTemperatureC: 18.0,
      windSpeedMs: 2.0,
      windFromDirectionDeg: 180,
      windGustMs: null,
      relativeHumidityPct: 70,
      solarIrradianceWm2: null,
      precipitationMm: null,
      fuelTemperatureC: null,
      batteryVoltageV: null,
    },
    fetchedAt: new Date(Date.now() - ageMs),
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __clearRawsObsCache();
  dbState.selectRows = [];
  dbState.insertedRows = [];
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchRawsObservation — successful ERDDAP fetch", () => {
  it("returns observation with stale:false when ERDDAP responds", async () => {
    const datasetId = "raws_live_station";

    fetchMock.mockImplementation((url: string) => {
      if (url.includes(`/info/${datasetId}/`)) {
        return Promise.resolve(
          jsonOk(
            makeInfoResponse([
              "time",
              "air_temperature",
              "wind_speed",
              "wind_from_direction",
              "relative_humidity",
            ]),
          ),
        );
      }
      if (url.includes(`/tabledap/${datasetId}`)) {
        return Promise.resolve(jsonOk(makeObsResponse()));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    const result = await fetchRawsObservation(datasetId);

    expect(result).not.toBeNull();
    expect(result!.stale).toBe(false);
    expect(result!.observation.time).toBe("2026-05-31T10:00:00Z");
    expect(result!.observation.airTemperatureC).toBeCloseTo(22.5, 5);
    expect(result!.observation.windSpeedMs).toBeCloseTo(3.1, 5);
  });

  it("persists the observation to the DB after a successful ERDDAP fetch", async () => {
    const datasetId = "raws_persist_check";

    fetchMock.mockImplementation((url: string) => {
      if (url.includes(`/info/${datasetId}/`)) {
        return Promise.resolve(
          jsonOk(makeInfoResponse(["time", "air_temperature", "wind_speed"])),
        );
      }
      if (url.includes(`/tabledap/${datasetId}`)) {
        return Promise.resolve(jsonOk(makeObsResponse({ air_temperature: 15.0 })));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    await fetchRawsObservation(datasetId);

    // persistToDb is fire-and-forget; allow the microtask queue to flush
    await Promise.resolve();

    expect(dbState.insertedRows).toHaveLength(1);
    const saved = dbState.insertedRows[0]!;
    expect(saved.datasetId).toBe(datasetId);
    expect((saved.observation as Record<string, unknown>)?.airTemperatureC).toBeCloseTo(15.0, 5);
  });
});

describe("fetchRawsObservation — ERDDAP failure with DB fallback", () => {
  beforeEach(() => {
    // All ERDDAP calls fail
    fetchMock.mockRejectedValue(new Error("ERDDAP unreachable"));
  });

  it("returns observation with stale:false when DB row is younger than 10 min", async () => {
    const FIVE_MIN_MS = 5 * 60_000;
    dbState.selectRows = [makeDbRow(FIVE_MIN_MS)];

    const result = await fetchRawsObservation("raws_fresh_fallback");

    expect(result).not.toBeNull();
    expect(result!.stale).toBe(false);
    expect(result!.observation.airTemperatureC).toBe(18.0);
  });

  it("returns observation with stale:true when DB row is older than 10 min", async () => {
    const FIFTEEN_MIN_MS = 15 * 60_000;
    dbState.selectRows = [makeDbRow(FIFTEEN_MIN_MS)];

    const result = await fetchRawsObservation("raws_stale_fallback");

    expect(result).not.toBeNull();
    expect(result!.stale).toBe(true);
    expect(result!.observation.airTemperatureC).toBe(18.0);
  });

  it("returns null when ERDDAP is down and there is no DB row", async () => {
    dbState.selectRows = [];

    const result = await fetchRawsObservation("raws_no_fallback");

    expect(result).toBeNull();
  });
});

describe("fetchRawsObservation — stale boundary (exactly 10 min)", () => {
  beforeEach(() => {
    fetchMock.mockRejectedValue(new Error("ERDDAP unreachable"));
  });

  it("marks as not-stale when age is exactly 10 min (boundary is exclusive)", async () => {
    const TEN_MIN_MS = 10 * 60_000;
    dbState.selectRows = [makeDbRow(TEN_MIN_MS)];

    const result = await fetchRawsObservation("raws_boundary_fresh");

    expect(result).not.toBeNull();
    // ageMs === STALE_THRESHOLD_MS → stale = ageMs > threshold → false
    expect(result!.stale).toBe(false);
  });

  it("marks as stale when age exceeds 10 min by 1 ms", async () => {
    const JUST_OVER_TEN_MIN_MS = 10 * 60_000 + 1;
    dbState.selectRows = [makeDbRow(JUST_OVER_TEN_MIN_MS)];

    const result = await fetchRawsObservation("raws_boundary_stale");

    expect(result).not.toBeNull();
    expect(result!.stale).toBe(true);
  });
});

describe("fetchRawsObservation — ERDDAP non-OK response with DB fallback", () => {
  it("falls back to DB when ERDDAP returns a non-OK status (e.g. 503)", async () => {
    const datasetId = "raws_503_fallback";
    const FOUR_MIN_MS = 4 * 60_000;
    dbState.selectRows = [makeDbRow(FOUR_MIN_MS)];

    fetchMock.mockImplementation(() => Promise.resolve(jsonFail(503)));

    const result = await fetchRawsObservation(datasetId);

    expect(result).not.toBeNull();
    expect(result!.stale).toBe(false);
    expect(result!.observation.windFromDirectionDeg).toBe(180);
  });
});
