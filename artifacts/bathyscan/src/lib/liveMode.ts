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
 * The full TrailRecorder UI now lives exclusively inside the Live panel.
 * When a recording is running on another tab, only a compact ⏺ REC chip is
 * visible in the viewport — clicking it navigates back to the Live tab.
 *
 * Wiring: uiStore.setSidebarMode calls onSidebarModeChange on every explicit
 * transition, and applySettingsToUiStore calls it on hydration so a persisted
 * 'live' mode resumes GPS + follow after a page reload.
 */
import React from "react";
import { create } from "zustand";
import { useGpsStore } from "./gpsStore";
import { useTrailStore } from "./trailStore";
import { useCameraStore } from "./cameraStore";
import { useSettingsStore, type SidebarMode } from "./settingsStore";
import { toast } from "@/hooks/use-toast";
import { ToastAction, type ToastActionElement } from "@/components/ui/toast";

/**
 * Observable store for Live-mode retry state.
 * React components subscribe to this so they can show a "Reconnecting…"
 * indicator without polling module-level variables.
 */
interface LiveModeState {
  /** Number of GPS reconnect attempts made since the last successful fix or Live entry (0 = no pending retry). */
  gpsRetryAttempt: number;
  /** Maximum number of attempts; matches MAX_GPS_RETRIES so the UI can show "attempt X of N". */
  gpsMaxRetries: number;
  /**
   * True when all MAX_GPS_RETRIES attempts have been exhausted without a
   * successful fix. Cleared on Live-mode exit (and re-entry) so the counter
   * starts fresh when the user toggles Live mode off and on again.
   */
  gpsRecoveryFailed: boolean;
  /**
   * Sign-out isolation reset. Held in store state (rather than only as the
   * module-level resetLiveModeForSignOut) so the sign-out manifest guard can
   * mechanically verify performSignOutCleanup invokes it, like every other
   * manifest store. Delegates to resetLiveModeForSignOut below.
   */
  resetForSignOut: () => void;
}

export const useLiveModeStore = create<LiveModeState>(() => ({
  gpsRetryAttempt: 0,
  gpsMaxRetries: 3, // kept in sync with MAX_GPS_RETRIES below
  gpsRecoveryFailed: false,
  resetForSignOut: () => resetLiveModeForSignOut(),
}));

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

/** Maximum number of automatic GPS restart attempts after an error in Live mode. */
const MAX_GPS_RETRIES = 3;

/** Delay between GPS restart attempts when in Live mode (milliseconds). */
const GPS_RETRY_DELAY_MS = 5_000;

/** Number of GPS restart attempts made since the last successful fix or Live entry. */
let gpsRetryCount = 0;

/** Pending retry timer handle (null when no retry is scheduled). */
let gpsRetryTimer: ReturnType<typeof setTimeout> | null = null;

/** Exported for tests — reset module-level state between test cases. */
export function __resetLiveModeForTests(): void {
  unsubGps?.();
  unsubGps = null;
  liveActive = false;
  trailStartedByLive = false;
  if (gpsRetryTimer !== null) {
    clearTimeout(gpsRetryTimer);
    gpsRetryTimer = null;
  }
  gpsRetryCount = 0;
  useLiveModeStore.setState({ gpsRetryAttempt: 0, gpsRecoveryFailed: false });
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

/**
 * Return a browser-specific URL for "how to re-enable location access".
 * Detects Chrome/Edge, Firefox, and Safari; falls back to the Chrome guide
 * for all other Chromium-based browsers.
 */
export function getLocationHelpUrl(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Firefox\//i.test(ua)) {
    return "https://support.mozilla.org/en-US/kb/permissions-manager-give-ability-store-passwords-set-cookies-and-more";
  }
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) {
    return "https://support.apple.com/guide/safari/websites-ibrwe2159f50/mac";
  }
  // Chrome, Edge, and other Chromium-based browsers.
  return "https://support.google.com/chrome/answer/142065";
}

/**
 * Show a toast for PERMISSION_DENIED (GPS error code 1) that includes a
 * "How to enable" action button linking to browser-specific location-settings
 * help. Unlike transient errors, permission-denied cannot self-heal with a
 * retry, so the toast gives users a direct path to fix it themselves.
 */
function notifyPermissionDeniedError(): void {
  toast({
    title: "GPS unavailable",
    description:
      "Location access is blocked. Enable it in your browser settings to use Live mode.",
    variant: "destructive",
    action: React.createElement(
      ToastAction,
      {
        altText: "How to enable location access",
        onClick: () =>
          window.open(getLocationHelpUrl(), "_blank", "noopener,noreferrer"),
      },
      "How to enable",
    ) as unknown as ToastActionElement,
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

  // Start trail recording only when the user has auto-start enabled AND no
  // session is already running. If points from a previous (paused) session
  // exist, resume that session rather than starting fresh — leaving Live
  // pauses the trail, it never resets it.
  const trail = useTrailStore.getState();
  const autoStart = useSettingsStore.getState().autoStartTrailRecording;
  if (!trail.recording) {
    if (autoStart) {
      const interval = useSettingsStore.getState().gpsRecordingInterval;
      if (trail.currentPoints.length > 0) trail.resumeRecording(interval);
      else trail.startRecording(interval);
      trailStartedByLive = true;
    } else {
      trailStartedByLive = false;
    }
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
      // Successful fix — reset all retry state so the cap starts fresh and
      // any failure banner is dismissed.
      gpsRetryCount = 0;
      useLiveModeStore.setState({ gpsRetryAttempt: 0, gpsRecoveryFailed: false });
      if (gpsRetryTimer !== null) {
        clearTimeout(gpsRetryTimer);
        gpsRetryTimer = null;
      }
      useCameraStore.getState().setGpsFollowMode(true);
    }
    if (state.error && state.error !== prev.error) {
      // PERMISSION_DENIED (code 1) is a permanent failure until the user
      // changes browser settings — retrying cannot self-heal it, and doing so
      // wastes the cap and may confuse the user with repeated error toasts.
      // Only schedule a retry for transient errors (code 2 = unavailable,
      // code 3 = timeout, null = unknown origin).
      const isPermissionDenied = state.errorCode === 1;
      if (isPermissionDenied) {
        notifyPermissionDeniedError();
      } else {
        notifyGpsError(state.error);
      }
      if (!isPermissionDenied && gpsRetryCount < MAX_GPS_RETRIES) {
        gpsRetryCount++;
        useLiveModeStore.setState({ gpsRetryAttempt: gpsRetryCount });
        if (gpsRetryTimer !== null) clearTimeout(gpsRetryTimer);
        gpsRetryTimer = setTimeout(() => {
          gpsRetryTimer = null;
          if (!liveActive) return;
          // Only call startWatching when the watch was cleared by the error
          // handler — a concurrent fix may have already reinstated it.
          if (useGpsStore.getState().watchId === null) {
            useGpsStore.getState().startWatching();
          }
        }, GPS_RETRY_DELAY_MS);
      } else if (!isPermissionDenied && gpsRetryCount >= MAX_GPS_RETRIES) {
        // All automatic retry attempts have been exhausted. Surface a
        // persistent failure state so the user knows they must act.
        useLiveModeStore.setState({ gpsRecoveryFailed: true });
      }
    }
  });
}

export function exitLiveMode(): void {
  if (!liveActive) return;
  liveActive = false;

  // Cancel any pending GPS-retry timer so it does not fire after the user
  // has intentionally left Live mode.
  if (gpsRetryTimer !== null) {
    clearTimeout(gpsRetryTimer);
    gpsRetryTimer = null;
  }
  gpsRetryCount = 0;
  useLiveModeStore.setState({ gpsRetryAttempt: 0, gpsRecoveryFailed: false });

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
 * Sign-out isolation reset — exits Live mode (cancelling GPS retry timers,
 * unsubscribing the GPS listener, pausing any live-started trail recording,
 * and disabling Follow Me) and returns the observable retry store to its
 * defaults so the next user on this device starts fresh.
 *
 * Listed in SIGNOUT_STORE_MANIFEST (src/hooks/signoutManifest.ts) and called
 * from performSignOutCleanup (src/hooks/signoutCleanup.ts).
 */
export function resetLiveModeForSignOut(): void {
  exitLiveMode();
  useLiveModeStore.setState({ gpsRetryAttempt: 0, gpsRecoveryFailed: false });
}

/**
 * Central transition hook — called by uiStore.setSidebarMode (explicit user
 * action) and applySettingsToUiStore (hydration from persisted settings).
 */
export function onSidebarModeChange(prev: SidebarMode, next: SidebarMode): void {
  if (next === "live" && prev !== "live") enterLiveMode();
  else if (prev === "live" && next !== "live") exitLiveMode();
}
