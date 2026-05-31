/**
 * boatPhysics.test.ts — Unit tests for the shared boat physics engine.
 *
 * Covers the four core scenarios specified in task-1252:
 *   1. Zero-wind drift      — only tidal pushes; result is 70% of tidal input.
 *   2. Head-on current      — tidal from N, wind from N; result is still due N.
 *   3. Crosswind leeway     — tidal from N, wind from E; result veers east.
 *   4. Trolling against current — boat vector partially cancels tidal; net SOG decreases.
 *
 * Additional tests cover helper functions and the Drive-Boat world-velocity converter.
 */

import { describe, it, expect } from "vitest";
import {
  currentVector,
  shallowWaterTidalScale,
  computeBlendedDrift,
  tidalToWorldVelocity,
  KM_PER_KNOT_HOUR,
  KM_PER_DEG_LAT,
  KT_TO_MS,
} from "../boatPhysics";

// ── Helpers ──────────────────────────────────────────────────────────────────

const DEG2RAD = Math.PI / 180;

/** Convert a blended-drift dLat/dLon back to a magnitude in knots. */
function vectorMagnitudeKnots(dLat: number, dLon: number, refLat: number): number {
  const kmH = Math.sqrt(
    (dLat * KM_PER_DEG_LAT) ** 2 +
    (dLon * KM_PER_DEG_LAT * Math.cos(refLat * DEG2RAD)) ** 2,
  );
  return kmH / KM_PER_KNOT_HOUR;
}

// ── currentVector ─────────────────────────────────────────────────────────────

describe("currentVector", () => {
  it("due north at 1 kt moves only latitude (at equator)", () => {
    const { dLat, dLon } = currentVector(1, 0, 0);
    const expectedDLat = KM_PER_KNOT_HOUR / KM_PER_DEG_LAT;
    expect(dLat).toBeCloseTo(expectedDLat, 8);
    expect(dLon).toBeCloseTo(0, 8);
  });

  it("due east at 1 kt moves only longitude (at equator)", () => {
    const { dLat, dLon } = currentVector(1, 90, 0);
    expect(dLat).toBeCloseTo(0, 8);
    // At equator, 1 degree lon ≈ 111 km
    const expectedDLon = KM_PER_KNOT_HOUR / KM_PER_DEG_LAT;
    expect(dLon).toBeCloseTo(expectedDLon, 8);
  });

  it("zero speed produces zero displacement", () => {
    const { dLat, dLon } = currentVector(0, 270, 57);
    expect(dLat).toBeCloseTo(0, 10);
    expect(dLon).toBeCloseTo(0, 10);
  });

  it("longitude displacement shrinks with latitude (cos scaling)", () => {
    const { dLon: dLon0 } = currentVector(1, 90, 0);
    const { dLon: dLon60 } = currentVector(1, 90, 60);
    expect(dLon60).toBeCloseTo(dLon0 / Math.cos(60 * DEG2RAD), 6);
  });
});

// ── shallowWaterTidalScale ────────────────────────────────────────────────────

describe("shallowWaterTidalScale", () => {
  it("returns 1.0 at reference depth (30 m) with zero tide", () => {
    expect(shallowWaterTidalScale(30, 0)).toBeCloseTo(1.0, 6);
  });

  it("returns 1.0 at depths deeper than reference", () => {
    expect(shallowWaterTidalScale(100, 0)).toBe(1.0);
    expect(shallowWaterTidalScale(50, 5)).toBe(1.0);
  });

  it("amplifies tidal speed on a shallow shoal", () => {
    // 5 m terrain + 0 tide → effectiveDepth=5, scale = 30/5 = 6 → capped at 3
    expect(shallowWaterTidalScale(5, 0)).toBe(3.0);
  });

  it("tide height raises effective depth and lowers scale", () => {
    // 10 m terrain + 5 m tide → effectiveDepth=15, scale = 30/15 = 2
    expect(shallowWaterTidalScale(10, 5)).toBeCloseTo(2.0, 6);
  });

  it("never returns a scale below 1.0 (no negative amplification)", () => {
    expect(shallowWaterTidalScale(100, 100)).toBe(1.0);
  });
});

// ── computeBlendedDrift ───────────────────────────────────────────────────────

describe("computeBlendedDrift — scenario 1: zero-wind drift", () => {
  it("with no wind, drift equals 70% of tidal input", () => {
    // Tidal: 2 kt due north. Wind: 0 kt.
    // Expected: dLat = 0.7 × currentVector(2, 0, 0).dLat, dLon = 0
    const result = computeBlendedDrift({
      tidalSpeedKnots: 2,
      tidalDegrees: 0,
      windSpeedKnots: 0,
      windDegrees: 0,
      leewayFactor: 0.035,
      refLat: 0,
    });
    const { dLat: tidalDLat } = currentVector(2, 0, 0);
    expect(result.dLat).toBeCloseTo(0.7 * tidalDLat, 8);
    expect(result.dLon).toBeCloseTo(0, 8);
  });

  it("speedKnots matches the vector magnitude", () => {
    const result = computeBlendedDrift({
      tidalSpeedKnots: 2,
      tidalDegrees: 0,
      windSpeedKnots: 0,
      windDegrees: 0,
      leewayFactor: 0.035,
      refLat: 0,
    });
    const expectedKnots = vectorMagnitudeKnots(result.dLat, result.dLon, 0);
    expect(result.speedKnots).toBeCloseTo(expectedKnots, 6);
  });
});

describe("computeBlendedDrift — scenario 2: head-on current (tidal N, wind N)", () => {
  it("resultant stays due north when tidal and wind are both northward", () => {
    // Both forces point north → combined drift is still due north (dLon = 0).
    const result = computeBlendedDrift({
      tidalSpeedKnots: 1.5,
      tidalDegrees: 0,
      windSpeedKnots: 10,
      windDegrees: 0,
      leewayFactor: 0.035,
      refLat: 0,
    });
    expect(result.dLon).toBeCloseTo(0, 8);
    expect(result.dLat).toBeGreaterThan(0);
    // Magnitude: 0.7×1.5 + 0.3×(10×0.035) = 1.05 + 0.105 = 1.155 kt
    expect(result.speedKnots).toBeCloseTo(1.155, 4);
  });
});

describe("computeBlendedDrift — scenario 3: crosswind leeway (tidal N, wind E)", () => {
  it("resultant veers east when wind blows from the east", () => {
    // Tidal: 2 kt north. Wind: 10 kt east, leeway = 5%.
    // Wind contribution: 10 × 0.05 = 0.5 kt east
    // dLat = 0.7 × tidal_north + 0 (east wind has no north component)
    // dLon = 0               + 0.3 × wind_east_component
    const result = computeBlendedDrift({
      tidalSpeedKnots: 2,
      tidalDegrees: 0,
      windSpeedKnots: 10,
      windDegrees: 90,
      leewayFactor: 0.05,
      refLat: 0,
    });
    expect(result.dLat).toBeGreaterThan(0); // northward tidal component
    expect(result.dLon).toBeGreaterThan(0); // eastward wind leeway component
  });

  it("blend ratio is 70/30 for the two components", () => {
    const tidal = currentVector(2, 0, 0);   // north
    const wind  = currentVector(10 * 0.05, 90, 0); // east leeway

    const result = computeBlendedDrift({
      tidalSpeedKnots: 2,
      tidalDegrees: 0,
      windSpeedKnots: 10,
      windDegrees: 90,
      leewayFactor: 0.05,
      refLat: 0,
    });

    expect(result.dLat).toBeCloseTo(0.7 * tidal.dLat + 0.3 * wind.dLat, 8);
    expect(result.dLon).toBeCloseTo(0.7 * tidal.dLon + 0.3 * wind.dLon, 8);
  });
});

describe("computeBlendedDrift — scenario 4: trolling against current", () => {
  it("boat speed opposing tidal current reduces net drift magnitude", () => {
    // Pure drift: 2 kt north with no wind.
    const pureResult = computeBlendedDrift({
      tidalSpeedKnots: 2,
      tidalDegrees: 0,
      windSpeedKnots: 0,
      windDegrees: 0,
      leewayFactor: 0.035,
      refLat: 0,
    });

    // The boat props southward at 1.5 kt — this is computed on top of drift
    // in computeDrift.ts, not inside computeBlendedDrift. We verify the drift
    // baseline is correct, then manually apply the boat vector to confirm
    // the resultant SOG is lower than the pure drift.
    const boatVec = currentVector(1.5, 180, 0); // south
    const netDLat = pureResult.dLat + boatVec.dLat;
    const netKnots = vectorMagnitudeKnots(netDLat, pureResult.dLon, 0);

    expect(netKnots).toBeLessThan(pureResult.speedKnots);
  });

  it("complete cancellation: boat exactly matches drift → near-zero SOG", () => {
    // 1 kt northward tide, leeway 0 → drift ≈ 0.7 kt north.
    const drift = computeBlendedDrift({
      tidalSpeedKnots: 1,
      tidalDegrees: 0,
      windSpeedKnots: 0,
      windDegrees: 0,
      leewayFactor: 0,
      refLat: 0,
    });

    // Boat drives south at 0.7 kt (exact cancel).
    const boat = currentVector(0.7, 180, 0);
    const netDLat = drift.dLat + boat.dLat;
    const netKnots = vectorMagnitudeKnots(netDLat, drift.dLon, 0);

    expect(netKnots).toBeCloseTo(0, 4);
  });
});

// ── tidalToWorldVelocity ──────────────────────────────────────────────────────

describe("tidalToWorldVelocity", () => {
  it("due north produces zero worldDX and positive worldDZ", () => {
    const { worldDX, worldDZ } = tidalToWorldVelocity(1, 0);
    expect(worldDX).toBeCloseTo(0, 8);
    expect(worldDZ).toBeCloseTo(KT_TO_MS, 6);
  });

  it("due east produces positive worldDX and zero worldDZ", () => {
    const { worldDX, worldDZ } = tidalToWorldVelocity(1, 90);
    expect(worldDX).toBeCloseTo(KT_TO_MS, 6);
    expect(worldDZ).toBeCloseTo(0, 8);
  });

  it("due south produces zero worldDX and negative worldDZ", () => {
    const { worldDX, worldDZ } = tidalToWorldVelocity(1, 180);
    expect(worldDX).toBeCloseTo(0, 8);
    expect(worldDZ).toBeCloseTo(-KT_TO_MS, 6);
  });

  it("speed scales linearly", () => {
    const { worldDX: dx1 } = tidalToWorldVelocity(1, 90);
    const { worldDX: dx3 } = tidalToWorldVelocity(3, 90);
    expect(dx3).toBeCloseTo(3 * dx1, 8);
  });

  it("zero speed produces zero velocity", () => {
    const { worldDX, worldDZ } = tidalToWorldVelocity(0, 45);
    expect(worldDX).toBe(0);
    expect(worldDZ).toBe(0);
  });
});
