/**
 * useWakeLock — keeps the screen awake while `active` is true.
 *
 * Uses the Screen Wake Lock API (navigator.wakeLock). Degrades silently on
 * browsers that don't support it or when the request is denied (e.g. low
 * battery) — the app keeps working, the screen just dims as usual.
 *
 * The lock is automatically released by the browser when the tab is hidden;
 * a visibilitychange listener re-acquires it when the tab becomes visible
 * again while still active.
 */
import { useEffect, useRef } from "react";

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  released?: boolean;
}

interface WakeLockLike {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
}

function getWakeLock(): WakeLockLike | null {
  const nav = navigator as Navigator & { wakeLock?: WakeLockLike };
  return nav.wakeLock ?? null;
}

export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    const wakeLock = getWakeLock();
    if (!wakeLock) return;
    if (!active) return;

    let cancelled = false;

    const acquire = async () => {
      try {
        const sentinel = await wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Silent degrade: unsupported, permission denied, or low battery.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel) void sentinel.release().catch(() => {});
    };
  }, [active]);
}
