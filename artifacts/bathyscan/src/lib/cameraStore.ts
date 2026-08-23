import { create } from "zustand";
import { FLY_DEFAULT_SPEED_TIER } from "./boatSpeed";

export interface GpsPoint {
  lon: number;
  lat: number;
  depth: number;
}

/**
 * Discriminated union for the camera's geographic position.
 *
 * Replaces the two independent nullable fields (`cameraLon: number | null`,
 * `cameraLat: number | null`) so the invalid state of one being set without
 * the other is unrepresentable at both compile time and runtime.
 *
 *   if (pos.known) { use pos.lon / pos.lat }
 */
export type CameraPosition =
  | { readonly known: false }
  | { readonly known: true; readonly lon: number; readonly lat: number };

/**
 * 3-value discriminated union for GPS follow mode.
 *
 * Replaces `gpsFollowMode: boolean` + `followPausedByInteraction: boolean`
 * so the invalid combination (paused while not following) is unrepresentable.
 *
 * - `'off'`       — follow mode disabled
 * - `'following'` — actively tracking the user's GPS position
 * - `'paused'`    — tracking temporarily suspended; see `pauseReason` for why
 */
export type GpsFollowState = "off" | "following" | "paused";

/**
 * Why follow mode is currently paused.
 *
 * - `'interaction'`  — the user panned/rotated the camera manually; will
 *                      auto-resume after the configured inactivity delay.
 * - `'signal-loss'`  — GPS `active` went false (transient outage); will
 *                      auto-resume as soon as `active` returns to true.
 * - `null`           — follow is not paused (state is 'off' or 'following').
 */
export type FollowPauseReason = "interaction" | "signal-loss" | null;

interface CameraStore {
  crosshairGps: GpsPoint | null;
  lastClickedGps: GpsPoint | null;
  setCrosshairGps: (gps: GpsPoint | null) => void;
  setLastClickedGps: (gps: GpsPoint | null) => void;

  /**
   * Turbo mode is active when true.  Transient state — not persisted between
   * sessions; resets to false on page load.
   */
  turboActive: boolean;
  setTurboActive: (v: boolean) => void;

  /** Camera geographic position (unknown until the first render frame fires). */
  cameraPosition: CameraPosition;
  cameraDepth: number | null;
  /**
   * Camera Y position in THREE.js world-space units.
   * Used by the overview minimap to scale the view-cone length.
   * 0 = at the terrain surface, positive = above, negative = below.
   */
  cameraAltitude: number;
  heading: number;
  speedIndex: number;

  setCameraGeo: (geo: {
    lon: number;
    lat: number;
    depth: number | null;
    heading: number;
    altitude: number;
  }) => void;
  setSpeedIndex: (speedIndex: number) => void;
  /** True while the user has two fingers down and is performing a touch orbit. */
  isOrbitingTouch: boolean;
  setIsOrbitingTouch: (v: boolean) => void;

  /**
   * GPS follow state: 'off' | 'following' | 'paused'.
   *
   * Use `setGpsFollowMode(true/false)` to enable/disable follow mode.
   * `pauseFollowForInteraction()` transitions following → paused (interaction).
   * `pauseFollowForSignalLoss()` transitions following → paused (signal-loss).
   * `resumeFollow()` transitions paused → following.
   */
  gpsFollowState: GpsFollowState;
  /**
   * Why follow mode is paused. Null when state is 'off' or 'following'.
   * Only valid to read when gpsFollowState === 'paused'.
   */
  pauseReason: FollowPauseReason;
  setGpsFollowMode: (v: boolean) => void;

  /** Epoch ms of the most recent manual camera interaction while paused. */
  followLastInteractionAt: number;
  /**
   * Record a manual camera interaction during follow mode: enters (or
   * refreshes) the paused state (reason: 'interaction') and resets the
   * inactivity timer. No-op when follow mode is off.
   */
  pauseFollowForInteraction: () => void;
  /**
   * Transition following → paused with reason 'signal-loss'. No-op if already
   * in a signal-loss pause or if follow mode is off. Called by
   * followBoundsCheck when GPS active goes false so that auto-resume can
   * re-engage follow once the signal returns.
   */
  pauseFollowForSignalLoss: () => void;
  /** Clear the paused state and return to 'following'. */
  resumeFollow: () => void;
  /**
   * Sign-out isolation reset — clears the previous user's geographic
   * position traces (crosshair, last click, camera geo) and follow-mode
   * state so nothing about where they were exploring leaks to the next
   * account on this device.
   *
   * Listed in SIGNOUT_STORE_MANIFEST (src/hooks/signoutManifest.ts) and
   * called from performSignOutCleanup (src/hooks/signoutCleanup.ts).
   */
  resetForSignOut: () => void;
}

export const useCameraStore = create<CameraStore>((set) => ({
  crosshairGps: null,
  lastClickedGps: null,
  setCrosshairGps: (gps) => set({ crosshairGps: gps }),
  setLastClickedGps: (gps) => set({ lastClickedGps: gps }),

  turboActive: false,
  setTurboActive: (v) => set({ turboActive: v }),

  cameraPosition: { known: false },
  cameraDepth: null,
  cameraAltitude: 0,
  heading: 0,
  speedIndex: FLY_DEFAULT_SPEED_TIER,

  setCameraGeo: ({ lon, lat, depth, heading, altitude }) =>
    set({
      cameraPosition: { known: true, lon, lat },
      cameraDepth: depth,
      heading,
      cameraAltitude: altitude,
    }),
  setSpeedIndex: (speedIndex) => set({ speedIndex }),
  isOrbitingTouch: false,
  setIsOrbitingTouch: (v) => set({ isOrbitingTouch: v }),

  gpsFollowState: "off",
  pauseReason: null,
  // Turning follow mode on or off always clears any pause state so a fresh
  // session never inherits a stale pause/timer.
  setGpsFollowMode: (v) =>
    set({
      gpsFollowState: v ? "following" : "off",
      pauseReason: null,
      followLastInteractionAt: 0,
    }),

  followLastInteractionAt: 0,
  pauseFollowForInteraction: () =>
    set((state) =>
      state.gpsFollowState === "following"
        ? {
            gpsFollowState: "paused",
            pauseReason: "interaction" as FollowPauseReason,
            followLastInteractionAt: Date.now(),
          }
        : state.gpsFollowState === "paused"
          ? {
              // Always stamp reason as 'interaction' here — a user camera move
              // during a signal-loss pause must override the signal-loss reason
              // so that auto-resume on GPS recovery does NOT re-engage.
              pauseReason: "interaction" as FollowPauseReason,
              followLastInteractionAt: Date.now(),
            }
          : state,
    ),
  pauseFollowForSignalLoss: () =>
    set((state) =>
      state.gpsFollowState === "following"
        ? {
            gpsFollowState: "paused",
            pauseReason: "signal-loss" as FollowPauseReason,
            followLastInteractionAt: 0,
          }
        : state,
    ),
  resumeFollow: () =>
    set({ gpsFollowState: "following", pauseReason: null, followLastInteractionAt: 0 }),

  resetForSignOut: () =>
    set({
      crosshairGps: null,
      lastClickedGps: null,
      turboActive: false,
      cameraPosition: { known: false },
      cameraDepth: null,
      cameraAltitude: 0,
      heading: 0,
      speedIndex: FLY_DEFAULT_SPEED_TIER,
      isOrbitingTouch: false,
      gpsFollowState: "off",
      pauseReason: null,
      followLastInteractionAt: 0,
    }),
}));
