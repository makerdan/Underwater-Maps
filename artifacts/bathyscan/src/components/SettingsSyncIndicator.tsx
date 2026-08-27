import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useUser } from "@/lib/clerkCompat";
import {
  flushServerSync,
  getSettingsSyncStatus,
  hasUnackedSettingsEdits,
  subscribeSettingsSyncStatus,
} from "@/hooks/useServerSettingsSync";

const ACKNOWLEDGEMENT_VISIBLE_MS = 2_000;

/**
 * App-shell status for settings writes. This intentionally lives outside the
 * Settings route so a failed/backed-off write remains actionable while the
 * user explores the map or another route.
 */
export function SettingsSyncIndicator() {
  const { isSignedIn } = useUser();
  const syncStatus = useSyncExternalStore(
    subscribeSettingsSyncStatus,
    getSettingsSyncStatus,
  );

  const [showAcknowledgement, setShowAcknowledgement] = useState(false);
  const hasShownAcknowledgementRef = useRef(false);

  const hasPendingEdits =
    syncStatus.syncing ||
    syncStatus.lastSyncFailed ||
    hasUnackedSettingsEdits();

  useEffect(() => {
    if (!isSignedIn) {
      hasShownAcknowledgementRef.current = false;
      setShowAcknowledgement(false);
      return;
    }

    if (hasPendingEdits || hasShownAcknowledgementRef.current) {
      setShowAcknowledgement(false);
      return;
    }

    hasShownAcknowledgementRef.current = true;
    setShowAcknowledgement(true);
    const timeoutId = setTimeout(() => {
      setShowAcknowledgement(false);
    }, ACKNOWLEDGEMENT_VISIBLE_MS);

    return () => clearTimeout(timeoutId);
  }, [hasPendingEdits, isSignedIn]);

  if (!isSignedIn) return null;

  if (!hasPendingEdits) {
    if (!showAcknowledgement) return null;

    return (
      <div
        data-testid="global-settings-sync-status"
        data-sync-state="acknowledged"
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-3 left-1/2 z-[210] -translate-x-1/2 rounded border border-slate-700/70 bg-slate-950/90 px-3 py-1.5 font-mono text-[12px] tracking-wide text-slate-400 shadow-lg backdrop-blur-sm"
      >
        Settings synced
      </div>
    );
  }

  const failed = syncStatus.lastSyncFailed && !syncStatus.syncing;
  return (
    <div
      data-testid="global-settings-sync-status"
      data-sync-state={failed ? "failed" : "pending"}
      role={failed ? "alert" : "status"}
      aria-live={failed ? "assertive" : "polite"}
      className={`fixed bottom-3 left-1/2 z-[210] flex -translate-x-1/2 items-center gap-3 rounded border px-3 py-1.5 font-mono text-[12px] tracking-wide shadow-lg backdrop-blur-sm ${
        failed
          ? "border-red-700/70 bg-red-950/95 text-red-300"
          : "border-amber-700/70 bg-amber-950/95 text-amber-300"
      }`}
    >
      <span>{failed ? "Settings not synced" : "Settings pending sync"}</span>
      <button
        type="button"
        data-testid="global-settings-sync-retry"
        onClick={() => {
          void flushServerSync().catch(() => {
            // The failed status remains in the external store and keeps this
            // action visible when the retry does not reach the server.
          });
        }}
        className="rounded border border-current/60 px-2 py-0.5 text-[11px] uppercase tracking-wide underline-offset-2 hover:underline"
      >
        Retry
      </button>
    </div>
  );
}