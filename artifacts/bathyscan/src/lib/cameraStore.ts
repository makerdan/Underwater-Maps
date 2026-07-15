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
  setGpsFollowMode: (v) => set({ gpsFollowMode: v }),
}));
