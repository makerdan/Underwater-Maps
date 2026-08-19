import { useOfflineStore } from "@/lib/offlineStore";

/** Delay (ms) before the single getToken() retry attempt. Exported for testing. */
export const GET_TOKEN_RETRY_DELAY_MS = 1_000;

/**
 * Attempts to obtain a Clerk session token. If the first call returns null,
 * one retry is made after `retryDelay` ms. If both calls return null,
 * `onExpired` is invoked (to fire the session-expired banner) and null is
 * returned.
 *
 * Keeping this retry policy outside App makes it independently testable without
 * loading the full application module graph.
 */
export async function getTokenWithRetry(
  getToken: () => Promise<string | null>,
  onExpired: () => void,
  retryDelay = GET_TOKEN_RETRY_DELAY_MS,
): Promise<string | null> {
  const token = await getToken();
  if (token !== null) return token;
  await new Promise<void>((resolve) => setTimeout(resolve, retryDelay));
  const retried = await getToken();
  if (retried !== null) return retried;
  // If the device is offline, a null token is expected — the Clerk SDK cannot
  // refresh without network access. Enter offline read-only mode instead of
  // showing the session-expired banner (reloading while offline does nothing).
  if (!useOfflineStore.getState().isOnline) {
    useOfflineStore.getState().setOfflineReadOnly(true);
    return null;
  }
  onExpired();
  return null;
}