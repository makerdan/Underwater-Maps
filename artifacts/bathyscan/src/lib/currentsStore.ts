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
  /**
   * Provenance of this ambient vector:
   * - "noaa": real NOAA CO-OPS currents-predictions station data
   * - "estimated": tide-derived sinusoidal estimate (no station in range)
   *
   * The CurrentsLayer simulation uses this ambient regardless of source so
   * the NOAA mode keeps producing a flow field even when no station is
   * nearby; the panel uses this flag to label what the user is actually
   * seeing.
   */
  /**
   * "noaa"     : real NOAA CO-OPS data (saltwater)
   * "usgs"     : real USGS NWIS gauge (freshwater)
   * "glerl"    : real NOAA GLERL Great-Lakes model (freshwater)
   * "estimated": sinusoidal synthetic fallback (no real station in range)
   */
  source?: "noaa" | "usgs" | "glerl" | "estimated";
  /** Station id, when source is a real data source. */
  stationId?: string;
  /** Human-readable station name (e.g. "Snow Passage, Alaska Current"). */
  stationName?: string;
}

/** Status of the tidal data fetch that backs NOAA currents mode. */
export type TidalStatus = "idle" | "loading" | "ok" | "unavailable";

interface CurrentsRuntimeStore {
  /** Currently-built bathymetry-shaped flow field (null when disabled / unavailable). */
  field: FlowField | null;
  setField: (f: FlowField | null) => void;

  /** Cached NOAA ambient from the active tidal-data fetch. */
  noaaAmbient: NoaaAmbient | null;
  setNoaaAmbient: (a: NoaaAmbient | null) => void;

  /** Status of the /api/tidal fetch used by NOAA currents mode. */
  tidalStatus: TidalStatus;
  setTidalStatus: (s: TidalStatus) => void;

  /**
   * Calling this function re-triggers the tidal fetch. App.tsx wires its
   * hook's retry() into this slot. Default is a noop until wired.
   */
  retryTidal: () => void;
  setRetryTidal: (fn: () => void) => void;
}

export const useCurrentsStore = create<CurrentsRuntimeStore>((set) => ({
  field: null,
  setField: (f) => set({ field: f }),
  noaaAmbient: null,
  setNoaaAmbient: (a) => set({ noaaAmbient: a }),
  tidalStatus: "idle",
  setTidalStatus: (s) => set({ tidalStatus: s }),
  retryTidal: () => {},
  setRetryTidal: (fn) => set({ retryTidal: fn }),
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
