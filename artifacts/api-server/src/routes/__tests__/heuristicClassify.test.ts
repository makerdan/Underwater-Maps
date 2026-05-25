import { describe, it, expect } from "vitest";
import {
  heuristicClassifyByDepth,
  SALTWATER_HEURISTIC_BANDS,
  FRESHWATER_HEURISTIC_BANDS,
  SALTWATER_ROUGH_OVERRIDE,
  FRESHWATER_ROUGH_OVERRIDE,
} from "../poe.js";

function rampDepths(): number[] {
  const out = new Array<number>(1024);
  for (let i = 0; i < 1024; i++) out[i] = i;
  return out;
}

describe("heuristicClassifyByDepth", () => {
  it("returns exactly 1024 labels for a saltwater ramp, banded by quartile", () => {
    const zones = heuristicClassifyByDepth(rampDepths(), "saltwater");
    expect(zones).toHaveLength(1024);
    // Pick indices clearly inside each quartile (avoid the boundary indices
    // 256/512/768 which sit exactly on a threshold and fall to the lower band).
    expect(zones[0]).toBe(SALTWATER_HEURISTIC_BANDS[0]);
    expect(zones[300]).toBe(SALTWATER_HEURISTIC_BANDS[1]);
    expect(zones[600]).toBe(SALTWATER_HEURISTIC_BANDS[2]);
    expect(zones[900]).toBe(SALTWATER_HEURISTIC_BANDS[3]);
    expect(zones[1023]).toBe(SALTWATER_HEURISTIC_BANDS[3]);
    // All four bands must appear at least once for a monotonic ramp.
    expect(new Set(zones).size).toBe(4);
  });

  it("uses freshwater labels when waterType is freshwater", () => {
    const zones = heuristicClassifyByDepth(rampDepths(), "freshwater");
    const unique = new Set(zones);
    for (const z of unique) {
      expect(FRESHWATER_HEURISTIC_BANDS).toContain(z as typeof FRESHWATER_HEURISTIC_BANDS[number]);
    }
    // All four bands should be present for a monotonic ramp.
    expect(unique.size).toBe(4);
  });

  it("returns all-shallow when every depth is identical", () => {
    const zones = heuristicClassifyByDepth(new Array(1024).fill(42), "saltwater");
    expect(zones).toHaveLength(1024);
    // With q1=q2=q3=42, every value satisfies d<=q1 so all map to band 0.
    expect(zones.every((z) => z === SALTWATER_HEURISTIC_BANDS[0])).toBe(true);
  });

  it("tolerates short input by treating missing cells as the shallowest band", () => {
    const zones = heuristicClassifyByDepth([1, 2, 3], "saltwater");
    expect(zones).toHaveLength(1024);
    // 1021 of the 1024 cells will be the min finite value (1) → band 0.
    const counts = new Map<string, number>();
    for (const z of zones) counts.set(z, (counts.get(z) ?? 0) + 1);
    expect(counts.get(SALTWATER_HEURISTIC_BANDS[0])).toBeGreaterThan(1000);
  });

  it("tolerates non-finite values without crashing", () => {
    const depths = new Array(1024).fill(0).map((_, i) => (i % 7 === 0 ? Number.NaN : i));
    const zones = heuristicClassifyByDepth(depths, "saltwater");
    expect(zones).toHaveLength(1024);
    for (const z of zones) {
      expect(SALTWATER_HEURISTIC_BANDS).toContain(z as typeof SALTWATER_HEURISTIC_BANDS[number]);
    }
  });

  it("returns all-shallowest when every depth is non-finite", () => {
    const depths = new Array(1024).fill(Number.NaN);
    const zones = heuristicClassifyByDepth(depths, "freshwater");
    expect(zones).toHaveLength(1024);
    expect(zones.every((z) => z === FRESHWATER_HEURISTIC_BANDS[0])).toBe(true);
  });

  it("flags a sharp local spike as the rocky-override label (saltwater)", () => {
    // Mostly-flat shallow field with one tall spike at (row 16, col 16).
    const depths = new Array(1024).fill(10);
    const spikeIdx = 16 * 32 + 16;
    depths[spikeIdx] = 500;
    const zones = heuristicClassifyByDepth(depths, "saltwater");
    expect(zones).toHaveLength(1024);
    // The spike cell sits well above the roughness 75th percentile and must
    // be overridden to the rocky label even though only its depth would put
    // it in the deepest band anyway — its 8 neighbours (depth 10) should
    // also be picked up as high-roughness override cells.
    expect(zones[spikeIdx]).toBe(SALTWATER_ROUGH_OVERRIDE);
    const overrideCount = zones.filter((z) => z === SALTWATER_ROUGH_OVERRIDE).length;
    expect(overrideCount).toBeGreaterThanOrEqual(8);
    // ...but it must NOT relabel the whole grid — flat cells far from the
    // spike stay in the shallowest depth band.
    expect(zones[0]).toBe(SALTWATER_HEURISTIC_BANDS[0]);
    expect(zones[1023]).toBe(SALTWATER_HEURISTIC_BANDS[0]);
  });

  it("breaks pure column-banding when a ridge runs across a column ramp", () => {
    // Column ramp: depth depends only on column → pure quartile classifier
    // would produce four perfectly-vertical bands. Adding a horizontal ridge
    // at row 8 should produce override cells along that row, so the output
    // is no longer just a function of column index.
    const depths = new Array<number>(1024);
    for (let r = 0; r < 32; r++) {
      for (let c = 0; c < 32; c++) {
        depths[r * 32 + c] = c;
      }
    }
    // Ridge: row 8 is much deeper than its neighbours.
    for (let c = 0; c < 32; c++) depths[8 * 32 + c] = 200;
    const zones = heuristicClassifyByDepth(depths, "freshwater");
    // Compare the ridge row against row 0: same column ramp, so under a
    // depth-only classifier they'd produce identical labels per column. With
    // the roughness pass, the ridge row should diverge for many columns.
    let differing = 0;
    for (let c = 0; c < 32; c++) {
      if (zones[8 * 32 + c] !== zones[0 * 32 + c]) differing++;
    }
    expect(differing).toBeGreaterThan(16);
    // And those ridge cells should be labeled with the freshwater rocky
    // override (rocky_shoreline) rather than the deep silt band.
    const ridgeOverrides = zones
      .slice(8 * 32, 8 * 32 + 32)
      .filter((z) => z === FRESHWATER_ROUGH_OVERRIDE).length;
    expect(ridgeOverrides).toBeGreaterThan(16);
  });

  it("does not override anything when the grid is perfectly flat", () => {
    // Roughness is zero everywhere → q3 == 0 → no override path triggers,
    // matching the pre-existing all-shallow guarantee for uniform depth.
    const zones = heuristicClassifyByDepth(new Array(1024).fill(7), "saltwater");
    expect(zones.every((z) => z === SALTWATER_HEURISTIC_BANDS[0])).toBe(true);
  });
});
