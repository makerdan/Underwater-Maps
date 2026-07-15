/**
 * Unit tests for useTerrainTile object URL lifecycle.
 *
 * Covered:
 *   - Happy path: a fetched tile creates an object URL and publishes it to the store
 *   - Late-arriving fetch after unmount: the created object URL is revoked
 *     immediately and never published (no session leak)
 *   - Late-arriving persistent-cache (L2) hit after unmount is also revoked
 *   - Replacing an existing LRU entry for the same key revokes the old URL
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useTerrainTile } from "@/hooks/useTerrainTile";
import { useTerrainTileStore } from "@/lib/terrainTileStore";

vi.mock("@/lib/tileCache", () => ({
  getPersistentTile: vi.fn(async () => undefined),
  putPersistentTile: vi.fn(async () => undefined),
}));

import { getPersistentTile } from "@/lib/tileCache";

const BBOX = { minLon: -1, maxLon: 1, minLat: -1, maxLat: 1 };

let urlCounter = 0;
let createSpy: ReturnType<typeof vi.fn>;
let revokeSpy: ReturnType<typeof vi.fn>;

/** Deferred helper: a promise we can resolve from the test body. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function mockFetchWithDeferredBlob() {
  const blobDeferred = deferred<Blob>();
  const fetchMock = vi.fn(async () => ({
    ok: true,
    blob: () => blobDeferred.promise,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return { blobDeferred, fetchMock };
}

beforeEach(() => {
  urlCounter = 0;
  createSpy = vi.fn(() => `blob:mock-${++urlCounter}`);
  revokeSpy = vi.fn();
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: createSpy,
    revokeObjectURL: revokeSpy,
  });
  useTerrainTileStore.getState().clear();
  vi.mocked(getPersistentTile).mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useTerrainTile object URL lifecycle", () => {
  it("publishes an object URL on the happy path", async () => {
    const { blobDeferred } = mockFetchWithDeferredBlob();
    // Unique bbox per test so the module-level LRU never short-circuits.
    const bbox = { ...BBOX, maxLon: 1.001 };

    renderHook(() => useTerrainTile(bbox));
    blobDeferred.resolve(new Blob(["png"]));

    await waitFor(() => {
      expect(useTerrainTileStore.getState().tileUrl).toBe("blob:mock-1");
    });
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it("revokes the object URL when the network fetch resolves after unmount", async () => {
    const { blobDeferred, fetchMock } = mockFetchWithDeferredBlob();
    const bbox = { ...BBOX, maxLon: 1.002 };

    const { unmount } = renderHook(() => useTerrainTile(bbox));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    unmount();
    // Fetch completes only after the component is gone.
    blobDeferred.resolve(new Blob(["png"]));
    await new Promise((r) => setTimeout(r, 0));

    // Either the URL was never created, or it was created and revoked —
    // both mean no leak. It must never be published to the store.
    expect(createSpy.mock.calls.length).toBe(revokeSpy.mock.calls.length);
    expect(useTerrainTileStore.getState().tileUrl).toBeNull();
  });

  it("revokes the object URL when the persistent-cache hit resolves after unmount", async () => {
    const l2Deferred = deferred<Blob>();
    vi.mocked(getPersistentTile).mockReturnValue(l2Deferred.promise as never);
    vi.stubGlobal("fetch", vi.fn());
    const bbox = { ...BBOX, maxLon: 1.003 };

    const { unmount } = renderHook(() => useTerrainTile(bbox));
    unmount();
    l2Deferred.resolve(new Blob(["png"]));

    // Cancelled before the L2 await settles → no URL should ever be created.
    await new Promise((r) => setTimeout(r, 0));
    expect(createSpy).not.toHaveBeenCalled();
    expect(useTerrainTileStore.getState().tileUrl).toBeNull();
  });

  it("does not leak URLs across rapid bbox changes", async () => {
    const first = mockFetchWithDeferredBlob();
    const bboxA = { ...BBOX, maxLon: 1.004 };
    const bboxB = { ...BBOX, maxLon: 1.005 };

    const { rerender } = renderHook(({ bbox }) => useTerrainTile(bbox), {
      initialProps: { bbox: bboxA },
    });
    await waitFor(() => expect(first.fetchMock).toHaveBeenCalled());

    // Change bbox before the first fetch completes.
    const second = mockFetchWithDeferredBlob();
    rerender({ bbox: bboxB });
    await waitFor(() => expect(second.fetchMock).toHaveBeenCalled());

    // Late arrival of the first (now stale) blob must not leak: any URL it
    // created must be revoked, and it must never be published.
    first.blobDeferred.resolve(new Blob(["a"]));
    await new Promise((r) => setTimeout(r, 0));
    const staleCreated = createSpy.mock.calls.length;
    expect(staleCreated).toBe(revokeSpy.mock.calls.length);

    // Second blob publishes normally.
    second.blobDeferred.resolve(new Blob(["b"]));
    await waitFor(() => {
      expect(useTerrainTileStore.getState().tileUrl).toBe(
        `blob:mock-${staleCreated + 1}`,
      );
    });
    // The published URL is never revoked.
    expect(revokeSpy).not.toHaveBeenCalledWith(`blob:mock-${staleCreated + 1}`);
  });

  it("revokes the old URL when the LRU entry for the same key is replaced", async () => {
    // Two concurrent fetches for the same bboxKey (second instance mounts
    // after the store was cleared, so it doesn't reuse the in-flight fetch).
    // When both publish, the second lruPut replaces the first entry and must
    // revoke the first object URL instead of silently dropping it.
    const first = mockFetchWithDeferredBlob();
    const bbox = { ...BBOX, maxLon: 1.006 };

    renderHook(() => useTerrainTile(bbox));
    await waitFor(() => expect(first.fetchMock).toHaveBeenCalled());

    useTerrainTileStore.getState().clear();
    const second = mockFetchWithDeferredBlob();
    renderHook(() => useTerrainTile(bbox));
    await waitFor(() => expect(second.fetchMock).toHaveBeenCalled());

    first.blobDeferred.resolve(new Blob(["a"]));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));

    second.blobDeferred.resolve(new Blob(["b"]));
    await waitFor(() => {
      expect(useTerrainTileStore.getState().tileUrl).toBe("blob:mock-2");
    });
    // The first URL (same key, replaced in the LRU) must be revoked.
    expect(revokeSpy).toHaveBeenCalledWith("blob:mock-1");
    expect(revokeSpy).not.toHaveBeenCalledWith("blob:mock-2");
  });
});
