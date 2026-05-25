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

export type TidePhase = "flooding" | "ebbing" | "slack-high" | "slack-low";

export interface HourlySurfaceCondition {
  hour: number;
  windSpeedKnots: number;
  windDegrees: number;
  tidalSpeedKnots: number;
  tidalDegrees: number;
  waveHeightM: number;
  isSlack?: boolean;
  phase?: TidePhase;
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
  isSlack: boolean;
  phase?: TidePhase;
  /** Index of the leg the boat is on at the END of this hour (trolling+waypoints only). */
  activeLegIndex?: number;
  /** Distance in km remaining on the active leg at the END of this hour. */
  legRemainingKm?: number;
  /** Index of the user waypoint being chased at the END of this hour. */
  targetWaypointIndex?: number;
  /** Speed contribution (kt) from wind+tidal drift alone (vector magnitude of 0.7*tidal + 0.3*wind). */
  driftContributionKnots?: number;
  /** Speed contribution (kt) from boat propulsion alone. Trolling mode only. */
  boatContributionKnots?: number;
}

/** User-placed turn point on the water surface for multi-leg trolling. */
export interface TrollWaypoint {
  lat: number;
  lon: number;
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
  manualSlackNow: boolean;
  setManualSlackNow: (b: boolean) => void;

  driftMode: "drift" | "trolling";
  setDriftMode: (m: "drift" | "trolling") => void;
  boatHeadingDeg: number;
  setBoatHeadingDeg: (v: number) => void;
  boatSpeedKnots: number;
  setBoatSpeedKnots: (v: number) => void;

  /** Ordered turn points for multi-leg trolling courses. */
  driftWaypoints: TrollWaypoint[];
  addDriftWaypoint: (wp: TrollWaypoint) => void;
  removeDriftWaypoint: (index: number) => void;
  moveDriftWaypoint: (index: number, direction: -1 | 1) => void;
  clearDriftWaypoints: () => void;
}

export const TROLL_MAX_KNOTS = 10;

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
  manualSlackNow: false,
  setManualSlackNow: (b) => set({ manualSlackNow: b }),

  driftMode: "drift",
  setDriftMode: (m) => set({ driftMode: m }),
  boatHeadingDeg: 0,
  setBoatHeadingDeg: (v) => set({ boatHeadingDeg: ((v % 360) + 360) % 360 }),
  boatSpeedKnots: 2.5,
  setBoatSpeedKnots: (v) => set({ boatSpeedKnots: Math.max(0, Math.min(TROLL_MAX_KNOTS, v)) }),

  driftWaypoints: [],
  addDriftWaypoint: (wp) =>
    set((s) => ({ driftWaypoints: [...s.driftWaypoints, wp] })),
  removeDriftWaypoint: (index) =>
    set((s) => ({ driftWaypoints: s.driftWaypoints.filter((_, i) => i !== index) })),
  moveDriftWaypoint: (index, direction) =>
    set((s) => {
      const next = [...s.driftWaypoints];
      const j = index + direction;
      if (index < 0 || index >= next.length || j < 0 || j >= next.length) return s;
      [next[index], next[j]] = [next[j]!, next[index]!];
      return { driftWaypoints: next };
    }),
  clearDriftWaypoints: () => set({ driftWaypoints: [] }),
}));
