import { useEffect, useState } from "react";
import { useIsConnecting } from "@/lib/queryClient";
import { CopyButton } from "@/components/ui/CopyButton";
import { X } from "lucide-react";

/**
 * Dev-only endpoint served by the Vite dev server (see devApiRestartPlugin in
 * vite.config.ts). It is NOT served by the API server — that server is down
 * exactly when this button is needed. Base-prefixed so it survives non-root
 * BASE_PATH configurations (BASE_URL always ends with "/").
 */
export const RESTART_API_ENDPOINT = `${import.meta.env.BASE_URL}__restart_api_server`;

/**
 * DevApiDownBanner — development-only warning banner shown across all screens
 * while the API server is unreachable (as reported by the health-poll state in
 * queryClient.ts, NOT by any single failed fetch).
 *
 * - Appears when useIsConnecting() flips true (health poll / network error).
 * - Auto-dismisses when the health poll confirms the server is back.
 * - "Restart API Server" posts to the Vite dev-server restart endpoint and
 *   shows a restarting state until connectivity recovers.
 * - × button lets the user manually dismiss the banner (it re-appears if the
 *   health poll detects a new outage).
 * - Copy button copies the banner message to the clipboard.
 *
 * Production exclusion (defense in depth):
 * 1. The mount site in App.tsx is gated on `import.meta.env.DEV`, which is
 *    statically false in production builds — the import is tree-shaken away.
 * 2. The early return below makes the component a no-op even if it were ever
 *    mounted outside dev.
 */
export function DevApiDownBanner() {
  const apiDown = useIsConnecting();
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // When connectivity recovers, clear the restarting/error/dismissed state so
  // the next outage starts from a clean slate.
  useEffect(() => {
    if (!apiDown) {
      setRestarting(false);
      setRestartError(null);
      setDismissed(false);
    }
  }, [apiDown]);

  if (!import.meta.env.DEV) return null;
  if (!apiDown) return null;
  if (dismissed) return null;

  const bannerMessage = restarting
    ? "API server restarting — waiting for it to come back…"
    : "API server is unreachable — requests will fail until it is restarted.";

  const copyText = restartError
    ? `${bannerMessage} (${restartError})`
    : bannerMessage;

  const handleRestart = async () => {
    setRestarting(true);
    setRestartError(null);
    try {
      const resp = await fetch(RESTART_API_ENDPOINT, { method: "POST" });
      // 202 = restart kicked off; 409 = a restart is already in flight —
      // both mean "keep showing the restarting state and wait for the
      // health poll to detect recovery".
      if (!resp.ok && resp.status !== 409) {
        throw new Error(`Restart request failed (HTTP ${resp.status})`);
      }
    } catch (err) {
      setRestarting(false);
      setRestartError(
        err instanceof Error ? err.message : "Restart request failed",
      );
    }
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="dev-api-down-banner"
      className="fixed inset-x-0 top-7 z-[9998] flex flex-wrap items-center justify-center gap-3 min-h-9 py-1 px-3 bg-red-950/95 backdrop-blur-sm border-b border-red-800/60 text-red-200 text-[18px] font-mono select-none"
    >
      <span className="font-semibold text-red-300">DEV</span>
      <span>{bannerMessage}</span>
      {restartError && (
        <span className="text-amber-300">({restartError})</span>
      )}
      <button
        onClick={handleRestart}
        disabled={restarting}
        data-testid="button-restart-api-server"
        className="px-2 py-0.5 bg-red-700 hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed rounded text-[16.5px] text-white transition-colors"
      >
        {restarting ? "Restarting…" : "Restart API Server"}
      </button>
      <CopyButton
        text={copyText}
        className="text-red-300/70 hover:text-red-200"
      />
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss API down banner"
        data-testid="dev-api-down-dismiss-btn"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 opacity-60 hover:opacity-100 transition-opacity text-red-300 focus:outline-none focus:ring-1 focus:ring-red-400 rounded"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
