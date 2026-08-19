/**
 * puzzleStore — cross-device settings-sync regression guard (Task 4219).
 *
 * Regression scenario: a settings PUT → GET round-trip (cross-device sync)
 * must NOT wipe or mutate puzzle tile flip state.
 *
 * Two independent guarantees are pinned here:
 *
 *  1. `useSettingsStore.hydrateFromServer()` (the function that applies the
 *     parsed server GET /api/settings response) never touches
 *     `usePuzzleStore.puzzleTransforms` or the sessionStorage mirror that
 *     OverviewMap re-hydrates from. Live tile flips survive a sync.
 *
 *  2. Saved puzzle layouts (`settingsStore.puzzleLayouts`) keep their tiles'
 *     `flipH` / `flipV` fields through parseSettingsResponse + hydrate — if a
 *     future schema change strips unknown nested fields before applying the
 *     server response, these tests fail and block the merge.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { usePuzzleStore, type PuzzleTransform } from "@/lib/puzzleStore";
import { useSettingsStore, type PuzzleLayout } from "@/lib/settingsStore";
import { parseSettingsResponse } from "@/lib/settingsResponseSchema";

const FLIPPED: PuzzleTransform = {
  tx: 12,
  ty: -8,
  angleDeg: 45,
  flipH: true,
  flipV: true,
};

const SAVED_LAYOUT: PuzzleLayout = {
  id: "layout-1",
  name: "Harbor arrangement",
  tiles: [
    { datasetId: "ds-a", tx: 10, ty: 5, angleDeg: 30, flipH: true, flipV: false },
    { datasetId: "ds-b", tx: -4, ty: 0, angleDeg: 0, flipH: false, flipV: true },
  ],
  groups: [["ds-a", "ds-b"]],
};

/** A server GET /api/settings response body, as the sync hook receives it. */
function serverResponse(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    __updatedAt: new Date(Date.now() + 60_000).toISOString(), // server is newer
    units: "metric",
    puzzleLayouts: [SAVED_LAYOUT],
    ...extra,
  };
}

/** Parse + hydrate exactly the way useServerSettingsSync does. */
function applyServerSync(payload: Record<string, unknown>) {
  const parsed = parseSettingsResponse(payload);
  expect(parsed.ok, `parseSettingsResponse failed: ${parsed.ok ? "" : parsed.reason}`).toBe(true);
  if (parsed.ok) {
    useSettingsStore
      .getState()
      .hydrateFromServer(parsed.value as Parameters<ReturnType<typeof useSettingsStore.getState>["hydrateFromServer"]>[0]);
  }
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  usePuzzleStore.setState({
    puzzleMode: false,
    puzzleTransforms: {},
    overviewTransform: null,
    worldGrid: null,
  });
  // Make the server payload authoritative (never-synced state).
  useSettingsStore.setState({
    lastSyncedAt: null,
    syncedSnapshot: null,
    puzzleLayouts: [],
  });
});

describe("puzzleStore — flip state survives a cross-device settings sync", () => {
  it("keeps flipH/flipV on live puzzle transforms after hydrateFromServer applies a server payload", () => {
    usePuzzleStore.setState({
      puzzleTransforms: { "ds-a": { ...FLIPPED } },
    });

    applyServerSync(serverResponse());

    const after = usePuzzleStore.getState().puzzleTransforms["ds-a"];
    expect(after).toBeDefined();
    expect(after!.flipH).toBe(true);
    expect(after!.flipV).toBe(true);
    expect(after!.angleDeg).toBe(45);
    expect(after!.tx).toBe(12);
    expect(after!.ty).toBe(-8);
  });

  it("does not touch the sessionStorage transform mirror that OverviewMap re-hydrates from", () => {
    const serialised = JSON.stringify([["ds-a", FLIPPED]]);
    sessionStorage.setItem("bathyscan:puzzleTransforms", serialised);

    applyServerSync(serverResponse());

    expect(sessionStorage.getItem("bathyscan:puzzleTransforms")).toBe(serialised);
  });

  it("ignores a hostile server payload key that mirrors the puzzle-transform shape", () => {
    usePuzzleStore.setState({ puzzleTransforms: { "ds-a": { ...FLIPPED } } });

    // "puzzleTransforms" is NOT a settings data key — hydrate must skip it
    // rather than smuggling it into any store.
    applyServerSync(
      serverResponse({
        puzzleTransforms: { "ds-a": { tx: 0, ty: 0, angleDeg: 0, flipH: false, flipV: false } },
      }),
    );

    const after = usePuzzleStore.getState().puzzleTransforms["ds-a"];
    expect(after!.flipH).toBe(true);
    expect(after!.flipV).toBe(true);
  });
});

describe("settingsStore.puzzleLayouts — PUT → GET round-trip keeps tile flips", () => {
  it("retains flipH/flipV on saved layout tiles through parse + hydrate", () => {
    applyServerSync(serverResponse());

    const layouts = useSettingsStore.getState().puzzleLayouts;
    expect(layouts).toHaveLength(1);
    const tiles = layouts[0]!.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toMatchObject({ datasetId: "ds-a", flipH: true, flipV: false });
    expect(tiles[1]).toMatchObject({ datasetId: "ds-b", flipH: false, flipV: true });
    // Groups survive too (flip context menu applies to whole groups).
    expect(layouts[0]!.groups).toEqual([["ds-a", "ds-b"]]);
  });

  it("round-trips a serialise → parse cycle without dropping flip fields (PUT body fidelity)", () => {
    // Simulate the PUT body → stored JSON → GET response cycle: the payload
    // is JSON-serialised in transit, so a strip would happen at parse time.
    const wire = JSON.parse(JSON.stringify(serverResponse()));
    applyServerSync(wire);

    const tiles = useSettingsStore.getState().puzzleLayouts[0]!.tiles;
    expect(tiles[0]!.flipH).toBe(true);
    expect(tiles[1]!.flipV).toBe(true);
  });
});
