/**
 * Regression tests for WT-002 (water-type scoped UX audit):
 * `requestDatasetSwitch` must report whether the request was handled.
 *
 * The in-flight guard drops a second request while a first one is still
 * resolving its preview — neither callback ever fires for the dropped
 * request. Callers that flipped state in anticipation of the switch (e.g.
 * useWaterTypeSideEffects flipping `waterType`) need a signal to revert,
 * so the dropped path must resolve `false` and every handled path `true`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

// Lazily-dispatched preview implementation so each test controls resolution
// timing. Referenced (not dereferenced) at mock-factory time, so a plain
// module-level object is safe.
const previewImpl: { fn: ((id: string) => Promise<unknown>) | null } = { fn: null };

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    getDatasetsIdPreview: (id: string) => {
      if (!previewImpl.fn) throw new Error("previewImpl.fn not set by test");
      return previewImpl.fn(id);
    },
  }),
);

import {
  requestDatasetSwitch,
  __resetInFlightForTest,
  __retryConfig,
} from "@/lib/simulatedDataStore";

function makePreview(id: string, dataSource = "ncei") {
  return {
    datasetId: id,
    name: id,
    bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
    dataSource,
  };
}

describe("requestDatasetSwitch — handled/dropped contract (WT-002)", () => {
  beforeEach(() => {
    __resetInFlightForTest();
    __retryConfig.delayMs = 0;
    try { sessionStorage.clear(); } catch { /* ignore */ }
  });

  it("resolves true when the switch confirms normally", async () => {
    previewImpl.fn = async (id) => makePreview(id);
    const onConfirm = vi.fn();
    const accepted = await requestDatasetSwitch({
      datasetId: `wt002-confirm-${Date.now()}`,
      onConfirm,
    });
    expect(accepted).toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("resolves false and fires NO callbacks when another switch is already in flight", async () => {
    let resolveFirst!: (v: unknown) => void;
    const firstId = `wt002-first-${Date.now()}`;
    previewImpl.fn = () => new Promise((res) => { resolveFirst = res; });

    const firstConfirm = vi.fn();
    // Not awaited — the async body runs synchronously up to the preview
    // await, which sets the in-flight flag before returning control here.
    const first = requestDatasetSwitch({ datasetId: firstId, onConfirm: firstConfirm });

    const secondConfirm = vi.fn();
    const secondCancel = vi.fn();
    const accepted = await requestDatasetSwitch({
      datasetId: `wt002-second-${Date.now()}`,
      onConfirm: secondConfirm,
      onCancel: secondCancel,
    });

    // The dropped request reports itself as unhandled…
    expect(accepted).toBe(false);
    // …and never invokes either callback.
    expect(secondConfirm).not.toHaveBeenCalled();
    expect(secondCancel).not.toHaveBeenCalled();

    // The first request is unaffected and still completes as handled.
    resolveFirst(makePreview(firstId));
    await expect(first).resolves.toBe(true);
    expect(firstConfirm).toHaveBeenCalledTimes(1);
  });
});
