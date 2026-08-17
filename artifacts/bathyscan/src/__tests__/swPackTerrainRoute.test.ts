/**
 * Regression tests for the pack-first terrain/overview SW route handler.
 *
 * Guards F-002: terrain tiles saved in the persistent `bathyscan-pack-terrain`
 * cache used to be served ONLY when the request carried an
 * `x-serve-from-pack: 1` header — a header no normal terrain load ever sent —
 * so saved offline packs silently stopped loading after every app update
 * wiped the versioned runtime cache.
 *
 * These tests assert that `createPackFirstHandler` serves a pack-cached URL
 * regardless of whether the header is present (they fail if the header gate
 * is ever re-introduced), and that cache misses / Cache API failures fall
 * through to the runtime strategy.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPackFirstHandler } from "@/lib/swPackFirstHandler";
import { PACK_TERRAIN_CACHE_NAME } from "@/lib/swMessageHandler";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TERRAIN_URL = "https://example.com/api/datasets/abc/terrain?res=10";

/** Minimal Request-like object — the handler only reads `request.url`. */
function makeRequest(url: string, headers: Record<string, string> = {}): Request {
  return { url, headers: new Headers(headers) } as unknown as Request;
}

function makeStrategy(response?: Response) {
  return {
    handle: vi
      .fn()
      .mockResolvedValue(response ?? new Response("from-network", { status: 200 })),
  };
}

const cachesOpenMock = vi.fn();

beforeEach(() => {
  cachesOpenMock.mockReset();
  vi.stubGlobal("caches", { open: cachesOpenMock });
});

// ---------------------------------------------------------------------------
// Pack-cache hits — served with and without the legacy header
// ---------------------------------------------------------------------------

describe("createPackFirstHandler — pack cache hit", () => {
  it("returns the pack-cached response WITHOUT the x-serve-from-pack header (F-002 regression)", async () => {
    const cached = new Response("pack-terrain-bytes", { status: 200 });
    const matchMock = vi.fn().mockResolvedValue(cached);
    cachesOpenMock.mockResolvedValue({ match: matchMock });

    const strategy = makeStrategy();
    const handler = createPackFirstHandler(strategy);

    // Plain terrain load — exactly what the 3D viewer sends: no header.
    const request = makeRequest(TERRAIN_URL);
    const result = await handler({ event: undefined, request });

    expect(result).toBe(cached);
    expect(cachesOpenMock).toHaveBeenCalledWith(PACK_TERRAIN_CACHE_NAME);
    expect(matchMock).toHaveBeenCalledWith(TERRAIN_URL, { ignoreVary: true });
    // The runtime strategy must NOT be consulted on a pack hit.
    expect(strategy.handle).not.toHaveBeenCalled();
  });

  it("returns the pack-cached response WITH the x-serve-from-pack header (bulk probe path)", async () => {
    const cached = new Response("pack-terrain-bytes", { status: 200 });
    cachesOpenMock.mockResolvedValue({ match: vi.fn().mockResolvedValue(cached) });

    const strategy = makeStrategy();
    const handler = createPackFirstHandler(strategy);

    const request = makeRequest(TERRAIN_URL, { "x-serve-from-pack": "1" });
    const result = await handler({ event: undefined, request });

    expect(result).toBe(cached);
    expect(strategy.handle).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fall-through paths
// ---------------------------------------------------------------------------

describe("createPackFirstHandler — fall-through to runtime strategy", () => {
  it("delegates to the runtime strategy on a pack-cache miss", async () => {
    cachesOpenMock.mockResolvedValue({ match: vi.fn().mockResolvedValue(undefined) });

    const networkResponse = new Response("fresh", { status: 200 });
    const strategy = makeStrategy(networkResponse);
    const handler = createPackFirstHandler(strategy);

    const request = makeRequest(TERRAIN_URL);
    const result = await handler({ event: "evt", request });

    expect(result).toBe(networkResponse);
    expect(strategy.handle).toHaveBeenCalledTimes(1);
    expect(strategy.handle).toHaveBeenCalledWith({ event: "evt", request });
  });

  it("delegates to the runtime strategy when caches.open rejects", async () => {
    cachesOpenMock.mockRejectedValue(new Error("Cache API unavailable"));

    const networkResponse = new Response("fresh", { status: 200 });
    const strategy = makeStrategy(networkResponse);
    const handler = createPackFirstHandler(strategy);

    const result = await handler({
      event: undefined,
      request: makeRequest(TERRAIN_URL),
    });

    expect(result).toBe(networkResponse);
    expect(strategy.handle).toHaveBeenCalledTimes(1);
  });

  it("delegates to the runtime strategy when cache.match rejects", async () => {
    cachesOpenMock.mockResolvedValue({
      match: vi.fn().mockRejectedValue(new Error("match failed")),
    });

    const networkResponse = new Response("fresh", { status: 200 });
    const strategy = makeStrategy(networkResponse);
    const handler = createPackFirstHandler(strategy);

    const result = await handler({
      event: undefined,
      request: makeRequest(TERRAIN_URL),
    });

    expect(result).toBe(networkResponse);
    expect(strategy.handle).toHaveBeenCalledTimes(1);
  });

  it("propagates the runtime strategy's rejection on a pack miss (offline, no cache anywhere)", async () => {
    cachesOpenMock.mockResolvedValue({ match: vi.fn().mockResolvedValue(undefined) });

    const strategy = { handle: vi.fn().mockRejectedValue(new Error("no-response")) };
    const handler = createPackFirstHandler(strategy);

    await expect(
      handler({ event: undefined, request: makeRequest(TERRAIN_URL) }),
    ).rejects.toThrow("no-response");
  });
});
