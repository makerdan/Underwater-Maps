/**
 * specialCollectionStore — in-flight activation race guards.
 *
 * activateForPuzzle() awaits the authenticated background-image fetch. If a
 * sign-out (or a switch to another collection) happens while that request is
 * in flight, the stale continuation must be discarded — otherwise it would
 * repopulate the previous account's decoded reference image, metadata, and
 * queued layout restore after the cleanup already ran (cross-account
 * disclosure through the async race).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const deferredFetch = vi.hoisted(() => {
  const state: {
    resolvers: Array<(blob: Blob) => void>;
    calls: string[];
  } = { resolvers: [], calls: [] };
  return state;
});

vi.mock("@workspace/api-client-react", () => ({
  getUserCollectionsIdBackground: vi.fn((collectionId: string) => {
    deferredFetch.calls.push(collectionId);
    return new Promise<Blob>((resolve) => {
      deferredFetch.resolvers.push(resolve);
    });
  }),
}));

import {
  useSpecialCollectionStore,
} from "@/lib/specialCollectionStore";
import type { DatasetCollection } from "@workspace/api-client-react";

// jsdom lacks createImageBitmap; make the decode path resolve deterministically.
beforeEach(() => {
  deferredFetch.resolvers.length = 0;
  deferredFetch.calls.length = 0;
  (globalThis as Record<string, unknown>).createImageBitmap = vi.fn(async () => ({
    width: 640,
    height: 480,
    close: () => {},
  }));
  useSpecialCollectionStore.setState({ active: null, pendingRestore: null, pendingPuzzleOn: 0 });
});

function makeCollection(id: string, withImage = true): DatasetCollection {
  return {
    id,
    name: `Collection ${id}`,
    collectionKind: "special",
    datasetIds: ["ds-a"],
    specialMeta: {
      bgImageKey: withImage ? `bg-${id}` : null,
      bgOpacity: 0.5,
      bgGeoAnchors: null,
      layoutRevisions: [
        {
          id: `rev-${id}`,
          name: "rev",
          savedAt: "2026-08-18T00:00:00Z",
          tiles: [{ datasetId: "ds-a", tx: 1, ty: 2, angleDeg: 0 }],
          groups: [],
        },
      ],
      activeRevisionId: `rev-${id}`,
    },
  } as unknown as DatasetCollection;
}

describe("specialCollectionStore — in-flight activation races", () => {
  it("sign-out during the background-image fetch discards the stale activation entirely", async () => {
    const store = useSpecialCollectionStore.getState();
    const activation = store.activateForPuzzle(makeCollection("col-1"));
    expect(deferredFetch.calls).toEqual(["col-1"]);

    // Sign-out lands while the authed image request is still in flight.
    useSpecialCollectionStore.getState().resetForSignOut();

    // The request then resolves for the OLD account.
    deferredFetch.resolvers[0]!(new Blob(["x"], { type: "image/png" }));
    await activation;

    // Nothing may reappear: no active collection, no queued restore, no
    // puzzle-on signal.
    const s = useSpecialCollectionStore.getState();
    expect(s.active).toBeNull();
    expect(s.pendingRestore).toBeNull();
    expect(s.pendingPuzzleOn).toBe(0);
  });

  it("deactivate during the fetch also discards the stale continuation", async () => {
    const activation = useSpecialCollectionStore
      .getState()
      .activateForPuzzle(makeCollection("col-1"));

    useSpecialCollectionStore.getState().deactivate();

    deferredFetch.resolvers[0]!(new Blob(["x"], { type: "image/png" }));
    await activation;

    const s = useSpecialCollectionStore.getState();
    expect(s.active).toBeNull();
    expect(s.pendingRestore).toBeNull();
  });

  it("rapid switch between collections: the earlier activation resolving LAST cannot clobber the newer one", async () => {
    const store = useSpecialCollectionStore.getState();
    const first = store.activateForPuzzle(makeCollection("col-1"));
    const second = store.activateForPuzzle(makeCollection("col-2"));
    expect(deferredFetch.calls).toEqual(["col-1", "col-2"]);

    // Second collection's image arrives first…
    deferredFetch.resolvers[1]!(new Blob(["b"], { type: "image/png" }));
    await second;
    expect(useSpecialCollectionStore.getState().active?.collectionId).toBe("col-2");
    const restoreAfterSecond = useSpecialCollectionStore.getState().pendingRestore;
    expect(restoreAfterSecond?.payload.tiles[0]?.datasetId).toBe("ds-a");

    // …then the FIRST collection's slow image arrives. It must be discarded.
    deferredFetch.resolvers[0]!(new Blob(["a"], { type: "image/png" }));
    await first;

    const s = useSpecialCollectionStore.getState();
    expect(s.active?.collectionId).toBe("col-2");
    // The queued restore was not replaced by the stale collection's revision.
    expect(s.pendingRestore?.requestId).toBe(restoreAfterSecond?.requestId);
  });

  it("reloadBgImage resolving after sign-out does not repopulate the image", async () => {
    // Activate with no image so activation completes synchronously.
    await useSpecialCollectionStore.getState().activateForPuzzle(makeCollection("col-1", false));
    expect(useSpecialCollectionStore.getState().active?.collectionId).toBe("col-1");

    const reload = useSpecialCollectionStore.getState().reloadBgImage("col-1");
    useSpecialCollectionStore.getState().resetForSignOut();
    deferredFetch.resolvers[0]!(new Blob(["x"], { type: "image/png" }));
    await reload;

    expect(useSpecialCollectionStore.getState().active).toBeNull();
  });
});
