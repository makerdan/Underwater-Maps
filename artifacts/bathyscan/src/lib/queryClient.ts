import { useSyncExternalStore } from "react";
import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

function is401(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: unknown }).status === 401
  );
}

function is502(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: unknown }).status === 502
  );
}

/**
 * Returns true for network-level failures that indicate the server is
 * temporarily unreachable rather than returning a structured error response.
 * These should be treated identically to HTTP 502: show the connecting banner
 * and retry rather than surfacing a destructive toast.
 */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const msg = error.message;
  return (
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("network error") ||
    msg.includes("Load failed")
  );
}

// ─── Server-connectivity signal ───────────────────────────────────────────────
// Set to true when any query returns 502 or a network-level error; cleared
// when any query succeeds or the health-poll confirms the server is back.
// Drives useIsConnecting() so App.tsx can show a "Connecting…" banner.
let _isConnecting = false;
const _connectingListeners = new Set<() => void>();

// Listeners notified specifically on the transition connecting→false (i.e.
// the server just came back online).  Used by DatasetPanel to auto-resume
// in-flight chunked uploads.
const _reconnectListeners = new Set<() => void>();

function notifyConnecting(): void {
  _connectingListeners.forEach((fn) => fn());
}

function setIsConnecting(value: boolean): void {
  if (_isConnecting === value) return;
  const wasConnecting = _isConnecting;
  _isConnecting = value;
  notifyConnecting();

  if (value) {
    startHealthPoll();
  } else if (wasConnecting) {
    // Transition: connecting → connected — notify any upload resumption hooks.
    _reconnectListeners.forEach((fn) => fn());
  }
}

/**
 * Subscribe to the "server came back online" event. The callback fires once
 * each time the connectivity state transitions from connecting → reachable.
 * Returns an unsubscribe function.
 */
export function subscribeToReconnect(cb: () => void): () => void {
  _reconnectListeners.add(cb);
  return () => _reconnectListeners.delete(cb);
}

/**
 * Reactive hook: true while the server is unreachable (502 or network error)
 * and no successful query has returned yet. Resets to false once the health
 * poll confirms the server is up.
 */
export function useIsConnecting(): boolean {
  return useSyncExternalStore(
    (cb) => {
      _connectingListeners.add(cb);
      return () => _connectingListeners.delete(cb);
    },
    () => _isConnecting,
    () => false,
  );
}

/**
 * @deprecated Use useIsConnecting() instead.
 * Kept for backward-compatibility with existing callers (App.tsx).
 */
export function useHas502(): boolean {
  return useIsConnecting();
}

// ─── Health probe response-time tracking ──────────────────────────────────────
// Updated each time runHealthProbe completes (success or failure).
// null = no probe has run yet in this session.
let _lastHealthResponseMs: number | null = null;
const _healthResponseListeners = new Set<() => void>();

function setLastHealthResponseMs(ms: number): void {
  _lastHealthResponseMs = ms;
  _healthResponseListeners.forEach((fn) => fn());
}

/**
 * Reactive hook: returns the round-trip time (ms) of the most recent
 * /health probe, or null if no probe has run yet.
 * Intended for dev-only debug overlays.
 */
export function useHealthResponseTime(): number | null {
  return useSyncExternalStore(
    (cb) => {
      _healthResponseListeners.add(cb);
      return () => _healthResponseListeners.delete(cb);
    },
    () => _lastHealthResponseMs,
    () => null,
  );
}

// ─── Health poll ──────────────────────────────────────────────────────────────
// Polls GET /health (no auth required) with exponential back-off (1 s → 15 s
// max) whenever the server appears unreachable. Clears the connecting flag and
// cancels the poll as soon as the endpoint returns 200.

let _healthPollTimer: ReturnType<typeof setTimeout> | null = null;
let _healthPollAttempt = 0;

function startHealthPoll(): void {
  // Don't start a second poll if one is already running.
  if (_healthPollTimer !== null) return;
  _healthPollAttempt = 0;
  scheduleHealthPoll();
}

function scheduleHealthPoll(): void {
  const delay = Math.min(1_000 * 2 ** _healthPollAttempt, 15_000);
  _healthPollTimer = setTimeout(() => {
    _healthPollTimer = null;
    void runHealthProbe();
  }, delay);
}

async function runHealthProbe(): Promise<void> {
  const t0 = performance.now();
  try {
    const resp = await fetch("/health", {
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    setLastHealthResponseMs(Math.round(performance.now() - t0));
    if (resp.ok) {
      // Server is back — clear the connecting flag (which also notifies
      // reconnect subscribers and cancels further polling via setIsConnecting).
      setIsConnecting(false);
      return;
    }
  } catch {
    // Still unreachable — keep back-off going.
    setLastHealthResponseMs(Math.round(performance.now() - t0));
  }

  // Only schedule the next probe if we're still in connecting state.
  if (_isConnecting) {
    _healthPollAttempt++;
    scheduleHealthPoll();
  }
}

// ─── Error handlers ───────────────────────────────────────────────────────────

function handleQueryError(error: unknown) {
  // 401s fired before Clerk has attached a session token are transient —
  // the query will be re-enabled once auth resolves. Suppress the banner
  // so the user never sees a red "Unauthorized" flash on startup.
  if (is401(error)) return;

  // 502s during startup mean the API server is still warming up. Network
  // errors (TypeError: Failed to fetch / NetworkError) are also transient —
  // both indicate the server is temporarily unreachable. The connecting banner
  // (driven by useIsConnecting + useIsFetching in App.tsx) covers this case
  // visually, so we suppress the destructive toast. The flag clears when the
  // health poll confirms the server is back.
  if (is502(error) || isNetworkError(error)) {
    setIsConnecting(true);
    return;
  }

  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";
  toast({
    title: "Request failed",
    description: message,
    variant: "destructive",
  });
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleQueryError,
    onSuccess: () => {
      // Any successful query means the server is up — clear the connecting
      // flag so the banner can dismiss itself.
      setIsConnecting(false);
    },
  }),
  mutationCache: new MutationCache({
    onError: handleQueryError,
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Allow more retries for server-unreachable conditions (502 or network
        // error) than for other errors where retrying is unlikely to help.
        const limit = is502(error) || isNetworkError(error) ? 5 : 2;
        return failureCount < limit;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 15_000),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      networkMode: "offlineFirst",
    },
    mutations: {
      networkMode: "offlineFirst",
    },
  },
});
