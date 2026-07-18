import { create } from "zustand";

export interface GpsPoint {
  lon: number;
  lat: number;
  depth: number;
}

interface CameraStore {
  crosshairGps: GpsPoint | null;
  lastClickedGps: GpsPoint | null;
  setCrosshairGps: (gps: GpsPoint | null) => void;
  setLastClickedGps: (gps: GpsPoint | null) => void;

  cameraLon: number | null;
  cameraLat: number | null;
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
    depth: number;
    heading: number;
    altitude: number;
  }) => void;
  setSpeedIndex: (speedIndex: number) => void;
  /** True while the user has two fingers down and is performing a touch orbit. */
  isOrbitingTouch: boolean;
  setIsOrbitingTouch: (v: boolean) => void;

  /** When true, the camera continuously tracks the live GPS position. */
  gpsFollowMode: boolean;
  setGpsFollowMode: (v: boolean) => void;

  /**
   * True while follow mode is temporarily paused because the user manually
   * moved the camera (drag / rotate / zoom / keys / joystick). Follow mode
   * remains "on" (gpsFollowMode stays true) and auto-resumes after a period
   * of inactivity. Explicit toggle-off, GPS loss and out-of-bounds fully
   * disable follow mode instead (gpsFollowMode → false, paused cleared).
   */
  followPausedByInteraction: boolean;
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

  cameraLon: null,
  cameraLat: null,
  cameraDepth: null,
  cameraAltitude: 0,
  heading: 0,
  speedIndex: 2,

  setCameraGeo: ({ lon, lat, depth, heading, altitude }) =>
    set({ cameraLon: lon, cameraLat: lat, cameraDepth: depth, heading, cameraAltitude: altitude }),
  setSpeedIndex: (speedIndex) => set({ speedIndex }),
  isOrbitingTouch: false,
  setIsOrbitingTouch: (v) => set({ isOrbitingTouch: v }),

  gpsFollowMode: false,
  // Turning follow mode on or off always clears any interaction-pause state
  // so a fresh session never inherits a stale pause/timer.
  setGpsFollowMode: (v) =>
    set({ gpsFollowMode: v, followPausedByInteraction: false, followLastInteractionAt: 0 }),

  followPausedByInteraction: false,
  followLastInteractionAt: 0,
  pauseFollowForInteraction: () =>
    set((state) =>
      state.gpsFollowMode
        ? { followPausedByInteraction: true, followLastInteractionAt: Date.now() }
        : state,
    ),
  resumeFollow: () => set({ followPausedByInteraction: false, followLastInteractionAt: 0 }),
}));
