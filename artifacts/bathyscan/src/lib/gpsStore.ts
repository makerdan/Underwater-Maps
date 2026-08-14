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
  /**
   * The raw GeolocationPositionError.code from the most recent error, or null
   * when there is no active error. Codes: 1 = PERMISSION_DENIED, 2 =
   * POSITION_UNAVAILABLE, 3 = TIMEOUT.
   */
  errorCode: number | null;
  watchId: number | null;
  startWatching: () => void;
  stopWatching: () => void;
}

export const useGpsStore = create<GpsStore>((set, get) => ({
  active: false,
  position: null,
  error: null,
  errorCode: null,
  watchId: null,

  startWatching: () => {
    if (!navigator.geolocation) {
      set({ error: "Geolocation is not supported by this browser." });
      return;
    }

    const existing = get().watchId;
    if (existing !== null) navigator.geolocation.clearWatch(existing);

    // ownId is set synchronously after watchPosition returns and is captured
    // by the callbacks via closure. Because both callbacks fire asynchronously
    // (after this function returns), ownId is always initialised before they run.
    // This identity guard prevents a delayed error callback from a superseded
    // watch from tearing down a newer, valid watch.
    let ownId: number;

    ownId = navigator.geolocation.watchPosition(
      (pos) => {
        // Ignore callbacks from superseded watches.
        if (get().watchId !== ownId) return;

        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const acc = pos.coords.accuracy;
        const ts = pos.timestamp;

        // Reject fixes with out-of-range or non-finite values to guard against
        // browser quirks, native wrapper edge cases, or mock data pushing NaN /
        // Infinity / impossible coordinates into state. Rejection is silent —
        // no location-derived values are logged.
        if (
          !isFinite(lat) || lat < -90 || lat > 90 ||
          !isFinite(lon) || lon < -180 || lon > 180 ||
          !isFinite(acc) || acc < 0 ||
          !isFinite(ts)
        ) {
          return;
        }

        set({
          active: true,
          error: null,
          errorCode: null,
          position: {
            longitude: lon,
            latitude: lat,
            accuracy: acc,
            timestamp: ts,
            speed: pos.coords.speed != null && isFinite(pos.coords.speed) ? pos.coords.speed : null,
            heading:
              pos.coords.heading != null && isFinite(pos.coords.heading)
                ? ((pos.coords.heading % 360) + 360) % 360
                : null,
          },
        });
      },
      (err) => {
        // Ignore stale callbacks from superseded watches — they must not clear
        // the watchId of a newer, valid watch.
        if (get().watchId !== ownId) return;

        const msg =
          err.code === 1
            ? "GPS permission denied. Please enable location access in your browser settings."
            : err.code === 2
              ? "GPS position unavailable. Check that location services are enabled."
              : "GPS timed out. Move to an area with better signal.";
        // Clear the stale watch and null out watchId so startWatching() can
        // create a fresh watch the next time the user retries (e.g. toggling
        // Live mode off and on). Also null out position so downstream
        // consumers cannot read a stale last-known coordinate as if it were
        // a live fix.
        navigator.geolocation.clearWatch(ownId);
        set({ active: false, error: msg, errorCode: err.code, watchId: null, position: null });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );

    const id = ownId;

    set({ watchId: id, active: false, error: null, errorCode: null });
  },

  stopWatching: () => {
    const { watchId } = get();
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
    }
    set({ active: false, position: null, error: null, errorCode: null, watchId: null });
  },
}));
