/**
 * Handler-level tests for the CACHE_PACK_MARKERS service-worker message
 * handler, plus the markersUrl extension of DELETE_PACK_CACHE.
 *
 * These tests call the handlers directly with mock event objects and a
 * mocked global `caches`, verifying that:
 *   - `caches.open` is never invoked for messages that fail the runtime guard
 *   - A well-formed CACHE_PACK_MARKERS message puts a synthetic JSON Response
 *     at the marker URL inside PACK_TERRAIN_CACHE_NAME
 *   - The port receives `{ ok: true }` on success, `{ ok: false }` on failure
 *   - DELETE_PACK_CACHE with a markersUrl deletes three entries; without it,
 *     the legacy two-entry behaviour is preserved (backwards compat)
 *
 * Complements offlinePackStore.markersPack.test.ts (which verifies the
 * messages are *sent* by the store) by exercising the SW handlers that
 * actually touch the cache — without needing a real SW.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleCachePackMarkersMessage,
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

const MARKERS_URL = "/api/markers?datasetId=ds-abc";
const MARKERS_BODY = JSON.stringify([{ id: "m1", label: "Reef" }]);

// ---------------------------------------------------------------------------
// Guard tests — messages that must NOT reach caches.open
// ---------------------------------------------------------------------------

describe("handleCachePackMarkersMessage — guard", () => {
  it.each([
    ["null data", null],
    ["undefined data", undefined],
    ["wrong type (CACHE_PACK)", { type: "CACHE_PACK" }],
    ["plain string", "CACHE_PACK_MARKERS"],
    ["missing markersUrl", { type: "CACHE_PACK_MARKERS", body: "[]" }],
    ["missing body", { type: "CACHE_PACK_MARKERS", markersUrl: MARKERS_URL }],
    [
      "non-string body",
      { type: "CACHE_PACK_MARKERS", markersUrl: MARKERS_URL, body: [] },
    ],
  ])("exits early for %s", (_label, data) => {
    const event = makeEvent(data);
    handleCachePackMarkersMessage(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
    expect(cachesOpenMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("handleCachePackMarkersMessage — valid message", () => {
  it("puts a synthetic JSON Response at the marker URL in the pack cache", async () => {
    const putMock = vi.fn().mockResolvedValue(undefined);
    cachesOpenMock.mockResolvedValue({ put: putMock });

    const port = makePort();
    const event = makeEvent(
      { type: "CACHE_PACK_MARKERS", markersUrl: MARKERS_URL, body: MARKERS_BODY },
      port,
    );

    handleCachePackMarkersMessage(event);
    expect(event.waitUntil).toHaveBeenCalledTimes(1);
    await event.waitUntil.mock.calls[0][0];

    expect(cachesOpenMock).toHaveBeenCalledWith(PACK_TERRAIN_CACHE_NAME);
    expect(putMock).toHaveBeenCalledTimes(1);

    const [url, response] = putMock.mock.calls[0] as [string, Response];
    expect(url).toBe(MARKERS_URL);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.text()).resolves.toBe(MARKERS_BODY);

    expect(port.postMessage).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledWith({ ok: true });
  });

  it("posts { ok: false } when caches.open rejects and does not propagate", async () => {
    cachesOpenMock.mockRejectedValue(new Error("Cache API unavailable"));

    const port = makePort();
    const event = makeEvent(
      { type: "CACHE_PACK_MARKERS", markersUrl: MARKERS_URL, body: MARKERS_BODY },
      port,
    );

    handleCachePackMarkersMessage(event);
    await expect(event.waitUntil.mock.calls[0][0]).resolves.toBeUndefined();

    expect(port.postMessage).toHaveBeenCalledTimes(1);
    const call = port.postMessage.mock.calls[0][0] as { ok: boolean; error: string };
    expect(call.ok).toBe(false);
    expect(call.error).toContain("Cache API unavailable");
  });
});

// ---------------------------------------------------------------------------
// DELETE_PACK_CACHE — markersUrl extension
// ---------------------------------------------------------------------------

describe("handleDeletePackCacheMessage — markersUrl extension", () => {
  const TERRAIN_URL = "/api/datasets/ds-abc/terrain";
  const OVERVIEW_URL = "/api/datasets/ds-abc/overview";

  it("also deletes the marker URL when markersUrl is present", async () => {
    const deleteMock = vi.fn().mockResolvedValue(true);
    cachesOpenMock.mockResolvedValue({ delete: deleteMock });

    const port = makePort();
    const event = makeEvent(
      {
        type: "DELETE_PACK_CACHE",
        terrainUrl: TERRAIN_URL,
        overviewUrl: OVERVIEW_URL,
        markersUrl: MARKERS_URL,
      },
      port,
    );

    handleDeletePackCacheMessage(event);
    await event.waitUntil.mock.calls[0][0];

    expect(deleteMock).toHaveBeenCalledTimes(3);
    expect(deleteMock).toHaveBeenCalledWith(TERRAIN_URL);
    expect(deleteMock).toHaveBeenCalledWith(OVERVIEW_URL);
    expect(deleteMock).toHaveBeenCalledWith(MARKERS_URL);
    expect(port.postMessage).toHaveBeenCalledWith({ ok: true });
  });

  it("keeps the legacy two-delete behaviour when markersUrl is absent", async () => {
    const deleteMock = vi.fn().mockResolvedValue(true);
    cachesOpenMock.mockResolvedValue({ delete: deleteMock });

    const event = makeEvent({
      type: "DELETE_PACK_CACHE",
      terrainUrl: TERRAIN_URL,
      overviewUrl: OVERVIEW_URL,
    });

    handleDeletePackCacheMessage(event);
    await event.waitUntil.mock.calls[0][0];

    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(deleteMock).toHaveBeenCalledWith(TERRAIN_URL);
    expect(deleteMock).toHaveBeenCalledWith(OVERVIEW_URL);
  });

  it("ignores a non-string markersUrl (defensive)", async () => {
    const deleteMock = vi.fn().mockResolvedValue(true);
    cachesOpenMock.mockResolvedValue({ delete: deleteMock });

    const event = makeEvent({
      type: "DELETE_PACK_CACHE",
      terrainUrl: TERRAIN_URL,
      overviewUrl: OVERVIEW_URL,
      markersUrl: 42,
    });

    handleDeletePackCacheMessage(event);
    await event.waitUntil.mock.calls[0][0];

    expect(deleteMock).toHaveBeenCalledTimes(2);
  });
});
