/**
 * currentsStore.ts — Runtime (non-persisted) state for the bathymetric
 * current simulation: holds the currently-built flow field plus a sample
 * function that other systems (Drift Planner, HUD panels) can call.
 *
 * Persisted preferences live in settingsStore under the "currents" section.
 */

import { create } from "zustand";
import type { FlowField } from "./flowField";
import { sampleFlowField, vectorToDirectionDeg } from "./flowField";

export interface NoaaAmbient {
  /** Direction the current is going TO, degrees, 0=N→S? Compass convention used elsewhere. */
  directionDeg: number;
  /** Speed in knots. */
  speedKt: number;
  /** NOAA CO-OPS currents-predictions station id, when one was found in range. */
  stationId?: string;
  /** Human-readable station name (e.g. "Snow Passage, Alaska Current"). */
  stationName?: string;
}

interface CurrentsRuntimeStore {
  /** Currently-built bathymetry-shaped flow field (null when disabled / unavailable). */
  field: FlowField | null;
  setField: (f: FlowField | null) => void;

  /** Cached NOAA ambient from the active tidal-data fetch. */
  noaaAmbient: NoaaAmbient | null;
  setNoaaAmbient: (a: NoaaAmbient | null) => void;
}

export const useCurrentsStore = create<CurrentsRuntimeStore>((set) => ({
  field: null,
  setField: (f) => set({ field: f }),
  noaaAmbient: null,
  setNoaaAmbient: (a) => set({ noaaAmbient: a }),
}));

/**
 * Sample the current flow field at a world-space (x, z) position.
 * Returns null when no field is built (caller should fall back to ambient).
 */
export function sampleCurrentAt(
  worldX: number,
  worldZ: number,
): { speedKt: number; directionDeg: number } | null {
  const field = useCurrentsStore.getState().field;
  if (!field) return null;
  const { vx, vz, speed } = sampleFlowField(field, worldX, worldZ);
  if (speed === 0) return { speedKt: 0, directionDeg: 0 };
  return { speedKt: speed, directionDeg: vectorToDirectionDeg(vx, vz) };
}
