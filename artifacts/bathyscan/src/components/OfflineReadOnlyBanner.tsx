import React, { useEffect, useState } from "react";
import { useOfflineStore } from "@/lib/offlineStore";
import { CopyButton } from "@/components/ui/CopyButton";

const OFFLINE_IDENTITY_KEY = "bathyscan-offline-identity-v1";

interface CachedIdentity {
  displayName: string;
  userId: string;
}

function readCachedIdentity(): CachedIdentity | null {
  try {
    const raw = localStorage.getItem(OFFLINE_IDENTITY_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedIdentity;
  } catch {
    return null;
  }
}

/**
 * Writes the current user's display name to localStorage so the
 * OfflineReadOnlyBanner can show it while offline.
 *
 * Call this from ClerkAuthTokenWirer whenever the user object is available.
 */
export function persistOfflineIdentity(identity: CachedIdentity): void {
  try {
    localStorage.setItem(OFFLINE_IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    /* ignore – storage may be unavailable */
  }
}

/**
 * Non-dismissable amber banner shown when the Clerk session token returned
 * null while the device was offline.  Shown instead of SessionExpiredBanner
 * in that case — reloading while offline does nothing, so we don't offer a
 * reload button.
 *
 * Clears automatically when isOfflineReadOnly reverts to false (i.e. the
 * device reconnected and a valid token was obtained).
 */
export function OfflineReadOnlyBanner() {
  const isOfflineReadOnly = useOfflineStore((s) => s.isOfflineReadOnly);
  const [cachedIdentity, setCachedIdentity] = useState<CachedIdentity | null>(null);

  useEffect(() => {
    if (isOfflineReadOnly) {
      setCachedIdentity(readCachedIdentity());
    }
  }, [isOfflineReadOnly]);

  if (!isOfflineReadOnly) return null;

  const name = cachedIdentity?.displayName;

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="offline-read-only-banner"
      className="fixed inset-x-0 top-0 z-[9999] flex items-center justify-center gap-2 h-9 bg-amber-950/95 backdrop-blur-sm border-b border-amber-700/50 text-amber-300 text-[18px] font-medium select-text px-4"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="flex-shrink-0"
      >
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      <span>
        You're offline — viewing your saved data
        {name ? ` (${name})` : ""}.{" "}
        Changes will sync when you reconnect.
      </span>
      <CopyButton
        text={`You're offline — viewing your saved data${name ? ` (${name})` : ""}. Changes will sync when you reconnect.`}
        className="text-amber-300/70 hover:text-amber-200"
      />
    </div>
  );
}
