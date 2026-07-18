/**
 * Guards the isMountedRef unmount protection in useUpscaledHeatmap.
 *
 * When a Poe upscale request is in flight and the component unmounts before
 * the response arrives, the hook must NOT:
 *   - call idbSet (orphaned IDB write)
 *   - call setIsUpscaling(false) or setUpscaledBitmap(img) (state update on
 *     an unmounted component — wasted work and potential React scheduling issue)
 *
 * Strategy:
 *   - vi.mock "@/lib/upscaleIdb" so idbSet becomes a spy and IDB ops are
 *     no-ops (no real browser IDB needed).
 *   - vi.mock "@/lib/authorizedFetch" so the Poe fetch is controlled by a
 *     deferred promise the test can resolve at will.
 *   - Render useUpscaledHeatmap; call requestUpscaleIfNeeded with args that
 *     pass all guard conditions (pixelsPerCell > 2, scale < 4, cache miss).
 *   - Unmount before the deferred resolves.
 *   - Resolve the deferred and flush timers.
 *   - Assert idbSet was never called.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUpscaledHeatmap } from "@/hooks/useUpscaledHeatmap";

// ---------------------------------------------------------------------------
// Module mocks — hoisted before any imports
// ---------------------------------------------------------------------------

vi.mock("@/lib/upscaleIdb", () => ({
  idbGet: vi.fn(async () => null),
  idbSet: vi.fn(async () => undefined),
  idbDelete: vi.fn(async () => undefined),
  initIdbCache: vi.fn(async () => undefined),
  clearIdbStore: vi.fn(async () => undefined),
  getIdbCacheInfo: vi.fn(async () => ({ count: 0, bytes: 0 })),
}));

vi.mock("@/lib/authorizedFetch", () => ({
  authorizedFetch: vi.fn(),
}));

import { idbSet } from "@/lib/upscaleIdb";
import { authorizedFetch } from "@/lib/authorizedFetch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Build a fake HTMLCanvasElement that:
 *   - reports width=100, height=100
 *   - returns null from getContext (triggers timestamp-based fallback hash)
 *   - toDataURL returns a minimal data URL
 */
function makeFakeCanvas(): HTMLCanvasElement {
  return {
    width: 100,
    height: 100,
    getContext: () => null,
    toDataURL: () => "data:image/png;base64,abc==",
  } as unknown as HTMLCanvasElement;
}

/**
 * Transform + grid values chosen so that:
 *   imageSmoothingEnabled = (scale < 4) = true  (scale = 1)
 *   pixelsPerCell = pxPerDeg * lonRange * scale / width
 *               = 100 * 1 * 1 / 10 = 10 > 2  → upscale triggers
 */
function makeTransformAndGrid() {
  const transform = { scale: 1, pxPerDeg: 100, offsetX: 0, offsetY: 0 };
  const grid = {
    minLon: -122, maxLon: -121, minLat: 47, maxLat: 48,
    width: 10, height: 10,
    depths: [],
    minDepth: 0, maxDepth: 100,
    datasetId: "test", name: "Test", resolution: 10,
    centerLon: -121.5, centerLat: 47.5,
    waterType: "saltwater",
  };
  return { transform, grid };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * jsdom's Image does not fire onload for data: URLs.  Stub it so that setting
 * .src immediately schedules onload via setTimeout — this makes fake-timer
 * based tests work correctly without real network activity.
 */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  complete = true;
  naturalWidth = 1;
  naturalHeight = 1;
  private _src = "";
  get src() { return this._src; }
  set src(value: string) {
    this._src = value;
    setTimeout(() => this.onload?.());
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Image", FakeImage);
  vi.mocked(idbSet).mockReset();
  vi.mocked(authorizedFetch).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useUpscaledHeatmap — isMountedRef unmount guard", () => {
  it("does NOT call idbSet when the component unmounts before the Poe fetch resolves", async () => {
    const fetchDeferred = deferred<Response>();

    vi.mocked(authorizedFetch).mockReturnValue(fetchDeferred.promise);

    const { result, unmount } = renderHook(() => useUpscaledHeatmap());

    const canvas = makeFakeCanvas();
    const { transform, grid } = makeTransformAndGrid();

    act(() => {
      void result.current.requestUpscaleIfNeeded(
        canvas,
        transform as never,
        grid as never,
      );
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    unmount();

    const responseBody = JSON.stringify({ imageBase64: "data:image/png;base64,abc==" });
    const fakeResponse = {
      ok: true,
      json: async () => JSON.parse(responseBody) as unknown,
    } as Response;

    await act(async () => {
      fetchDeferred.resolve(fakeResponse);
      await vi.runAllTimersAsync();
    });

    expect(vi.mocked(idbSet)).not.toHaveBeenCalled();
  });

  it("DOES call idbSet when the component is still mounted when the Poe fetch resolves", async () => {
    const fetchDeferred = deferred<Response>();

    vi.mocked(authorizedFetch).mockReturnValue(fetchDeferred.promise);

    const canvas = makeFakeCanvas();
    const { transform, grid } = makeTransformAndGrid();

    const { result, unmount } = renderHook(() => useUpscaledHeatmap());

    act(() => {
      void result.current.requestUpscaleIfNeeded(
        canvas,
        transform as never,
        grid as never,
      );
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const responseBody = JSON.stringify({ imageBase64: "data:image/png;base64,abc==" });
    const fakeResponse = {
      ok: true,
      json: async () => JSON.parse(responseBody) as unknown,
    } as Response;

    await act(async () => {
      fetchDeferred.resolve(fakeResponse);
      await vi.runAllTimersAsync();
    });

    expect(vi.mocked(idbSet)).toHaveBeenCalledTimes(1);

    unmount();
  });
});

describe("useUpscaledHeatmap — in-flight request abort", () => {
  function getPassedSignal(): AbortSignal {
    const init = vi.mocked(authorizedFetch).mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return init!.signal as AbortSignal;
  }

  it("passes an AbortSignal to authorizedFetch and aborts it on unmount", async () => {
    const fetchDeferred = deferred<Response>();
    vi.mocked(authorizedFetch).mockReturnValue(fetchDeferred.promise);

    const { result, unmount } = renderHook(() => useUpscaledHeatmap());
    const canvas = makeFakeCanvas();
    const { transform, grid } = makeTransformAndGrid();

    act(() => {
      void result.current.requestUpscaleIfNeeded(
        canvas,
        transform as never,
        grid as never,
      );
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const signal = getPassedSignal();
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);

    // Settle the fetch as an abort rejection — must be swallowed silently.
    await act(async () => {
      fetchDeferred.reject(new DOMException("Aborted", "AbortError"));
      await vi.runAllTimersAsync();
    });
    expect(vi.mocked(idbSet)).not.toHaveBeenCalled();
  });

  it("aborts the in-flight request when invalidate() is called", async () => {
    const fetchDeferred = deferred<Response>();
    vi.mocked(authorizedFetch).mockReturnValue(fetchDeferred.promise);

    const { result, unmount } = renderHook(() => useUpscaledHeatmap());
    const canvas = makeFakeCanvas();
    const { transform, grid } = makeTransformAndGrid();

    act(() => {
      void result.current.requestUpscaleIfNeeded(
        canvas,
        transform as never,
        grid as never,
      );
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const signal = getPassedSignal();
    expect(signal.aborted).toBe(false);

    act(() => {
      result.current.invalidate();
    });
    expect(signal.aborted).toBe(true);

    await act(async () => {
      fetchDeferred.reject(new DOMException("Aborted", "AbortError"));
      await vi.runAllTimersAsync();
    });

    expect(vi.mocked(idbSet)).not.toHaveBeenCalled();
    expect(result.current.isUpscaling).toBe(false);
    unmount();
  });
});
