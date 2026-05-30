import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

function handleQueryError(error: unknown) {
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
