/**
 * offlinePackStore unit tests.
 *
 * Tests for the pure interpolation helpers and the pack CRUD logic.
 * idb-keyval is mocked via vitest so no real IndexedDB is required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  saveOfflinePack,
  type OfflinePack,
  type PackProgress,
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

// ── SW { ok: false } integration tests ───────────────────────────────────
//
// These tests stub navigator.serviceWorker and MessageChannel so that the
// page-side cacheTerrain() receives { ok: false, error: "HTTP 503" } from
// the simulated MessagePort.  They assert that saveOfflinePack() propagates
// the failure through onProgress (with an error field) and throws, rather
// than silently recording a "Terrain cached" success.

describe("saveOfflinePack — SW { ok: false } surface to caller", () => {
  // Capture the real navigator descriptor so we can restore it after each test.
  const origNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  afterEach(() => {
    vi.unstubAllGlobals();
    // Restore navigator to whatever it was before the test.
    if (origNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", origNavigatorDescriptor);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).navigator;
    }
  });

  function stubSwWithResponse(response: { ok: boolean; error?: string }): void {
    // Intercept MessageChannel so we can capture port1 and fire a reply.
    let capturedPort1: { onmessage: ((e: MessageEvent) => void) | null } | null = null;

    vi.stubGlobal("MessageChannel", function (this: unknown) {
      capturedPort1 = { onmessage: null };
      const port2 = {};
      return { port1: capturedPort1, port2 };
    });

    const postMessageSpy = vi.fn().mockImplementation(() => {
      // Fire the SW reply on the next microtask tick — before the 10 s fallback timer.
      Promise.resolve().then(() => {
        capturedPort1?.onmessage?.({ data: response } as MessageEvent);
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

  it("throws when the SW MessagePort replies { ok: false, error: 'HTTP 503' }", async () => {
    stubSwWithResponse({ ok: false, error: "HTTP 503" });

    const events: PackProgress[] = [];
    await expect(
      saveOfflinePack({ id: "ds-sw-fail", name: "SW Fail Dataset" }, 3, (p) => events.push(p)),
    ).rejects.toThrow("HTTP 503");
  });

  it("reports step:'terrain' with error field when SW replies { ok: false }", async () => {
    stubSwWithResponse({ ok: false, error: "HTTP 503" });

    const events: PackProgress[] = [];
    await saveOfflinePack(
      { id: "ds-sw-fail2", name: "SW Fail Dataset 2" },
      3,
      (p) => events.push(p),
    ).catch(() => { /* expected */ });

    const terrainErrorEvent = events.find((p) => p.step === "terrain" && p.error !== undefined);
    expect(terrainErrorEvent).toBeDefined();
    expect(terrainErrorEvent?.error).toMatch(/HTTP 503/);
  });

  it("does not emit a success terrain progress event when SW replies { ok: false }", async () => {
    stubSwWithResponse({ ok: false, error: "HTTP 503" });

    const events: PackProgress[] = [];
    await saveOfflinePack(
      { id: "ds-sw-fail3", name: "SW Fail Dataset 3" },
      3,
      (p) => events.push(p),
    ).catch(() => { /* expected */ });

    const successTerrainEvent = events.find(
      (p) => p.step === "terrain" && p.done && p.error === undefined,
    );
    expect(successTerrainEvent).toBeUndefined();
  });

  it("does not write a pack to IndexedDB when SW terrain caching fails", async () => {
    stubSwWithResponse({ ok: false, error: "HTTP 503" });

    await saveOfflinePack(
      { id: "ds-sw-fail4", name: "SW Fail Dataset 4" },
      3,
      () => { /* noop */ },
    ).catch(() => { /* expected */ });

    const packs = await listOfflinePacks();
    expect(packs).toHaveLength(0);
  });

  it("resolves successfully when SW replies { ok: true }", async () => {
    stubSwWithResponse({ ok: true });

    // Also stub fetch for tide and weather so the full flow completes.
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
            station: "TEST",
            observation: null,
            snapshotAt: new Date().toISOString(),
          }),
        });
      }),
    );

    const events: PackProgress[] = [];
    const pack = await saveOfflinePack(
      { id: "ds-sw-ok", name: "SW OK Dataset" },
      3,
      (p) => events.push(p),
    );

    expect(pack.datasetId).toBe("ds-sw-ok");
    const successTerrainEvent = events.find(
      (p) => p.step === "terrain" && p.done && p.error === undefined,
    );
    expect(successTerrainEvent).toBeDefined();
    expect(successTerrainEvent?.label).toBe("Terrain cached");
  });
});

// ── Weather-skip progress event ───────────────────────────────────────────
//
// When the weather fetch throws, saveOfflinePack() should emit a distinct
// progress event so the UI can surface the omission instead of silently
// succeeding.

describe("saveOfflinePack — weather fetch failure emits warning progress event", () => {
  const origNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  afterEach(() => {
    vi.unstubAllGlobals();
    if (origNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", origNavigatorDescriptor);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).navigator;
    }
  });

  it("emits step:'weather' with a warning label when the weather fetch rejects", async () => {
    // Stub the SW to accept terrain caching immediately.
    let capturedPort1: { onmessage: ((e: MessageEvent) => void) | null } | null = null;
    vi.stubGlobal("MessageChannel", function (this: unknown) {
      capturedPort1 = { onmessage: null };
      return { port1: capturedPort1, port2: {} };
    });
    const postMessageSpy = vi.fn().mockImplementation(() => {
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

    // Stub fetch: tide succeeds, weather rejects.
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
        // Weather endpoint rejects
        return Promise.reject(new Error("Network error"));
      }),
    );

    const events: PackProgress[] = [];
    // The call should still resolve (weather is best-effort).
    await saveOfflinePack({ id: "ds-weather-fail", name: "Weather Fail Dataset" }, 3, (p) =>
      events.push(p),
    );

    const weatherWarning = events.find((p) => p.step === "weather" && p.done);
    expect(weatherWarning).toBeDefined();
    expect(weatherWarning?.label).toMatch(/unavailable/i);
    // Must NOT carry an error field that would surface as a hard failure in the UI.
    expect(weatherWarning?.error).toBeUndefined();
  });

  it("does not emit the normal 'Weather snapshot saved' event when fetch rejects", async () => {
    let capturedPort1: { onmessage: ((e: MessageEvent) => void) | null } | null = null;
    vi.stubGlobal("MessageChannel", function (this: unknown) {
      capturedPort1 = { onmessage: null };
      return { port1: capturedPort1, port2: {} };
    });
    const postMessageSpy = vi.fn().mockImplementation(() => {
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
        return Promise.reject(new Error("Network error"));
      }),
    );

    const events: PackProgress[] = [];
    await saveOfflinePack({ id: "ds-weather-fail2", name: "Weather Fail Dataset 2" }, 3, (p) =>
      events.push(p),
    );

    const successWeatherEvent = events.find(
      (p) => p.step === "weather" && p.label === "Weather snapshot saved",
    );
    expect(successWeatherEvent).toBeUndefined();
  });
});

// ── weather 200 with null station/observation ─────────────────────────────
//
// The API returns HTTP 200 with { station: null, observation: null } when no
// nearby station is found or NOAA is temporarily unavailable.  saveOfflinePack
// must always emit a terminal done:true weather event regardless of whether the
// payload fields are populated — otherwise the progress row stays stuck at
// "Fetching weather snapshot…" indefinitely.

describe("saveOfflinePack — weather 200 with null station+observation emits terminal event", () => {
  const origNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  afterEach(() => {
    vi.unstubAllGlobals();
    if (origNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", origNavigatorDescriptor);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).navigator;
    }
  });

  function stubSwAndFetchNullWeather() {
    let capturedPort1: { onmessage: ((e: MessageEvent) => void) | null } | null = null;
    vi.stubGlobal("MessageChannel", function (this: unknown) {
      capturedPort1 = { onmessage: null };
      return { port1: capturedPort1, port2: {} };
    });
    vi.fn().mockImplementation(() => {
      Promise.resolve().then(() => {
        capturedPort1?.onmessage?.({ data: { ok: true } } as MessageEvent);
      });
    });
    const postMessageSpy = vi.fn().mockImplementation(() => {
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
        // Weather endpoint returns 200 with null payload
        return Promise.resolve({
          ok: true,
          json: async () => ({ station: null, observation: null, snapshotAt: new Date().toISOString() }),
        });
      }),
    );
  }

  it("emits a terminal done:true weather event when the API returns 200 { station: null, observation: null }", async () => {
    stubSwAndFetchNullWeather();
    const events: PackProgress[] = [];
    await saveOfflinePack({ id: "ds-weather-null", name: "No Station Dataset" }, 3, (p) =>
      events.push(p),
    );
    const weatherDone = events.find((p) => p.step === "weather" && p.done);
    expect(weatherDone).toBeDefined();
    // The terminal label must signal unavailability, not a successful save.
    expect(weatherDone?.label).toMatch(/unavailable/i);
  });

  it("does not leave the weather step in a non-terminal state when API returns null payload", async () => {
    stubSwAndFetchNullWeather();
    const events: PackProgress[] = [];
    await saveOfflinePack({ id: "ds-weather-null2", name: "No Station Dataset 2" }, 3, (p) =>
      events.push(p),
    );
    const weatherEvents = events.filter((p) => p.step === "weather");
    // Every weather event must eventually reach done:true — none may be left open.
    const lastWeatherEvent = weatherEvents.at(-1);
    expect(lastWeatherEvent?.done).toBe(true);
  });
});

// ── SW timeout without ack rejects ────────────────────────────────────────
//
// When the SW is registered but never responds on the MessageChannel port,
// cacheTerrain() must reject (rather than resolve silently) after the timeout.
// This ensures the pack creation flow surfaces a visible warning instead of
// claiming success for terrain that was never cached.

describe("saveOfflinePack — SW timeout without ack rejects", () => {
  const origNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (origNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", origNavigatorDescriptor);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).navigator;
    }
  });

  it("rejects and emits a terrain error event when the SW never acks the CACHE_PACK message", async () => {
    vi.useFakeTimers();

    // Stub MessageChannel: port1.onmessage will be captured but never called.
    vi.stubGlobal("MessageChannel", function (this: unknown) {
      return { port1: { onmessage: null }, port2: {} };
    });

    // Stub postMessage to do nothing (no reply from the SW).
    const postMessageSpy = vi.fn();
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          ready: Promise.resolve({ active: { postMessage: postMessageSpy } }),
        },
      },
      configurable: true,
      writable: true,
    });

    const events: PackProgress[] = [];
    // Attach .catch() immediately so the rejection is never "unhandled" while
    // fake timers advance past the 10-second SW ack timeout.
    const promise = saveOfflinePack(
      { id: "ds-sw-timeout", name: "SW Timeout Dataset" },
      3,
      (p) => events.push(p),
    ).catch((e: unknown) => e);   // capture, not suppress — we inspect it below

    // Advance past the 10-second SW timeout.
    await vi.advanceTimersByTimeAsync(11000);

    const result = await promise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/timed out/i);

    const terrainErrorEvent = events.find((p) => p.step === "terrain" && p.error !== undefined);
    expect(terrainErrorEvent).toBeDefined();
    expect(terrainErrorEvent?.error).toMatch(/timed out/i);
  });

  it("does not write a pack to IndexedDB when SW ack times out", async () => {
    vi.useFakeTimers();

    vi.stubGlobal("MessageChannel", function (this: unknown) {
      return { port1: { onmessage: null }, port2: {} };
    });
    const postMessageSpy = vi.fn();
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          ready: Promise.resolve({ active: { postMessage: postMessageSpy } }),
        },
      },
      configurable: true,
      writable: true,
    });

    // Attach .catch() immediately so the rejection is never "unhandled" during
    // fake-timer advancement.
    const promise = saveOfflinePack(
      { id: "ds-sw-timeout2", name: "SW Timeout Dataset 2" },
      3,
      () => { /* noop */ },
    ).catch(() => { /* expected rejection */ });

    await vi.advanceTimersByTimeAsync(11000);
    await promise;

    const packs = await listOfflinePacks();
    expect(packs).toHaveLength(0);
  });
});
