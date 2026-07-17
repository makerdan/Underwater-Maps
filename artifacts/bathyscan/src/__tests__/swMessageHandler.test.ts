/**
 * Handler-level tests for the CACHE_PACK service-worker message handler.
 *
 * These tests call `handleCachePackMessage` directly with a mock event object
 * and a mocked global `caches`, verifying that:
 *   - `caches.open` is never invoked for messages that fail the runtime guard
 *   - `caches.open` IS invoked for a well-formed CACHE_PACK message
 *
 * This complements swHelpers.test.ts (which tests the pure predicate) by
 * exercising the full handler path: guard check → early return / waitUntil.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleCachePackMessage, PACK_TERRAIN_CACHE_NAME } from "@/lib/swMessageHandler";

function makeEvent(data: unknown): {
  data: unknown;
  ports: readonly never[];
  waitUntil: ReturnType<typeof vi.fn>;
} {
  return {
    data,
    ports: [],
    waitUntil: vi.fn(),
  };
}

const cachesOpenMock = vi.fn();

beforeEach(() => {
  cachesOpenMock.mockReset();
  vi.stubGlobal("caches", { open: cachesOpenMock });
});

describe("handleCachePackMessage — messages that must NOT reach caches.open", () => {
  it("exits early and does not call caches.open when data is null", () => {
    const event = makeEvent(null);
    handleCachePackMessage(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
    expect(cachesOpenMock).not.toHaveBeenCalled();
  });

  it("exits early and does not call caches.open when data is undefined", () => {
    const event = makeEvent(undefined);
    handleCachePackMessage(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
    expect(cachesOpenMock).not.toHaveBeenCalled();
  });

  it("exits early when type is UNKNOWN", () => {
    const event = makeEvent({ type: "UNKNOWN" });
    handleCachePackMessage(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
    expect(cachesOpenMock).not.toHaveBeenCalled();
  });

  it("exits early when data is a plain string", () => {
    const event = makeEvent("CACHE_PACK");
    handleCachePackMessage(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
    expect(cachesOpenMock).not.toHaveBeenCalled();
  });

  it("exits early when data is a number", () => {
    const event = makeEvent(42);
    handleCachePackMessage(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
    expect(cachesOpenMock).not.toHaveBeenCalled();
  });

  it("exits early when type is correct but value is an array (not an object)", () => {
    const event = makeEvent([{ type: "CACHE_PACK" }]);
    handleCachePackMessage(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
    expect(cachesOpenMock).not.toHaveBeenCalled();
  });
});

describe("handleCachePackMessage — valid CACHE_PACK message proceeds to caches.open", () => {
  it("calls waitUntil and opens the pack terrain cache for a valid message", async () => {
    const putMock = vi.fn().mockResolvedValue(undefined);
    const cacheMock = { put: putMock };
    cachesOpenMock.mockResolvedValue(cacheMock);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const event = makeEvent({
      type: "CACHE_PACK",
      terrainUrl: "/api/datasets/abc/terrain",
      overviewUrl: "/api/datasets/abc/overview",
    });

    handleCachePackMessage(event);

    expect(event.waitUntil).toHaveBeenCalledTimes(1);

    await event.waitUntil.mock.calls[0][0];

    expect(cachesOpenMock).toHaveBeenCalledWith(PACK_TERRAIN_CACHE_NAME);
  });
});
