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

function handleQueryError(error: unknown) {
  // 401s fired before Clerk has attached a session token are transient —
  // the query will be re-enabled once auth resolves. Suppress the banner
  // so the user never sees a red "Unauthorized" flash on startup.
  if (is401(error)) return;

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
  }),
  mutationCache: new MutationCache({
    onError: handleQueryError,
  }),
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10_000),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      networkMode: "offlineFirst",
    },
    mutations: {
      networkMode: "offlineFirst",
    },
  },
});
