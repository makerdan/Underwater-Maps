/**
 * Terrain mesh fade-in guard — regression tests.
 *
 * Covers:
 *  1. Stall-recovery timer forces uOpacity=1 / skirtMaterial.opacity=1 within
 *     600 ms even when the Three.js render loop never runs (headless, hidden
 *     tab) — and critically, even when the effect fires twice in rapid
 *     succession as React StrictMode does in development.
 *  2. Completion guard: once a fade completes for a grid, re-firing the effect
 *     with the same grid identity must NOT reset opacity back to 0.
 *  3. Initial Canvas camera Y is below the water surface (Y < 0) so the first
 *     rendered frame is already underwater.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// terrain.ts depends on three and zoneMap; mock them so this test file
// can run without a WebGL context (same pattern as terrain.test.ts).
vi.mock("three");
vi.mock("../lib/zoneMap", () => ({
  SALTWATER_ZONE_TO_SLOT: [0, 1, 2, 3, 3, 3, 1, 0],
  FRESHWATER_ZONE_TO_SLOT: [0, 0, 3, 2, 1, 3, 1, 2],
}));

import { INITIAL_CAMERA_POSITION } from "../lib/terrain";

// ---------------------------------------------------------------------------
// Shared helpers — lightweight stand-ins for the Three.js objects TerrainMesh
// would normally hold.
// ---------------------------------------------------------------------------

function makeMaterial() {
  return { uniforms: { uOpacity: { value: 0 as number } } };
}

function makeSkirt() {
  return { opacity: 0 as number };
}

/** Mirrors the ref structure used in TerrainMesh */
function makeFadeRef() {
  return { current: { opacity: 0, fading: false } };
}

/**
 * Runs the exact same logic as the fade useEffect in TerrainMesh.tsx —
 * isolated from React/R3F so we can exercise it with plain timers.
 *
 * Returns a cleanup function (mirrors the effect's return value).
 */
function triggerFadeEffect(
  grid: object,
  completedFadeGridRef: { current: object | null },
  fadeRef: { current: { opacity: number; fading: boolean } },
  material: ReturnType<typeof makeMaterial>,
  skirt: ReturnType<typeof makeSkirt>,
): (() => void) | undefined {
  if (completedFadeGridRef.current === grid) return undefined;

  material.uniforms.uOpacity.value = 0;
  skirt.opacity = 0;
  fadeRef.current.opacity = 0;
  fadeRef.current.fading = true;

  const stallTimer = setTimeout(() => {
    if (fadeRef.current.fading) {
      material.uniforms.uOpacity.value = 1;
      skirt.opacity = 1;
      fadeRef.current.opacity = 1;
      fadeRef.current.fading = false;
      completedFadeGridRef.current = grid;
    }
  }, 600);

  return () => clearTimeout(stallTimer);
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Stall-recovery timer
// ---------------------------------------------------------------------------

describe("terrainFade stall-recovery timer", () => {
  it("forces opacity to 1 after 600 ms when the render loop never runs", () => {
    vi.useFakeTimers();

    const grid = {};
    const completedFadeGridRef: { current: object | null } = { current: null };
    const fadeRef = makeFadeRef();
    const material = makeMaterial();
    const skirt = makeSkirt();

    triggerFadeEffect(grid, completedFadeGridRef, fadeRef, material, skirt);

    expect(material.uniforms.uOpacity.value).toBe(0);

    vi.advanceTimersByTime(600);

    expect(material.uniforms.uOpacity.value).toBe(1);
    expect(skirt.opacity).toBe(1);
    expect(fadeRef.current.fading).toBe(false);
    expect(completedFadeGridRef.current).toBe(grid);
  });

  it("forces opacity to 1 even when effect fires twice in rapid succession (StrictMode pattern)", () => {
    vi.useFakeTimers();

    const grid = {};
    const completedFadeGridRef: { current: object | null } = { current: null };
    const fadeRef = makeFadeRef();
    const material = makeMaterial();
    const skirt = makeSkirt();

    // First invocation
    const cleanup1 = triggerFadeEffect(
      grid, completedFadeGridRef, fadeRef, material, skirt,
    );
    // StrictMode immediately runs cleanup (clears the timer)…
    cleanup1?.();
    // …then immediately re-fires the effect
    triggerFadeEffect(grid, completedFadeGridRef, fadeRef, material, skirt);

    // Render loop still never ran — both opacity values are still 0
    expect(material.uniforms.uOpacity.value).toBe(0);

    vi.advanceTimersByTime(600);

    // Second invocation's stall timer should have fired
    expect(material.uniforms.uOpacity.value).toBe(1);
    expect(skirt.opacity).toBe(1);
    expect(fadeRef.current.fading).toBe(false);
  });

  it("does NOT fire if the render loop already completed the fade", () => {
    vi.useFakeTimers();

    const grid = {};
    const completedFadeGridRef: { current: object | null } = { current: null };
    const fadeRef = makeFadeRef();
    const material = makeMaterial();
    const skirt = makeSkirt();

    triggerFadeEffect(grid, completedFadeGridRef, fadeRef, material, skirt);

    // Simulate the render loop completing the fade before the timer fires
    fadeRef.current.opacity = 1;
    fadeRef.current.fading = false;
    material.uniforms.uOpacity.value = 1;
    skirt.opacity = 1;
    completedFadeGridRef.current = grid;

    // Advance past the stall threshold — timer should be a no-op
    vi.advanceTimersByTime(700);

    expect(material.uniforms.uOpacity.value).toBe(1);
    expect(skirt.opacity).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Completion guard (same-grid identity skip)
// ---------------------------------------------------------------------------

describe("terrainFade completion guard", () => {
  it("skips opacity reset when the same grid re-triggers the effect after completion", () => {
    vi.useFakeTimers();

    const grid = {};
    const completedFadeGridRef: { current: object | null } = { current: null };
    const fadeRef = makeFadeRef();
    const material = makeMaterial();
    const skirt = makeSkirt();

    triggerFadeEffect(grid, completedFadeGridRef, fadeRef, material, skirt);
    vi.advanceTimersByTime(600);

    // Fade is now complete
    expect(material.uniforms.uOpacity.value).toBe(1);
    expect(completedFadeGridRef.current).toBe(grid);

    // Re-fire the effect with the same grid (e.g. unrelated state re-render)
    const cleanup = triggerFadeEffect(
      grid, completedFadeGridRef, fadeRef, material, skirt,
    );

    // Guard must have returned early — opacity untouched, no cleanup fn
    expect(cleanup).toBeUndefined();
    expect(material.uniforms.uOpacity.value).toBe(1);
    expect(skirt.opacity).toBe(1);
  });

  it("resets opacity for a new grid even after the previous one completed", () => {
    vi.useFakeTimers();

    const gridA = { id: "a" };
    const gridB = { id: "b" };
    const completedFadeGridRef: { current: object | null } = { current: null };
    const fadeRef = makeFadeRef();
    const material = makeMaterial();
    const skirt = makeSkirt();

    triggerFadeEffect(gridA, completedFadeGridRef, fadeRef, material, skirt);
    vi.advanceTimersByTime(600);
    expect(completedFadeGridRef.current).toBe(gridA);

    // Switch to a different grid
    triggerFadeEffect(gridB, completedFadeGridRef, fadeRef, material, skirt);

    // Opacity should have been reset to 0 for the new grid
    expect(material.uniforms.uOpacity.value).toBe(0);
    expect(fadeRef.current.fading).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Canvas initial camera position
// ---------------------------------------------------------------------------

describe("INITIAL_CAMERA_POSITION", () => {
  it("has Y < 0 so the first Canvas frame is already underwater", () => {
    expect(INITIAL_CAMERA_POSITION[1]).toBeLessThan(0);
  });

  it("is a tuple of three numbers", () => {
    expect(INITIAL_CAMERA_POSITION).toHaveLength(3);
    INITIAL_CAMERA_POSITION.forEach((v) => expect(typeof v).toBe("number"));
  });
});
