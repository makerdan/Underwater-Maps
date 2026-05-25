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
  heading: number;
  mode: "fly" | "orbit";
  speedIndex: number;

  setCameraGeo: (geo: {
    lon: number;
    lat: number;
    depth: number;
    heading: number;
  }) => void;
  setMode: (mode: "fly" | "orbit") => void;
  setSpeedIndex: (speedIndex: number) => void;
}

export const useCameraStore = create<CameraStore>((set) => ({
  crosshairGps: null,
  lastClickedGps: null,
  setCrosshairGps: (gps) => set({ crosshairGps: gps }),
  setLastClickedGps: (gps) => set({ lastClickedGps: gps }),

  cameraLon: null,
  cameraLat: null,
  cameraDepth: null,
  heading: 0,
  mode: "fly",
  speedIndex: 2,

  setCameraGeo: ({ lon, lat, depth, heading }) =>
    set({ cameraLon: lon, cameraLat: lat, cameraDepth: depth, heading }),
  setMode: (mode) => set({ mode }),
  setSpeedIndex: (speedIndex) => set({ speedIndex }),
}));
