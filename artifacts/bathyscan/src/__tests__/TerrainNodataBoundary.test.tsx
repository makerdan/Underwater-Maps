/**
 * TerrainNodataBoundary — toggle visibility guard
 *
 * Verifies that:
 *   1. The component renders a <lineSegments> when `showNodataBoundary` is true
 *      in uiStore (covered indirectly: the component itself is always mounted
 *      when TourScene decides to render it, which is gated by the store flag).
 *   2. When uiStore.showNodataBoundary is false, TourScene does NOT render
 *      TerrainNodataBoundary — tested via the store setter + a direct read of
 *      the resulting state so we don't need to mount the full 3D Canvas.
 *   3. The toggle setter round-trips correctly.
 *   4. The component returns null for a grid with no null cells (no segments).
 *
 * We deliberately do NOT mount an R3F Canvas here — the component is a thin
 * wrapper around three.js primitives and the geometry disposal path is already
 * covered by the GPU-leak test.  The behaviour under test is the VISIBILITY
 * GATE in uiStore, not the three.js rendering internals.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "@/lib/uiStore";
import type { TerrainData } from "@workspace/api-client-react";

/** Reset to known state before each test. */
function resetUiStore() {
  useUiStore.setState({ showNodataBoundary: true });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGrid(
  W: number,
  H: number,
  depths: (number | null)[],
): TerrainData {
  return {
    width: W,
    height: H,
    resolution: W,
    depths: depths as (number | null | undefined)[],
    minDepth: 0,
    maxDepth: 10,
    minLon: -1,
    maxLon: 1,
    minLat: -1,
    maxLat: 1,
  } as unknown as TerrainData;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("uiStore — showNodataBoundary toggle", () => {
  beforeEach(() => { resetUiStore(); });

  it("defaults to true (overlay visible on session start)", () => {
    expect(useUiStore.getState().showNodataBoundary).toBe(true);
  });

  it("setShowNodataBoundary(false) hides the overlay", () => {
    useUiStore.getState().setShowNodataBoundary(false);
    expect(useUiStore.getState().showNodataBoundary).toBe(false);
  });

  it("setShowNodataBoundary(true) re-shows the overlay", () => {
    useUiStore.getState().setShowNodataBoundary(false);
    useUiStore.getState().setShowNodataBoundary(true);
    expect(useUiStore.getState().showNodataBoundary).toBe(true);
  });

  it("toggle round-trips: false → true → false", () => {
    const { setShowNodataBoundary } = useUiStore.getState();
    setShowNodataBoundary(false);
    expect(useUiStore.getState().showNodataBoundary).toBe(false);
    setShowNodataBoundary(true);
    expect(useUiStore.getState().showNodataBoundary).toBe(true);
    setShowNodataBoundary(false);
    expect(useUiStore.getState().showNodataBoundary).toBe(false);
  });
});

describe("uiStore — showNodataBoundary IS in MIRRORED_UI_KEYS (persisted)", () => {
  it("showNodataBoundary is present in the mirror list so it persists cross-device", async () => {
    // MIRRORED_UI_KEYS drives the auto-sync to settingsStore.  showNodataBoundary
    // was promoted to a persisted setting (settingsStore v31) so it MUST appear
    // in the mirror list and sync cross-device.
    const { MIRRORED_UI_KEYS } = await import("@/lib/uiStore");
    expect((MIRRORED_UI_KEYS as readonly string[]).includes("showNodataBoundary")).toBe(true);
  });
});

describe("buildNodataBoundarySegments — gate condition for visibility", () => {
  it("returns no segments for a fully-surveyed grid (toggle has nothing to show)", async () => {
    const { buildNodataBoundarySegments } = await import("@/lib/overviewRenderer");
    const grid = makeGrid(3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(buildNodataBoundarySegments(grid)).toHaveLength(0);
  });

  it("returns segments for a grid with null cells (toggle controls their visibility)", async () => {
    const { buildNodataBoundarySegments } = await import("@/lib/overviewRenderer");
    const grid = makeGrid(3, 3, [1, 2, 3, 4, null, 6, 7, 8, 9]);
    expect(buildNodataBoundarySegments(grid).length).toBeGreaterThan(0);
  });
});
