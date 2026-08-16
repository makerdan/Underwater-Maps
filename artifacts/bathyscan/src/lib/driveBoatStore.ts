/**
 * driveBoatStore.ts — Zustand store for Drive Boat (realistic mode) navigation
 * features: heading lock (autopilot), Drift Planner route following, throttle
 * inertia tracking, distance-traveled counter, and the Drive Boat UI prefs
 * (realisticMode toggle and boatSpeedMph) that were previously held in
 * AppProvider React state.
 *
 * Moving realisticMode/boatSpeedMph here (from AppProvider useState) allows
 * performSignOutCleanup to reset them synchronously via resetForSignOut(),
 * so the next user on the same device never inherits a previous user's Drive
 * Boat toggle state without requiring a page reload.
 */

import { create } from "zustand";
import { BOAT_DEFAULT_MPH, BOAT_MIN_MPH, BOAT_MAX_MPH } from "./boatSpeed";

function readLocalBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function readLocalNumber(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = parseFloat(raw);
    return isNaN(n) ? fallback : Math.max(min, Math.min(max, n));
  } catch {
    return fallback;
  }
}

interface DriveBoatStore {
  /** Whether the heading-lock autopilot is engaged. */
  headingLocked: boolean;
  /** The compass bearing (0–359°, 0=South in engine convention) the autopilot holds. */
  lockedBearing: number;
  setHeadingLocked: (b: boolean) => void;
  setLockedBearing: (deg: number) => void;

  /** Whether the camera is autonomously following Drift Planner waypoints. */
  followingRoute: boolean;
  /** Which driftWaypoints index we're currently driving toward. */
  routeLegIndex: number;
  /** Nautical miles remaining to the next turn point (for HUD display). */
  distanceToNextNm: number;
  setFollowingRoute: (b: boolean) => void;
  setRouteLegIndex: (i: number) => void;
  setDistanceToNextNm: (d: number) => void;

  /** Cumulative nautical miles traveled since last reset. */
  distanceTraveledNm: number;
  resetDistanceTraveled: () => void;
  /** Called each frame with the frame's displacement in nautical miles. */
  addDistanceNm: (d: number) => void;

  /** Inertia-smoothed actual speed (mph) — lags behind boatSpeedMph during ramp. */
  actualBoatSpeedMph: number;
  setActualBoatSpeedMph: (mph: number) => void;

  /**
   * Whether Drive Boat (realistic mode) is currently active.
   * Persisted to localStorage ("bathyscan:realisticMode").
   * Moved here from AppProvider so sign-out can reset it without a page reload.
   */
  realisticMode: boolean;
  setRealisticMode: (b: boolean) => void;

  /**
   * Target boat speed in mph for Drive Boat mode.
   * Clamped to [BOAT_MIN_MPH, BOAT_MAX_MPH].
   * Persisted to localStorage ("bathyscan:boatSpeedMph").
   * Moved here from AppProvider so sign-out can reset it without a page reload.
   */
  boatSpeedMph: number;
  setBoatSpeedMph: (mph: number) => void;

  /**
   * Reset all Drive Boat session state (navigation + UI prefs) to initial
   * defaults and remove the persisted localStorage keys.
   * Called by performSignOutCleanup so the next user on the same device starts
   * with Drive Boat fully off.
   */
  resetForSignOut: () => void;
}

export const useDriveBoatStore = create<DriveBoatStore>((set) => ({
  headingLocked: false,
  lockedBearing: 0,
  setHeadingLocked: (b) => set({ headingLocked: b }),
  setLockedBearing: (deg) => set({ lockedBearing: ((deg % 360) + 360) % 360 }),

  followingRoute: false,
  routeLegIndex: 0,
  distanceToNextNm: 0,
  setFollowingRoute: (b) => set({ followingRoute: b, routeLegIndex: 0 }),
  setRouteLegIndex: (i) => set({ routeLegIndex: i }),
  setDistanceToNextNm: (d) => set({ distanceToNextNm: d }),

  distanceTraveledNm: 0,
  resetDistanceTraveled: () => set({ distanceTraveledNm: 0 }),
  addDistanceNm: (d) => set((s) => ({ distanceTraveledNm: s.distanceTraveledNm + d })),

  actualBoatSpeedMph: BOAT_DEFAULT_MPH,
  setActualBoatSpeedMph: (mph) => set({ actualBoatSpeedMph: mph }),

  realisticMode: readLocalBool("bathyscan:realisticMode", false),
  setRealisticMode: (b) => {
    set({ realisticMode: b });
    try {
      localStorage.setItem("bathyscan:realisticMode", String(b));
    } catch {
      /* intentional — best-effort persistence; store state is already updated */
    }
  },

  boatSpeedMph: readLocalNumber(
    "bathyscan:boatSpeedMph",
    BOAT_DEFAULT_MPH,
    BOAT_MIN_MPH,
    BOAT_MAX_MPH,
  ),
  setBoatSpeedMph: (mph) => {
    const clamped = Math.max(BOAT_MIN_MPH, Math.min(BOAT_MAX_MPH, mph));
    set({ boatSpeedMph: clamped });
    try {
      localStorage.setItem("bathyscan:boatSpeedMph", String(clamped));
    } catch {
      /* intentional — best-effort persistence; store state is already updated */
    }
  },

  resetForSignOut: () => {
    set({
      headingLocked: false,
      lockedBearing: 0,
      followingRoute: false,
      routeLegIndex: 0,
      distanceToNextNm: 0,
      distanceTraveledNm: 0,
      actualBoatSpeedMph: BOAT_DEFAULT_MPH,
      realisticMode: false,
      boatSpeedMph: BOAT_DEFAULT_MPH,
    });
    try {
      localStorage.removeItem("bathyscan:realisticMode");
      localStorage.removeItem("bathyscan:boatSpeedMph");
    } catch {
      /* ignore — storage may be unavailable */
    }
  },
}));
