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
 * Signal that the server appears unreachable (e.g. a manual health probe just
 * failed). Starts the background health poll so that when connectivity is
 * restored, the reconnect event fires and any subscribeToReconnect listeners
 * are notified automatically.
 *
 * Safe to call repeatedly: the poll ignores duplicate start requests.
 */
export function markServerUnreachable(): void {
  setIsConnecting(true);
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
// Polls GET /api/healthz (no auth required) with exponential back-off (1 s →
// 15 s max) whenever the server appears unreachable. Clears the connecting
// flag and cancels the poll as soon as the endpoint returns 200.
//
// The probe deliberately targets /api/healthz (not /health): only /api/* paths
// are routed to the API server by the Replit proxy in dev and by the
// deployment router in production. A root-relative /health would be answered
// by the frontend's SPA fallback with a misleading 200.

const HEALTH_PROBE_URL = "/api/healthz";
const HEALTH_PROBE_TIMEOUT_MS = 5_000;

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
    const resp = await fetch(HEALTH_PROBE_URL, {
      signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
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

// ─── Dev-only proactive health watch ─────────────────────────────────────────
// In development we want the "API server down" banner to appear within a few
// seconds even when no screen has fetched anything yet. This lightweight watch
// pings /api/healthz on a fixed interval while the server is believed healthy;
// on the first failure it flips the connecting flag, which hands over to the
// exponential back-off poll above (no double-polling: the watch skips its
// probe while _isConnecting is true).
//
// Called from main.tsx behind an `import.meta.env.DEV` gate so the interval —
// and this entire code path — never runs in production builds.

const DEV_HEALTH_WATCH_INTERVAL_MS = 5_000;

/**
 * Start the proactive dev health watch. Returns a stop function.
 * Safe to call once at app startup; the interval is suppressed while the
 * back-off poll is already running.
 */
export function startDevHealthWatch(
  intervalMs: number = DEV_HEALTH_WATCH_INTERVAL_MS,
): () => void {
  let probeInFlight = false;

  const probe = () => {
    if (_isConnecting || probeInFlight) return;
    probeInFlight = true;
    void (async () => {
      const t0 = performance.now();
      try {
        const resp = await fetch(HEALTH_PROBE_URL, {
          signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
          cache: "no-store",
        });
        setLastHealthResponseMs(Math.round(performance.now() - t0));
        if (!resp.ok) setIsConnecting(true);
      } catch {
        setLastHealthResponseMs(Math.round(performance.now() - t0));
        setIsConnecting(true);
      } finally {
        probeInFlight = false;
      }
    })();
  };

  // Fire one probe immediately so a dead server is detected right at page
  // load, not only after the first interval elapses.
  probe();
  const id = setInterval(probe, intervalMs);
  return () => clearInterval(id);
}

// ─── Session-expired signal ────────────────────────────────────────────────────
// Distinguishes startup 401s (Clerk not yet loaded — expected and suppressed)
// from post-load 401s (Clerk loaded, user nominally signed in, but the server
// keeps rejecting the token — the session has likely expired).
//
// setClerkLoaded(true) is called by ClerkAuthTokenWirer once a session object
// is available.  From that point, consecutive 401s are counted; reaching the
// threshold fires signalSessionExpired() and shows the session-expired banner.

let _clerkLoaded = false;
let _consecutive401Count = 0;
const SESSION_EXPIRED_401_THRESHOLD = 3;
let _isSessionExpired = false;
const _sessionExpiredListeners = new Set<() => void>();

/**
 * Called by ClerkAuthTokenWirer when a session is attached (`loaded=true`) or
 * cleared (`loaded=false`).  Resets the consecutive-401 counter on detach so
 * a page reload doesn't inherit stale count.
 */
export function setClerkLoaded(loaded: boolean): void {
  _clerkLoaded = loaded;
  if (!loaded) _consecutive401Count = 0;
}

/**
 * Directly fire the session-expired signal.  Idempotent — only the first call
 * notifies listeners.  Used by ClerkAuthTokenWirer when `getToken()` returns
 * null twice in a row (token-refresh failure path).
 */
export function signalSessionExpired(): void {
  if (_isSessionExpired) return;
  _isSessionExpired = true;
  _sessionExpiredListeners.forEach((fn) => fn());
}

/**
 * Subscribe to the session-expired event.  The callback fires at most once per
 * page lifetime (the signal is not reset).  Returns an unsubscribe function.
 */
export function subscribeToSessionExpired(cb: () => void): () => void {
  _sessionExpiredListeners.add(cb);
  return () => _sessionExpiredListeners.delete(cb);
}

/**
 * Reactive hook: true once the session is detected as expired (persistent
 * post-load 401s or getToken() consistently returning null).
 * Stays true for the lifetime of the page — the user must reload.
 */
export function useIsSessionExpired(): boolean {
  return useSyncExternalStore(
    (cb) => {
      _sessionExpiredListeners.add(cb);
      return () => _sessionExpiredListeners.delete(cb);
    },
    () => _isSessionExpired,
    () => false,
  );
}

// ─── Error handlers ───────────────────────────────────────────────────────────

function handleQueryError(error: unknown) {
  // 401s: behaviour depends on whether Clerk has fully loaded yet.
  // Before load → transient startup 401, suppress silently (the query will
  // be re-enabled once auth resolves). After load → count consecutive 401s;
  // reaching the threshold means the session has expired.
  if (is401(error)) {
    if (_clerkLoaded) {
      _consecutive401Count++;
      if (_consecutive401Count >= SESSION_EXPIRED_401_THRESHOLD) {
        signalSessionExpired();
      }
    }
    return;
  }

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
      // flag so the banner can dismiss itself.  Also reset the consecutive-401
      // counter so a brief auth blip doesn't permanently trip the session-
      // expired threshold.
      _consecutive401Count = 0;
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
