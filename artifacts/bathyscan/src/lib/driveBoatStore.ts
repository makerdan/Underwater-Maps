/**
 * driveBoatStore.ts — Zustand store for Drive Boat (realistic mode) navigation
 * features: heading lock (autopilot), Drift Planner route following, throttle
 * inertia tracking, and distance-traveled counter.
 */

import { create } from "zustand";

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

  actualBoatSpeedMph: 15,
  setActualBoatSpeedMph: (mph) => set({ actualBoatSpeedMph: mph }),
}));
