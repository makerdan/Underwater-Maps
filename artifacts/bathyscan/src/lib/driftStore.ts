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
 *   - backtroll: enables backtroll mode (stern-first against current)
 *   - driveBoatReverse: Drive Boat reverse-gear flag (ThrottlePanel)
 *   - savedDriftPlans: localStorage-persisted named plans
 *   - reverseDriftPath: computed backwards path from a catch location
 *   - reverseModeActive: when true, map click sets the catch point
 */

import { create } from "zustand";
import { DEFAULT_BOAT_PROFILE_ID } from "./boatProfiles";

export type TidePhase = "flooding" | "ebbing" | "slack-high" | "slack-low";

export interface HourlySurfaceCondition {
  hour: number;
  windSpeedKnots: number;
  windDegrees: number;
  tidalSpeedKnots: number;
  tidalDegrees: number;
  waveHeightM: number;
  waveDirectionDeg?: number;
  isSlack?: boolean;
  phase?: TidePhase;
  /**
   * Tide height above chart datum (m) for this hour, when available from the
   * tidal forecast.  Used to adjust effective water depth at shallow waypoints
   * so the shallow-water tidal scaling and bottom-contact warnings account for
   * the state of the tide.
   */
  tideHeightM?: number;
}

export interface DriftWaypoint {
  hour: number;
  lat: number;
  lon: number;
  worldX: number;
  worldZ: number;
  lineAngleDeg: number;
  hookDepthM: number;
  /** Horizontal distance (m) from the boat to where the hook/sinker hangs in the water column. */
  lineScopeM: number;
  bottomReached: boolean;
  /**
   * True when the predicted sinker depth ≥ terrain depth at this waypoint — the
   * sinker would physically drag the seafloor.  Surfaces as a warning rather
   * than the "in reach" indicator.
   */
  bottomContact: boolean;
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
  /** Compass bearing (0=N) of the boat propulsion vector. Trolling mode only. */
  boatHeadingDegSep?: number;
  /** Compass bearing (0=N) of the wind+tide drift vector. */
  driftHeadingDeg?: number;
  /**
   * True when the absolute speed over ground is below the stall threshold (< 0.05 kt).
   * Backtroll mode only.
   */
  isStalled?: boolean;
  /**
   * Reverse throttle setting (knots) the angler needs to hold station this hour.
   * Computed as: tidalCurrentMagnitude × BACKTROLL_DRAG_COEFFICIENT.
   * Backtroll mode only.
   */
  stallSpeedKnots?: number;
}

/** User-placed turn point on the water surface for multi-leg trolling. */
export interface TrollWaypoint {
  lat: number;
  lon: number;
}

/**
 * A named drift plan persisted to localStorage (cloud sync is out of scope).
 * Captures the full set of inputs needed to reproduce a drift computation.
 */
export interface SavedDriftPlan {
  id: string;
  name: string;
  savedAt: string;
  startLat: number | null;
  startLon: number | null;
  lineLengthM: number;
  lineWeightG: number;
  driftMode: "drift" | "trolling";
  boatHeadingDeg: number;
  boatSpeedKnots: number;
  waypoints: TrollWaypoint[];
}

const SAVED_PLANS_KEY = "bathyscan:savedDriftPlans";

function readSavedPlans(): SavedDriftPlan[] {
  try {
    const raw = localStorage.getItem(SAVED_PLANS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as SavedDriftPlan[];
    return [];
  } catch {
    return [];
  }
}

function writeSavedPlans(plans: SavedDriftPlan[]) {
  try {
    localStorage.setItem(SAVED_PLANS_KEY, JSON.stringify(plans));
  } catch {}
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

  /**
   * Backtroll mode: when true in trolling mode, the thrust vector is reversed
   * (boat moves stern-first against the current).
   */
  backtroll: boolean;
  toggleBacktroll: () => void;
  setBacktroll: (v: boolean) => void;

  /**
   * Drive Boat reverse gear (ThrottlePanel). When true, the camera/boat
   * moves opposite the current facing direction using backtroll drag physics.
   */
  driveBoatReverse: boolean;
  setDriveBoatReverse: (v: boolean) => void;

  /** Ordered turn points for multi-leg trolling courses. */
  driftWaypoints: TrollWaypoint[];
  addDriftWaypoint: (wp: TrollWaypoint) => void;
  removeDriftWaypoint: (index: number) => void;
  moveDriftWaypoint: (index: number, direction: -1 | 1) => void;
  /** Reposition an existing waypoint in place (used by 3D drag-to-fine-tune). */
  updateDriftWaypoint: (index: number, wp: TrollWaypoint) => void;
  clearDriftWaypoints: () => void;
  setDriftWaypoints: (wps: TrollWaypoint[]) => void;

  // ── Saved plans (localStorage only) ────────────────────────────────────
  savedDriftPlans: SavedDriftPlan[];
  saveDriftPlan: (name: string) => void;
  deleteSavedDriftPlan: (id: string) => void;
  loadDriftPlan: (plan: SavedDriftPlan) => void;

  // ── Reverse drift ───────────────────────────────────────────────────────
  /** Backwards-computed path from a catch location. */
  reverseDriftPath: DriftWaypoint[] | null;
  setReverseDriftPath: (path: DriftWaypoint[] | null) => void;
  /** When true, the next water-plane click sets the reverse-drift catch point. */
  reverseModeActive: boolean;
  setReverseModeActive: (b: boolean) => void;
  /** The chosen catch location (end point for reverse drift). */
  catchLat: number | null;
  catchLon: number | null;
  setCatchPoint: (lat: number, lon: number) => void;
  clearCatchPoint: () => void;

  /** Selected boat profile id (see boatProfiles.ts). Persisted to localStorage. */
  boatProfileId: string;
  setBoatProfileId: (id: string) => void;

  /**
   * Return the interpolated tidal vector from `driftConditions` at the given
   * hour offset (0–23). Returns null when no conditions are loaded.
   *
   * This accessor is the single source of truth used by both the Drift Planner
   * physics and the Drive Boat tidal pushback so that scrubbing the timeline to
   * hour N produces the same tidal force in both features.
   */
  getTidalVectorAtHour: (hourOffset: number) => { speedKt: number; directionDeg: number } | null;
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

export const useDriftStore = create<DriftStore>((set, get) => ({
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

  backtroll: false,
  toggleBacktroll: () => set((s) => ({ backtroll: !s.backtroll })),
  setBacktroll: (v) => set({ backtroll: v }),

  driveBoatReverse: false,
  setDriveBoatReverse: (v) => set({ driveBoatReverse: v }),

  driftWaypoints: [],
  addDriftWaypoint: (wp) =>
    set((s) => ({ driftWaypoints: [...s.driftWaypoints, wp] })),
  removeDriftWaypoint: (index) =>
    set((s) => ({ driftWaypoints: s.driftWaypoints.filter((_, i) => i !== index) })),
  updateDriftWaypoint: (index, wp) =>
    set((s) => {
      if (index < 0 || index >= s.driftWaypoints.length) return s;
      const next = s.driftWaypoints.slice();
      next[index] = wp;
      return { driftWaypoints: next };
    }),
  moveDriftWaypoint: (index, direction) =>
    set((s) => {
      const next = [...s.driftWaypoints];
      const j = index + direction;
      if (index < 0 || index >= next.length || j < 0 || j >= next.length) return s;
      [next[index], next[j]] = [next[j]!, next[index]!];
      return { driftWaypoints: next };
    }),
  clearDriftWaypoints: () => set({ driftWaypoints: [] }),
  setDriftWaypoints: (wps) => set({ driftWaypoints: wps }),

  // ── Saved plans ─────────────────────────────────────────────────────────
  savedDriftPlans: readSavedPlans(),

  saveDriftPlan: (name) => {
    const s = get();
    const plan: SavedDriftPlan = {
      id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      savedAt: new Date().toISOString(),
      startLat: s.driftStartLat,
      startLon: s.driftStartLon,
      lineLengthM: s.lineLengthM,
      lineWeightG: s.lineWeightG,
      driftMode: s.driftMode,
      boatHeadingDeg: s.boatHeadingDeg,
      boatSpeedKnots: s.boatSpeedKnots,
      waypoints: s.driftWaypoints.slice(),
    };
    const next = [...get().savedDriftPlans, plan];
    writeSavedPlans(next);
    set({ savedDriftPlans: next });
  },

  deleteSavedDriftPlan: (id) => {
    const next = get().savedDriftPlans.filter((p) => p.id !== id);
    writeSavedPlans(next);
    set({ savedDriftPlans: next });
  },

  loadDriftPlan: (plan) => {
    set({
      driftMode: plan.driftMode,
      boatHeadingDeg: plan.boatHeadingDeg,
      boatSpeedKnots: plan.boatSpeedKnots,
      lineLengthM: plan.lineLengthM,
      lineWeightG: plan.lineWeightG,
      driftWaypoints: plan.waypoints.slice(),
      ...(plan.startLat !== null && plan.startLon !== null
        ? { driftStartLat: plan.startLat, driftStartLon: plan.startLon }
        : {}),
    });
  },

  // ── Reverse drift ────────────────────────────────────────────────────────
  reverseDriftPath: null,
  setReverseDriftPath: (path) => set({ reverseDriftPath: path }),
  reverseModeActive: false,
  setReverseModeActive: (b) => set({ reverseModeActive: b, ...(b ? {} : { catchLat: null, catchLon: null, reverseDriftPath: null }) }),
  catchLat: null,
  catchLon: null,
  setCatchPoint: (lat, lon) => set({ catchLat: lat, catchLon: lon }),
  clearCatchPoint: () => set({ catchLat: null, catchLon: null, reverseDriftPath: null }),

  boatProfileId: (() => {
    try {
      return localStorage.getItem("bathyscan:boatProfileId") ?? DEFAULT_BOAT_PROFILE_ID;
    } catch {
      return DEFAULT_BOAT_PROFILE_ID;
    }
  })(),
  setBoatProfileId: (id) => {
    try { localStorage.setItem("bathyscan:boatProfileId", id); } catch {}
    set({ boatProfileId: id });
  },

  getTidalVectorAtHour: (hourOffset) => {
    const conditions = get().driftConditions;
    if (!conditions || conditions.length === 0) return null;
    const idx = Math.max(0, Math.round(hourOffset)) % conditions.length;
    const cond = conditions[idx]!;
    return { speedKt: cond.tidalSpeedKnots, directionDeg: cond.tidalDegrees };
  },
}));
