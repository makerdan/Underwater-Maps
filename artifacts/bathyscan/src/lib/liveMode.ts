/**
 * liveMode — orchestration for the "Live" sidebar mode.
 *
 * Entering Live mode (sidebarMode === 'live') is a one-tap "I'm on the water"
 * action that:
 *   1. Starts the GPS watch (requests permission if needed).
 *   2. Enables Follow Me (camera gpsFollowMode) — deferred until the first
 *      GPS fix arrives, because the follow camera auto-disables itself when
 *      GPS is not active.
 *
 * Trail recording is NOT started automatically. The user taps "Start GPS Trail"
 * inside the Live panel to begin recording.
 *
 * Leaving Live mode:
 *   - Disables Follow Me.
 *   - Keeps the GPS watch running so the position marker / HUD stay live.
 *   - Does NOT stop any in-progress trail recording (user-controlled).
 *
 * Wiring: uiStore.setSidebarMode calls onSidebarModeChange on every explicit
 * transition, and applySettingsToUiStore calls it on hydration so a persisted
 * 'live' mode resumes GPS + follow after a page reload.
 */
import { useGpsStore } from "./gpsStore";
import { useCameraStore } from "./cameraStore";
import { toast } from "@/hooks/use-toast";
import type { SidebarMode } from "./settingsStore";

/** Unsubscribe handle for the GPS-store subscription active while in Live mode. */
let unsubGps: (() => void) | null = null;

/** True while Live mode is the active sidebar mode (orchestration engaged). */
let liveActive = false;

/** Exported for tests — reset module-level state between test cases. */
export function __resetLiveModeForTests(): void {
  unsubGps?.();
  unsubGps = null;
  liveActive = false;
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
