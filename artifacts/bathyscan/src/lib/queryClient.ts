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

// ─── Server-warming signal ────────────────────────────────────────────────────
// Tracks whether any query has returned a 502 since the app loaded.
// Set to true on first 502; cleared when any query subsequently succeeds.
// Consumed by useHas502() so App.tsx can show a "Connecting…" banner instead
// of a destructive toast during the API server's startup window.
let _has502 = false;
const _has502Listeners = new Set<() => void>();

function setHas502(value: boolean): void {
  if (_has502 === value) return;
  _has502 = value;
  _has502Listeners.forEach((fn) => fn());
}

/**
 * Reactive hook that returns true when at least one query has returned 502
 * and no subsequent query has succeeded yet. Resets to false once the server
 * is back up and a query completes successfully.
 */
export function useHas502(): boolean {
  return useSyncExternalStore(
    (cb) => {
      _has502Listeners.add(cb);
      return () => _has502Listeners.delete(cb);
    },
    () => _has502,
    () => false,
  );
}

function handleQueryError(error: unknown) {
  // 401s fired before Clerk has attached a session token are transient —
  // the query will be re-enabled once auth resolves. Suppress the banner
  // so the user never sees a red "Unauthorized" flash on startup.
  if (is401(error)) return;

  // 502s during startup mean the API server is still warming up. The
  // connecting banner (driven by useHas502 + useIsFetching in App.tsx) covers
  // this case visually, so we suppress the destructive toast to avoid
  // alarming the user. The flag clears automatically once a query succeeds.
  if (is502(error)) {
    setHas502(true);
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
      // Any successful query means the server is up — clear the 502 flag so
      // the connecting banner can dismiss itself.
      setHas502(false);
    },
  }),
  mutationCache: new MutationCache({
    onError: handleQueryError,
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Allow more retries for 502 (server still starting up) than for
        // other errors where retrying is unlikely to help.
        const limit = is502(error) ? 5 : 2;
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
