/**
 * driftStore.ts — Zustand store for the Drift Planner feature.
 *
 * Holds all mutable state for Drift Planner mode:
 *   - driftPlannerActive: toggle on/off
 *   - driftConditions: 24-hour surface condition array from API
 *   - driftPath: computed drift waypoints after physics calculation
 *   - driftHour: currently selected hour on the timeline scrubber
 *   - driftStartLat/driftStartLon: boat starting position
 *   - lineLengthM: fishing line length (user-configurable)
 *   - lineWeightG: sinker weight in grams (user-configurable)
 *   - estimatedConditions: true when fallback data is being used
 */

import { create } from "zustand";

export interface HourlySurfaceCondition {
  hour: number;
  windSpeedKnots: number;
  windDegrees: number;
  tidalSpeedKnots: number;
  tidalDegrees: number;
  waveHeightM: number;
}

export interface DriftWaypoint {
  hour: number;
  lat: number;
  lon: number;
  worldX: number;
  worldZ: number;
  lineAngleDeg: number;
  hookDepthM: number;
  bottomReached: boolean;
  driftSpeedKnots: number;
  headingDeg: number;
}

interface DriftStore {
  driftPlannerActive: boolean;
  setDriftPlannerActive: (active: boolean) => void;

  driftConditions: HourlySurfaceCondition[] | null;
  setDriftConditions: (conditions: HourlySurfaceCondition[] | null) => void;

  driftPath: DriftWaypoint[] | null;
  setDriftPath: (path: DriftWaypoint[] | null) => void;

  driftHour: number;
  setDriftHour: (hour: number) => void;

  driftStartLat: number | null;
  driftStartLon: number | null;
  setDriftStart: (lat: number, lon: number) => void;
  clearDriftStart: () => void;

  lineLengthM: number;
  setLineLengthM: (m: number) => void;

  lineWeightG: number;
  setLineWeightG: (g: number) => void;

  estimatedConditions: boolean;
  setEstimatedConditions: (b: boolean) => void;

  manualWindSpeedKnots: number;
  setManualWindSpeedKnots: (v: number) => void;
  manualWindDegrees: number;
  setManualWindDegrees: (v: number) => void;
  manualTidalSpeedKnots: number;
  setManualTidalSpeedKnots: (v: number) => void;
  manualTidalDegrees: number;
  setManualTidalDegrees: (v: number) => void;
}

function readLocalBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

export const useDriftStore = create<DriftStore>((set) => ({
  driftPlannerActive: readLocalBool("bathyscan:driftPlannerActive", false),
  setDriftPlannerActive: (active) => {
    try { localStorage.setItem("bathyscan:driftPlannerActive", String(active)); } catch {}
    set({ driftPlannerActive: active });
  },

  driftConditions: null,
  setDriftConditions: (conditions) => set({ driftConditions: conditions }),

  driftPath: null,
  setDriftPath: (path) => set({ driftPath: path }),

  driftHour: 0,
  setDriftHour: (hour) => set({ driftHour: hour }),

  driftStartLat: null,
  driftStartLon: null,
  setDriftStart: (lat, lon) => set({ driftStartLat: lat, driftStartLon: lon }),
  clearDriftStart: () => set({ driftStartLat: null, driftStartLon: null, driftPath: null }),

  lineLengthM: 200,
  setLineLengthM: (m) => set({ lineLengthM: m }),

  lineWeightG: 500,
  setLineWeightG: (g) => set({ lineWeightG: g }),

  estimatedConditions: false,
  setEstimatedConditions: (b) => set({ estimatedConditions: b }),

  manualWindSpeedKnots: 8,
  setManualWindSpeedKnots: (v) => set({ manualWindSpeedKnots: v }),
  manualWindDegrees: 225,
  setManualWindDegrees: (v) => set({ manualWindDegrees: v }),
  manualTidalSpeedKnots: 0.8,
  setManualTidalSpeedKnots: (v) => set({ manualTidalSpeedKnots: v }),
  manualTidalDegrees: 180,
  setManualTidalDegrees: (v) => set({ manualTidalDegrees: v }),
}));
