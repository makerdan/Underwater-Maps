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
import {
  handleCachePackMessage,
  handleCommitPackCacheMessage,
  PACK_TERRAIN_CACHE_NAME,
} from "@/lib/swMessageHandler";

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

  it("does not let a cancelled older transaction overwrite a committed retry", async () => {
    const packEntries = new Map<string, Response>();
    const transactionEntries = new Map<string, Response>();
    const makeCache = (entries: Map<string, Response>) => ({
      match: async (url: string) => entries.get(url)?.clone(),
      put: async (url: string, response: Response) => {
        entries.set(url, response.clone());
      },
      delete: async (url: string) => entries.delete(url),
    });
    const packCache = makeCache(packEntries);
    const transactionCache = makeCache(transactionEntries);
    cachesOpenMock.mockImplementation((name: string) =>
      Promise.resolve(name === PACK_TERRAIN_CACHE_NAME ? packCache : transactionCache),
    );

    const deferredFetches: ((response: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            deferredFetches.push(resolve);
          }),
      ),
    );
    const terrainUrl = "/api/datasets/race/terrain";
    const overviewUrl = "/api/datasets/race/overview";
    const older = makeEvent({
      type: "CACHE_PACK",
      terrainUrl,
      overviewUrl,
      transactionId: "older",
    });
    handleCachePackMessage(older);
    await vi.waitFor(() => expect(deferredFetches).toHaveLength(2));

    const retry = makeEvent({
      type: "CACHE_PACK",
      terrainUrl,
      overviewUrl,
      terrainBody: "retry-terrain",
      overviewBody: "retry-overview",
      transactionId: "retry",
    });
    handleCachePackMessage(retry);
    await retry.waitUntil.mock.calls[0][0];

    const commit = makeEvent({
      type: "COMMIT_PACK_CACHE",
      terrainUrl,
      overviewUrl,
      markersUrl: "/api/markers?datasetId=race",
      transactionId: "retry",
    });
    handleCommitPackCacheMessage(commit);
    await commit.waitUntil.mock.calls[0][0];

    deferredFetches.forEach((resolve) => resolve(new Response("older-response")));
    await older.waitUntil.mock.calls[0][0];

    expect(await packEntries.get(terrainUrl)?.text()).toBe("retry-terrain");
    expect(await packEntries.get(overviewUrl)?.text()).toBe("retry-overview");
  });
});
