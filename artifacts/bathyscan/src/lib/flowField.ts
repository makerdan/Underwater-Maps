/**
 * flowField.ts — Bathymetry-modified 2D current field.
 *
 * Given a terrain grid and an ambient (depth-averaged) current vector,
 * produces a 2D vector field over the terrain's (x,z) grid where:
 *
 *   - Above-water / land cells carry zero velocity (mask = 0).
 *   - Water cells start with an ambient vector scaled inversely with depth
 *     (continuity shortcut: shallow water → faster flow, capped to avoid
 *     singularities). Speed is normalized so the median water-cell speed
 *     equals the ambient speed.
 *   - A few relaxation passes project velocities tangent to land normals
 *     (so flow routes AROUND obstacles instead of into them) and smooth
 *     with water neighbors so eddies form in the lee of features.
 *
 * The field is stored as two Float32Arrays (vx, vz) plus a mask in
 * row-major (z,x) order matching the terrain grid resolution.
 *
 * Coordinate convention: vx is +X (east in world), vz is +Z (south in world).
 * Direction angle in degrees uses the same compass-style "going TO" convention
 * as the existing TidalCurrentArrows: 0 = +Z (south), 90 = +X (east).
 * (Matches `currentVector` in computeDrift.ts.)
 */

import type { TerrainData } from "@workspace/api-client-react";
import { WORLD_SIZE } from "./terrain";

export interface FlowField {
  /** Grid resolution (same as terrain.resolution). */
  resolution: number;
  /** Row-major (row=z, col=x) east-component, length N*N. */
  vx: Float32Array;
  /** Row-major south-component, length N*N. */
  vz: Float32Array;
  /** 1 = water, 0 = land/above-water. Same layout. */
  mask: Uint8Array;
  /** Max |v| over all water cells (for color-ramp normalization). */
  maxSpeed: number;
  /** Ambient speed used to build this field (knots). */
  ambientSpeed: number;
  /** Ambient direction used to build this field (degrees). */
  ambientDirectionDeg: number;
  /** Datasource fingerprint for cache invalidation. */
  fingerprint: string;
}

export interface BuildFlowFieldOptions {
  /** Ambient current speed in knots (post tide-phase modulation). */
  ambientSpeedKnots: number;
  /**
   * Ambient direction: degrees the current flows TOWARD, 0 = +Z (south),
   * 90 = +X (east), 180 = -Z (north), 270 = -X (west).
   */
  ambientDirectionDeg: number;
  /** Number of relaxation passes (default 4). */
  passes?: number;
  /**
   * Minimum depth (metres) for the speed scaling so very shallow cells
   * don't blow up. Defaults to 5 m.
   */
  minDepth?: number;
}

/**
 * Convert ambient (speed, directionDeg) → (vx, vz) using the same compass
 * convention as TidalCurrentArrows / computeDrift.
 */
export function ambientToVector(speedKnots: number, directionDeg: number): { vx: number; vz: number } {
  const rad = (directionDeg * Math.PI) / 180;
  // 0° = +Z, 90° = +X
  return { vx: speedKnots * Math.sin(rad), vz: speedKnots * Math.cos(rad) };
}

/** Convert (vx, vz) back to a compass direction (0..360). */
export function vectorToDirectionDeg(vx: number, vz: number): number {
  const deg = (Math.atan2(vx, vz) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

export function buildFlowField(grid: TerrainData, opts: BuildFlowFieldOptions): FlowField {
  const N = grid.resolution;
  const total = N * N;
  const passes = opts.passes ?? 4;
  const minDepth = opts.minDepth ?? 5;

  const vx = new Float32Array(total);
  const vz = new Float32Array(total);
  const mask = new Uint8Array(total);

  const { vx: ax, vz: az } = ambientToVector(opts.ambientSpeedKnots, opts.ambientDirectionDeg);

  // Reference depth: median water depth, used to normalize 1/depth scaling so
  // ambient speed roughly equals the median cell speed.
  const waterDepths: number[] = [];
  for (let i = 0; i < total; i++) {
    const d = grid.depths[i] ?? 0;
    if (d > 0) waterDepths.push(d);
  }
  waterDepths.sort((a, b) => a - b);
  const refDepth = waterDepths.length > 0
    ? (waterDepths[Math.floor(waterDepths.length / 2)] ?? minDepth)
    : minDepth;

  // Seed velocities: scale by sqrt(refDepth / max(depth, minDepth)) so shallow
  // cells run faster than deep ones, capped so very shallow shoals don't
  // produce numeric singularities.
  for (let i = 0; i < total; i++) {
    const d = grid.depths[i] ?? 0;
    if (d <= 0) {
      // Land or above water: zero, masked out.
      mask[i] = 0;
      continue;
    }
    mask[i] = 1;
    const effDepth = Math.max(minDepth, d);
    const scale = Math.sqrt(refDepth / effDepth);
    vx[i] = ax * scale;
    vz[i] = az * scale;
  }

  // Relaxation passes: project velocities tangent to land normals so the
  // flow routes around obstacles, then smooth with water neighbors. We
  // operate in-place; a small amount of read-after-write blur is fine and
  // helps eddies form behind features.
  const idx = (r: number, c: number) => r * N + c;
  for (let pass = 0; pass < passes; pass++) {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = idx(r, c);
        if (mask[i] === 0) continue;

        // Mask gradient via finite differences (water=1, land=0). Components
        // are positive in the direction of more water; the unit vector
        // pointing INTO land is the negative of the normalized gradient.
        const mE = c + 1 < N ? mask[idx(r, c + 1)]! : 1;
        const mW = c - 1 >= 0 ? mask[idx(r, c - 1)]! : 1;
        const mS = r + 1 < N ? mask[idx(r + 1, c)]! : 1;
        const mN = r - 1 >= 0 ? mask[idx(r - 1, c)]! : 1;
        const gx = mE - mW;
        const gz = mS - mN;
        const glen = Math.sqrt(gx * gx + gz * gz);
        if (glen > 0) {
          // Unit vector pointing INTO land (away from water).
          const nx = -gx / glen;
          const nz = -gz / glen;
          const proj = vx[i]! * nx + vz[i]! * nz;
          if (proj > 0) {
            // Remove the into-land component.
            vx[i] = vx[i]! - proj * nx;
            vz[i] = vz[i]! - proj * nz;
            // Redirect a portion of the blocked flow tangentially toward
            // whichever side has more open water — this is what makes flow
            // deflect AROUND obstacles instead of just stalling against them.
            const tx = -nz;
            const tz = nx;
            const sampleMask = (dx: number, dz: number): number => {
              const cc = c + dx;
              const rr = r + dz;
              if (cc < 0 || cc >= N || rr < 0 || rr >= N) return 0;
              return mask[rr * N + cc] ?? 0;
            };
            // Look two cells along each tangent so symmetric ties are broken
            // by the global asymmetry of the obstacle, not just immediate neighbors.
            const wA = sampleMask(Math.round(tx), Math.round(tz))
              + sampleMask(Math.round(2 * tx), Math.round(2 * tz));
            const wB = sampleMask(-Math.round(tx), -Math.round(tz))
              + sampleMask(-Math.round(2 * tx), -Math.round(2 * tz));
            const sign = wA >= wB ? 1 : -1;
            const redirect = 0.6 * proj * sign;
            vx[i] = vx[i]! + redirect * tx;
            vz[i] = vz[i]! + redirect * tz;
          }
        }

        // Average with up to four water neighbors.
        let sumX = vx[i]!;
        let sumZ = vz[i]!;
        let n = 1;
        if (c + 1 < N && mask[idx(r, c + 1)]) { sumX += vx[idx(r, c + 1)]!; sumZ += vz[idx(r, c + 1)]!; n++; }
        if (c - 1 >= 0 && mask[idx(r, c - 1)]) { sumX += vx[idx(r, c - 1)]!; sumZ += vz[idx(r, c - 1)]!; n++; }
        if (r + 1 < N && mask[idx(r + 1, c)]) { sumX += vx[idx(r + 1, c)]!; sumZ += vz[idx(r + 1, c)]!; n++; }
        if (r - 1 >= 0 && mask[idx(r - 1, c)]) { sumX += vx[idx(r - 1, c)]!; sumZ += vz[idx(r - 1, c)]!; n++; }
        vx[i] = 0.5 * vx[i]! + 0.5 * (sumX / n);
        vz[i] = 0.5 * vz[i]! + 0.5 * (sumZ / n);
      }
    }
  }

  // Find max speed for color-ramp normalization.
  let maxSpeed = 0;
  for (let i = 0; i < total; i++) {
    if (mask[i] === 0) continue;
    const s = Math.hypot(vx[i]!, vz[i]!);
    if (s > maxSpeed) maxSpeed = s;
  }
  if (maxSpeed === 0) maxSpeed = Math.max(0.001, opts.ambientSpeedKnots);

  return {
    resolution: N,
    vx,
    vz,
    mask,
    maxSpeed,
    ambientSpeed: opts.ambientSpeedKnots,
    ambientDirectionDeg: opts.ambientDirectionDeg,
    fingerprint: fingerprintFor(grid, opts),
  };
}

/** Cache fingerprint — recompute when terrain or ambient vector changes. */
export function fingerprintFor(
  grid: Pick<TerrainData, "datasetId" | "resolution" | "minDepth" | "maxDepth">,
  opts: BuildFlowFieldOptions,
): string {
  return [
    grid.datasetId,
    grid.resolution,
    grid.minDepth.toFixed(2),
    grid.maxDepth.toFixed(2),
    opts.ambientSpeedKnots.toFixed(3),
    opts.ambientDirectionDeg.toFixed(2),
    opts.passes ?? 4,
  ].join("|");
}

/**
 * Sample the flow field at a world-space (x, z) position using bilinear
 * interpolation. Returns { vx, vz, speed } in knots (same units as ambient).
 * Returns the zero vector for samples outside the grid or on land cells.
 */
export function sampleFlowField(
  field: FlowField,
  worldX: number,
  worldZ: number,
): { vx: number; vz: number; speed: number } {
  const N = field.resolution;
  const u = (worldX + WORLD_SIZE / 2) / WORLD_SIZE;
  const v = (worldZ + WORLD_SIZE / 2) / WORLD_SIZE;
  if (u < 0 || u > 1 || v < 0 || v > 1) return { vx: 0, vz: 0, speed: 0 };
  const col = u * (N - 1);
  const row = v * (N - 1);
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const c1 = Math.min(N - 1, c0 + 1);
  const r1 = Math.min(N - 1, r0 + 1);
  const fc = col - c0;
  const fr = row - r0;
  const i00 = r0 * N + c0;
  const i10 = r0 * N + c1;
  const i01 = r1 * N + c0;
  const i11 = r1 * N + c1;
  // Bilinear over the 4 corner velocities; land corners (mask=0) already
  // hold zero so they pull the sample toward zero near the coastline.
  const w00 = (1 - fc) * (1 - fr);
  const w10 = fc * (1 - fr);
  const w01 = (1 - fc) * fr;
  const w11 = fc * fr;
  const vx =
    field.vx[i00]! * w00 + field.vx[i10]! * w10 + field.vx[i01]! * w01 + field.vx[i11]! * w11;
  const vz =
    field.vz[i00]! * w00 + field.vz[i10]! * w10 + field.vz[i01]! * w01 + field.vz[i11]! * w11;
  return { vx, vz, speed: Math.hypot(vx, vz) };
}

/**
 * Tide-phase driver: modulate an ambient base speed/direction by a phase
 * in [0, 1) of one tidal cycle. Produces a sinusoidal speed (positive
 * meaning flooding in the base direction; negative meaning ebbing in the
 * reverse direction). Default period is the M2 semi-diurnal tide.
 *
 * Returns the *effective* ambient vector for that phase: when phase=0 the
 * speed equals baseSpeed in baseDirection; at phase=0.5 it reverses.
 */
export function tidePhaseToAmbient(
  baseSpeedKnots: number,
  baseDirectionDeg: number,
  phase: number,
): { speedKnots: number; directionDeg: number } {
  const p = ((phase % 1) + 1) % 1;
  const cosine = Math.cos(2 * Math.PI * p);
  const speed = Math.abs(baseSpeedKnots * cosine);
  const dir = cosine >= 0 ? baseDirectionDeg : (baseDirectionDeg + 180) % 360;
  return { speedKnots: speed, directionDeg: dir };
}

/** Default tidal period in hours (M2 semi-diurnal). */
export const M2_PERIOD_HOURS = 12.42;
