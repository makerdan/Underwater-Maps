import { create } from "zustand";

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
 * - `'paused'`    — tracking temporarily suspended by manual camera
 *                   interaction; will auto-resume after inactivity delay
 */
export type GpsFollowState = "off" | "following" | "paused";

interface CameraStore {
  crosshairGps: GpsPoint | null;
  lastClickedGps: GpsPoint | null;
  setCrosshairGps: (gps: GpsPoint | null) => void;
  setLastClickedGps: (gps: GpsPoint | null) => void;

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
   * `pauseFollowForInteraction()` transitions following → paused.
   * `resumeFollow()` transitions paused → following.
   */
  gpsFollowState: GpsFollowState;
  setGpsFollowMode: (v: boolean) => void;

  /** Epoch ms of the most recent manual camera interaction while paused. */
  followLastInteractionAt: number;
  /**
   * Record a manual camera interaction during follow mode: enters (or
   * refreshes) the paused state and resets the inactivity timer. No-op when
   * follow mode is off.
   */
  pauseFollowForInteraction: () => void;
  /** Clear the paused state (used by the auto-resume timer). */
  resumeFollow: () => void;
}

export const useCameraStore = create<CameraStore>((set) => ({
  crosshairGps: null,
  lastClickedGps: null,
  setCrosshairGps: (gps) => set({ crosshairGps: gps }),
  setLastClickedGps: (gps) => set({ lastClickedGps: gps }),

  cameraPosition: { known: false },
  cameraDepth: null,
  cameraAltitude: 0,
  heading: 0,
  speedIndex: 2,

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
  // Turning follow mode on or off always clears any interaction-pause state
  // so a fresh session never inherits a stale pause/timer.
  setGpsFollowMode: (v) =>
    set({ gpsFollowState: v ? "following" : "off", followLastInteractionAt: 0 }),

  followLastInteractionAt: 0,
  pauseFollowForInteraction: () =>
    set((state) =>
      state.gpsFollowState === "following"
        ? { gpsFollowState: "paused", followLastInteractionAt: Date.now() }
        : state.gpsFollowState === "paused"
          ? { followLastInteractionAt: Date.now() }
          : state,
    ),
  resumeFollow: () => set({ gpsFollowState: "following", followLastInteractionAt: 0 }),
}));
