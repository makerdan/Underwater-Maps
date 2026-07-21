/**
 * liveMode — orchestration for the "Live" sidebar mode.
 *
 * Entering Live mode (sidebarMode === 'live') is a one-tap "I'm on the water"
 * action that:
 *   1. Starts the GPS watch (requests permission if needed).
 *   2. Starts trail recording at the user's configured sampling interval
 *      (unless a recording session is already running). If points from a
 *      previous paused session exist, that session resumes instead of
 *      starting fresh.
 *   3. Enables Follow Me (camera gpsFollowMode) — deferred until the first
 *      GPS fix arrives, because the follow camera auto-disables itself when
 *      GPS is not active.
 *
 * Leaving Live mode:
 *   - Disables Follow Me.
 *   - Pauses trail recording ONLY if Live mode started it (a session the
 *     user started manually before entering Live is left untouched).
 *     Recorded points are preserved (stopRecording never clears them) so
 *     re-entering Live resumes the same trail.
 *   - Keeps the GPS watch running so the position marker / HUD stay live.
 *
 * The standalone TrailRecorder popup (shown outside Live mode when GPS is
 * active) remains the explicit user-driven recording surface; the Live panel
 * shows its own recording card, so the popup is hidden while in Live mode.
 *
 * Wiring: uiStore.setSidebarMode calls onSidebarModeChange on every explicit
 * transition, and applySettingsToUiStore calls it on hydration so a persisted
 * 'live' mode resumes GPS + follow after a page reload.
 */
import { useGpsStore } from "./gpsStore";
import { useTrailStore } from "./trailStore";
import { useCameraStore } from "./cameraStore";
import { useSettingsStore } from "./settingsStore";
import { toast } from "@/hooks/use-toast";
import type { SidebarMode } from "./settingsStore";

/** Unsubscribe handle for the GPS-store subscription active while in Live mode. */
let unsubGps: (() => void) | null = null;

/** True while Live mode is the active sidebar mode (orchestration engaged). */
let liveActive = false;

/**
 * True when Live mode started the current trail recording session itself.
 * If the user was already recording before entering Live, leaving Live does
 * not stop their pre-existing session.
 */
let trailStartedByLive = false;

/** Exported for tests — reset module-level state between test cases. */
export function __resetLiveModeForTests(): void {
  unsubGps?.();
  unsubGps = null;
  liveActive = false;
  trailStartedByLive = false;
}

export function isLiveModeActive(): boolean {
  return liveActive;
}

function notifyGpsError(message: string): void {
  toast({
    title: "GPS unavailable",
    description: message,
    variant: "destructive",
  });
}

export function enterLiveMode(): void {
  if (liveActive) return;
  liveActive = true;

  // Start the GPS watch unless one is already running — restarting an active
  // watch would reset `active` to false and drop the current fix.
  const gps = useGpsStore.getState();
  if (gps.watchId === null) gps.startWatching();

  // Geolocation-unsupported browsers set error synchronously.
  const immediateError = useGpsStore.getState().error;
  if (immediateError) notifyGpsError(immediateError);

  // Start trail recording unless a session is already running. If points
  // from a previous (paused) session exist, resume that session rather than
  // starting fresh — leaving Live pauses the trail, it never resets it.
  const trail = useTrailStore.getState();
  if (!trail.recording) {
    const interval = useSettingsStore.getState().gpsRecordingInterval;
    if (trail.currentPoints.length > 0) trail.resumeRecording(interval);
    else trail.startRecording(interval);
    trailStartedByLive = true;
  } else {
    trailStartedByLive = false;
  }

  // Follow Me: enable immediately if GPS already has a fix; otherwise wait
  // for the first fix (the follow camera disables itself while !gpsActive).
  if (useGpsStore.getState().active) {
    useCameraStore.getState().setGpsFollowMode(true);
  }

  unsubGps?.();
  unsubGps = useGpsStore.subscribe((state, prev) => {
    if (!liveActive) return;
    if (state.active && !prev.active) {
      useCameraStore.getState().setGpsFollowMode(true);
    }
    if (state.error && state.error !== prev.error) {
      notifyGpsError(state.error);
    }
  });
}

export function exitLiveMode(): void {
  if (!liveActive) return;
  liveActive = false;

  unsubGps?.();
  unsubGps = null;

  // Pause the trail only if Live started it — points are preserved so
  // re-entering Live resumes the same session.
  if (trailStartedByLive && useTrailStore.getState().recording) {
    useTrailStore.getState().stopRecording();
  }
  trailStartedByLive = false;

  useCameraStore.getState().setGpsFollowMode(false);
}

/**
 * Central transition hook — called by uiStore.setSidebarMode (explicit user
 * action) and applySettingsToUiStore (hydration from persisted settings).
 */
export function onSidebarModeChange(prev: SidebarMode, next: SidebarMode): void {
  if (next === "live" && prev !== "live") enterLiveMode();
  else if (prev === "live" && next !== "live") exitLiveMode();
}
