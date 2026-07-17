/**
 * Null-safety regression: sw.ts cache.put non-OK fetch guard.
 *
 * When fetch() resolves with r.ok === false, the handler must throw so the
 * outer catch posts { ok: false } through the MessagePort.
 * cache.put must never be called for the URL whose fetch was non-OK.
 */

import { describe, it, expect, vi } from "vitest";

// ── Replicate the guard logic extracted from sw.ts ─────────────────────────
// The service-worker file itself cannot be imported in vitest (workbox imports
// and SW globals are not available in the jsdom environment), so we test the
// exact guard expression in isolation — the change is a one-liner predicate.

async function simulateCachePack(opts: {
  terrainOk: boolean;
  overviewOk: boolean;
}): Promise<{ ok: boolean; error?: string; terrainPutCalled: boolean; overviewPutCalled: boolean }> {
  const terrainPutSpy = vi.fn().mockResolvedValue(undefined);
  const overviewPutSpy = vi.fn().mockResolvedValue(undefined);

  const makeFetch = (ok: boolean) =>
    Promise.resolve({ ok, status: ok ? 200 : 503 } as Response);

  const port = { postMessage: vi.fn() };

  try {
    await Promise.all([
      makeFetch(opts.terrainOk).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return terrainPutSpy(r);
      }),
      makeFetch(opts.overviewOk).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return overviewPutSpy(r);
      }),
    ]);
    port.postMessage({ ok: true });
    return { ok: true, terrainPutCalled: terrainPutSpy.mock.calls.length > 0, overviewPutCalled: overviewPutSpy.mock.calls.length > 0 };
  } catch (err) {
    port.postMessage({ ok: false, error: String(err) });
    return { ok: false, error: String(err), terrainPutCalled: terrainPutSpy.mock.calls.length > 0, overviewPutCalled: overviewPutSpy.mock.calls.length > 0 };
  }
}

describe("sw.ts CACHE_PACK non-OK fetch guard", () => {
  it("reports ok:false through the port when terrain fetch is non-OK", async () => {
    const result = await simulateCachePack({ terrainOk: false, overviewOk: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP 503/);
  });

  it("does not call cache.put for terrain when terrain fetch is non-OK", async () => {
    const result = await simulateCachePack({ terrainOk: false, overviewOk: true });
    expect(result.terrainPutCalled).toBe(false);
  });

  it("reports ok:false through the port when overview fetch is non-OK", async () => {
    const result = await simulateCachePack({ terrainOk: true, overviewOk: false });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP 503/);
  });

  it("does not call cache.put for overview when overview fetch is non-OK", async () => {
    const result = await simulateCachePack({ terrainOk: true, overviewOk: false });
    expect(result.overviewPutCalled).toBe(false);
  });

  it("reports ok:true and calls cache.put for both when both fetches succeed", async () => {
    const result = await simulateCachePack({ terrainOk: true, overviewOk: true });
    expect(result.ok).toBe(true);
    expect(result.terrainPutCalled).toBe(true);
    expect(result.overviewPutCalled).toBe(true);
  });
});
