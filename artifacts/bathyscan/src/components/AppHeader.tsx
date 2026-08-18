import React, { useEffect, useRef, useState } from "react";
import { useUser, useClerk } from "@/lib/clerkCompat";
import { useLocation } from "wouter";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { authorizedFetch } from "@/lib/authorizedFetch";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Poll interval for pending-user count (ms). Kept long to avoid excess traffic. */
const PENDING_POLL_INTERVAL_MS = 30_000;

/**
 * Lightweight hook that polls GET /api/admin/users/pending-count every 30 s.
 * Returns 0 when the user is not an admin, the server is unavailable, or the
 * count cannot be parsed. Never throws.
 */
function usePendingUserCount(isAdmin: boolean): number {
  const [pendingCount, setPendingCount] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!isAdmin) {
      setPendingCount(0);
      return;
    }

    cancelledRef.current = false;

    async function fetchCount() {
      try {
        const res = await authorizedFetch(`${basePath}/api/admin/users/pending-count`);
        if (cancelledRef.current) return;
        if (!res.ok) return;
        const data = (await res.json()) as { count?: unknown };
        if (cancelledRef.current) return;
        const n = typeof data.count === "number" ? data.count : 0;
        setPendingCount(n);
      } catch {
        // Best-effort — leave count unchanged on network error.
      }
    }

    void fetchCount();
    const id = setInterval(() => void fetchCount(), PENDING_POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [isAdmin]);

  return pendingCount;
}

export function AppHeader() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();

  const isAdmin =
    (user?.publicMetadata as { role?: unknown } | undefined)?.role === "admin";

  const pendingCount = usePendingUserCount(isLoaded && !!user && isAdmin);

  return (
    <header
      className="flex items-center justify-between px-4 shrink-0 bg-[#040810]/80 backdrop-blur-sm border-b border-[#1e3a5f]/60 z-30"
      style={{ height: 40 }}
    >
      <span className="font-mono text-[#38bdf8] text-sm tracking-[0.25em] uppercase font-semibold select-none">
        BATHYSCAN
      </span>

      {isLoaded && user && (
        <div className="flex items-center gap-3">
          <span className="font-mono text-[#e2e8f0] text-xs hidden sm:block">
            {user.primaryEmailAddress?.emailAddress ?? user.username ?? ""}
          </span>
          <ViewscreenTooltip
            label={
              pendingCount > 0
                ? `Open Settings — ${pendingCount} user${pendingCount === 1 ? "" : "s"} awaiting approval`
                : "Open Settings (preferences, HUD, layout)"
            }
            side="bottom"
          >
            <button
              data-testid="settings-link"
              onClick={() => setLocation(basePath + "/settings?tab=account")}
              className="relative font-mono text-[#94a3b8] hover:text-[#e2e8f0] text-xs tracking-wider uppercase transition-colors"
              aria-label={
                pendingCount > 0
                  ? `Settings — ${pendingCount} pending approval${pendingCount === 1 ? "" : "s"}`
                  : "Settings"
              }
            >
              Settings
              {pendingCount > 0 && (
                <span
                  data-testid="pending-approvals-badge"
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -8,
                    minWidth: 14,
                    height: 14,
                    borderRadius: 7,
                    background: "#f97316",
                    color: "#fff",
                    fontSize: 9,
                    fontWeight: 700,
                    lineHeight: "14px",
                    textAlign: "center",
                    padding: "0 3px",
                    letterSpacing: 0,
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  }}
                >
                  {pendingCount > 99 ? "99+" : pendingCount}
                </span>
              )}
            </button>
          </ViewscreenTooltip>
          <ViewscreenTooltip label="Sign out of your account" side="bottom">
            <button
              onClick={() => signOut()}
              className="font-mono text-[#94a3b8] hover:text-[#e2e8f0] text-xs tracking-wider uppercase transition-colors"
            >
              Sign out
            </button>
          </ViewscreenTooltip>
        </div>
      )}
    </header>
  );
}
