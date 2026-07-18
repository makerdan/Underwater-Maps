/**
 * Regression tests for the tide store's stale-response handling.
 *
 * The key bug: loadPredictions committed the empty-samples "unavailable"
 * state BEFORE the stale-station guard ran, so a slow empty response for a
 * previously selected station could wipe the currently selected station's
 * tide predictions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTidalStore, type TideStationInfo } from "@/lib/tidalStore";

const stationA: TideStationInfo = {
  id: "A111",
  name: "Station A",
  lat: 40,
  lon: -70,
  distanceMiles: 1,
};
const stationB: TideStationInfo = {
  id: "B222",
  name: "Station B",
  lat: 41,
  lon: -71,
  distanceMiles: 2,
};

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function predictionsBody(predictions: Array<{ t: string; v: number }>) {
  return {
    windowStart: "2026-07-01T00:00:00Z",
    windowEnd: "2026-08-01T00:00:00Z",
    predictions,
  };
}

const samplePredictions = [
  { t: "2026-07-01T00:00:00Z", v: 1.2 },
  { t: "2026-07-01T00:06:00Z", v: 1.3 },
  { t: "2026-07-01T00:12:00Z", v: 1.4 },
];

describe("tidalStore stale-response guards", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useTidalStore.getState().reset();
  });

  it("a stale empty predictions response for a previous station does not clobber the current station's data", async () => {
    let resolveStale!: (r: Response) => void;
    const stalePromise = new Promise<Response>((res) => { resolveStale = res; });

    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/tides/A111/datums") || url.includes("/tides/B222/datums")) {
        return Promise.resolve(jsonResponse({ stationId: "x", mhwFt: null, mhhwFt: null }));
      }
      if (url.includes("/tides/A111")) {
        // Slow request for the OLD station that eventually resolves empty.
        return stalePromise;
      }
      if (url.includes("/tides/B222")) {
        return Promise.resolve(jsonResponse(predictionsBody(samplePredictions)));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }));

    const store = useTidalStore.getState();
    store.setStation(stationA); // kicks off slow A load
    store.setStation(stationB); // switch before A resolves

    // Let B's predictions land.
    await vi.waitFor(() => {
      expect(useTidalStore.getState().predictionsStatus).toBe("ready");
    });
    expect(useTidalStore.getState().samples).not.toBeNull();

    // Now the stale request for A resolves with an EMPTY prediction list.
    resolveStale(jsonResponse(predictionsBody([])));
    await new Promise((r) => setTimeout(r, 0));

    // B's data must survive.
    const state = useTidalStore.getState();
    expect(state.station?.id).toBe("B222");
    expect(state.predictionsStatus).toBe("ready");
    expect(state.samples).not.toBeNull();
  });

  it("a stale failed predictions request does not clobber the current station's data", async () => {
    let rejectStale!: (e: Error) => void;
    const stalePromise = new Promise<Response>((_res, rej) => { rejectStale = rej; });

    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/datums")) {
        return Promise.resolve(jsonResponse({ stationId: "x", mhwFt: null, mhhwFt: null }));
      }
      if (url.includes("/tides/A111")) return stalePromise;
      if (url.includes("/tides/B222")) {
        return Promise.resolve(jsonResponse(predictionsBody(samplePredictions)));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }));

    const store = useTidalStore.getState();
    store.setStation(stationA);
    store.setStation(stationB);

    await vi.waitFor(() => {
      expect(useTidalStore.getState().predictionsStatus).toBe("ready");
    });

    rejectStale(new Error("network down"));
    await new Promise((r) => setTimeout(r, 0));

    const state = useTidalStore.getState();
    expect(state.station?.id).toBe("B222");
    expect(state.predictionsStatus).toBe("ready");
    expect(state.samples).not.toBeNull();
  });

  it("a stale resolveStation response does not overwrite a directly-set station", async () => {
    let resolveSlow!: (r: Response) => void;
    const slowPromise = new Promise<Response>((res) => { resolveSlow = res; });

    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/tides/station")) return slowPromise;
      if (url.includes("/datums")) {
        return Promise.resolve(jsonResponse({ stationId: "x", mhwFt: null, mhhwFt: null }));
      }
      if (url.includes("/tides/B222")) {
        return Promise.resolve(jsonResponse(predictionsBody(samplePredictions)));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }));

    const store = useTidalStore.getState();
    const resolvePromise = store.resolveStation(40, -70);

    // User (or a dataset binding) sets a station while the resolve is in flight.
    store.setStation(stationB);

    // Stale resolve comes back with "unavailable".
    resolveSlow(jsonResponse({ available: false }));
    await resolvePromise;

    const state = useTidalStore.getState();
    expect(state.station?.id).toBe("B222");
    expect(state.stationStatus).toBe("ready");
  });

  it("a stale resolveStation error does not mark the current station unavailable", async () => {
    let rejectSlow!: (e: Error) => void;
    const slowPromise = new Promise<Response>((_res, rej) => { rejectSlow = rej; });

    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/tides/station")) return slowPromise;
      if (url.includes("/datums")) {
        return Promise.resolve(jsonResponse({ stationId: "x", mhwFt: null, mhhwFt: null }));
      }
      if (url.includes("/tides/B222")) {
        return Promise.resolve(jsonResponse(predictionsBody(samplePredictions)));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }));

    const store = useTidalStore.getState();
    const resolvePromise = store.resolveStation(40, -70);
    store.setStation(stationB);

    rejectSlow(new Error("boom"));
    await resolvePromise;

    const state = useTidalStore.getState();
    expect(state.station?.id).toBe("B222");
    expect(state.stationStatus).toBe("ready");
  });
});
