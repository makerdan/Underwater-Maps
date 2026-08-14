/**
 * Handler-level tests for the DELETE_PACK_CACHE service-worker message handler.
 *
 * These tests call `handleDeletePackCacheMessage` directly with a mock event
 * object and a mocked global `caches`, verifying that:
 *   - `caches.open` is never invoked for messages that fail the runtime guard
 *   - Both terrain and overview URLs are deleted from PACK_TERRAIN_CACHE_NAME
 *     for a well-formed DELETE_PACK_CACHE message
 *   - The port receives `{ ok: true }` on success
 *   - The port receives `{ ok: false }` when `caches.open` throws
 *
 * This complements offlinePackStore.idbFailure.test.ts (which verifies the
 * DELETE_PACK_CACHE message is *sent* by the store) by exercising the SW
 * handler that actually performs the deletion — without needing a real SW.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleDeletePackCacheMessage,
  PACK_TERRAIN_CACHE_NAME,
} from "@/lib/swMessageHandler";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePort() {
  return { postMessage: vi.fn() };
}

function makeEvent(
  data: unknown,
  port?: ReturnType<typeof makePort>,
): {
  data: unknown;
  ports: readonly Pick<ReturnType<typeof makePort>, "postMessage">[];
  waitUntil: ReturnType<typeof vi.fn>;
} {
  return {
    data,
    ports: port ? [port] : [],
    waitUntil: vi.fn(),
  };
}

const cachesOpenMock = vi.fn();

beforeEach(() => {
  cachesOpenMock.mockReset();
  vi.stubGlobal("caches", { open: cachesOpenMock });
});

// ---------------------------------------------------------------------------
// Guard tests — messages that must NOT reach caches.open
// ---------------------------------------------------------------------------

describe("handleDeletePackCacheMessage — messages that must NOT reach caches.open", () => {
  it("exits early for null data", () => {
    const event = makeEvent(null);
    handleDeletePackCacheMessage(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
    expect(cachesOpenMock).not.toHaveBeenCalled();
  });

  it("exits early for undefined data", () => {
    const event = makeEvent(undefined);
    handleDeletePackCacheMessage(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
    expect(cachesOpenMock).not.toHaveBeenCalled();
  });

  it("exits early when type is CACHE_PACK (wrong handler)", () => {
    const event = makeEvent({ type: "CACHE_PACK" });
    handleDeletePackCacheMessage(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
    expect(cachesOpenMock).not.toHaveBeenCalled();
  });

  it("exits early when type is UNKNOWN", () => {
    const event = makeEvent({ type: "UNKNOWN" });
    handleDeletePackCacheMessage(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
    expect(cachesOpenMock).not.toHaveBeenCalled();
  });

  it("exits early for a plain string", () => {
    const event = makeEvent("DELETE_PACK_CACHE");
    handleDeletePackCacheMessage(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
    expect(cachesOpenMock).not.toHaveBeenCalled();
  });

  it("exits early for an array (not a plain object)", () => {
    const event = makeEvent([{ type: "DELETE_PACK_CACHE" }]);
    handleDeletePackCacheMessage(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
    expect(cachesOpenMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Happy-path tests — valid DELETE_PACK_CACHE message
// ---------------------------------------------------------------------------

describe("handleDeletePackCacheMessage — valid DELETE_PACK_CACHE message", () => {
  const TERRAIN_URL = "/api/datasets/abc/terrain";
  const OVERVIEW_URL = "/api/datasets/abc/overview";

  it("opens PACK_TERRAIN_CACHE_NAME and deletes both URLs", async () => {
    const deleteMock = vi.fn().mockResolvedValue(true);
    cachesOpenMock.mockResolvedValue({ delete: deleteMock });

    const event = makeEvent({
      type: "DELETE_PACK_CACHE",
      terrainUrl: TERRAIN_URL,
      overviewUrl: OVERVIEW_URL,
    });

    handleDeletePackCacheMessage(event);

    expect(event.waitUntil).toHaveBeenCalledTimes(1);

    // Await the promise passed to waitUntil so all async work completes.
    await event.waitUntil.mock.calls[0][0];

    expect(cachesOpenMock).toHaveBeenCalledWith(PACK_TERRAIN_CACHE_NAME);
    expect(deleteMock).toHaveBeenCalledWith(TERRAIN_URL);
    expect(deleteMock).toHaveBeenCalledWith(OVERVIEW_URL);
    expect(deleteMock).toHaveBeenCalledTimes(2);
  });

  it("posts { ok: true } to the port on success", async () => {
    const deleteMock = vi.fn().mockResolvedValue(true);
    cachesOpenMock.mockResolvedValue({ delete: deleteMock });

    const port = makePort();
    const event = makeEvent(
      {
        type: "DELETE_PACK_CACHE",
        terrainUrl: TERRAIN_URL,
        overviewUrl: OVERVIEW_URL,
      },
      port,
    );

    handleDeletePackCacheMessage(event);
    await event.waitUntil.mock.calls[0][0];

    expect(port.postMessage).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledWith({ ok: true });
  });

  it("deletes both URLs even when cache.delete resolves false (entry absent)", async () => {
    // cache.delete returns false when the entry was not present — the handler
    // should still attempt both deletes without error.
    const deleteMock = vi.fn().mockResolvedValue(false);
    cachesOpenMock.mockResolvedValue({ delete: deleteMock });

    const port = makePort();
    const event = makeEvent(
      {
        type: "DELETE_PACK_CACHE",
        terrainUrl: TERRAIN_URL,
        overviewUrl: OVERVIEW_URL,
      },
      port,
    );

    handleDeletePackCacheMessage(event);
    await event.waitUntil.mock.calls[0][0];

    expect(deleteMock).toHaveBeenCalledWith(TERRAIN_URL);
    expect(deleteMock).toHaveBeenCalledWith(OVERVIEW_URL);
    expect(port.postMessage).toHaveBeenCalledWith({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Error-path tests — caches.open throws
// ---------------------------------------------------------------------------

describe("handleDeletePackCacheMessage — caches.open throws", () => {
  it("posts { ok: false } to the port when caches.open rejects", async () => {
    const boom = new Error("Cache API unavailable");
    cachesOpenMock.mockRejectedValue(boom);

    const port = makePort();
    const event = makeEvent(
      {
        type: "DELETE_PACK_CACHE",
        terrainUrl: "/api/datasets/xyz/terrain",
        overviewUrl: "/api/datasets/xyz/overview",
      },
      port,
    );

    handleDeletePackCacheMessage(event);
    await event.waitUntil.mock.calls[0][0];

    expect(port.postMessage).toHaveBeenCalledTimes(1);
    const call = port.postMessage.mock.calls[0][0] as {
      ok: boolean;
      error: string;
    };
    expect(call.ok).toBe(false);
    expect(call.error).toContain("Cache API unavailable");
  });

  it("does not propagate the error (waitUntil promise resolves)", async () => {
    cachesOpenMock.mockRejectedValue(new Error("boom"));

    const event = makeEvent({
      type: "DELETE_PACK_CACHE",
      terrainUrl: "/api/datasets/xyz/terrain",
      overviewUrl: "/api/datasets/xyz/overview",
    });

    handleDeletePackCacheMessage(event);

    // Should resolve (not reject) so the SW event loop is not broken.
    await expect(event.waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });
});
