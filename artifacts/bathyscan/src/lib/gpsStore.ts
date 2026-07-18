/**
 * gpsStore — Zustand store for browser Geolocation API state.
 *
 * Calling startWatching() requests GPS permission and begins streaming
 * position updates. stopWatching() clears the watch.
 */
import { create } from "zustand";

export interface GpsPosition {
  longitude: number;
  latitude: number;
  accuracy: number;
  timestamp: number;
  /** Ground speed in metres/second (null when the device doesn't report it). */
  speed: number | null;
  /** Heading in degrees true, 0–360 (null when stationary or unreported). */
  heading: number | null;
}

interface GpsStore {
  active: boolean;
  position: GpsPosition | null;
  error: string | null;
  watchId: number | null;
  startWatching: () => void;
  stopWatching: () => void;
}

export const useGpsStore = create<GpsStore>((set, get) => ({
  active: false,
  position: null,
  error: null,
  watchId: null,

  startWatching: () => {
    if (!navigator.geolocation) {
      set({ error: "Geolocation is not supported by this browser." });
      return;
    }

    const existing = get().watchId;
    if (existing !== null) navigator.geolocation.clearWatch(existing);

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        set({
          active: true,
          error: null,
          position: {
            longitude: pos.coords.longitude,
            latitude: pos.coords.latitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
            speed: pos.coords.speed ?? null,
            heading:
              pos.coords.heading != null && isFinite(pos.coords.heading)
                ? ((pos.coords.heading % 360) + 360) % 360
                : null,
          },
        });
      },
      (err) => {
        const msg =
          err.code === 1
            ? "GPS permission denied. Please enable location access in your browser settings."
            : err.code === 2
              ? "GPS position unavailable. Check that location services are enabled."
              : "GPS timed out. Move to an area with better signal.";
        set({ active: false, error: msg });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );

    set({ watchId: id, active: false, error: null });
  },

  stopWatching: () => {
    const { watchId } = get();
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
    }
    set({ active: false, position: null, error: null, watchId: null });
  },
}));
