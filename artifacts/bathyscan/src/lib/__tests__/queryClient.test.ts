/**
 * Tests that the global QueryCache / MutationCache onError handler surfaces
 * API failures to the user via toast instead of failing silently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Stable toast spy ──────────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file, so the spy must also
// be declared with vi.hoisted() to avoid "Cannot access before initialization".
const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
}));

// Import after the mock is registered (vi.mock is hoisted, so this is safe).
import { queryClient } from "@/lib/queryClient";

describe("queryClient — global onError toast", () => {
  beforeEach(() => {
    mockToast.mockReset();
  });

  it("calls toast with the error message when queryCache.onError fires with an Error", () => {
    const cache = queryClient.getQueryCache();
    // Access the onError callback registered on QueryCache
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cache as any).config.onError(new Error("Network failure"));

    expect(mockToast).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Request failed",
        description: "Network failure",
        variant: "destructive",
      }),
    );
  });

  it("falls back to a generic message when the thrown value is not an Error instance", () => {
    const cache = queryClient.getQueryCache();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cache as any).config.onError("something bad happened");

    expect(mockToast).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "An unexpected error occurred.",
        variant: "destructive",
      }),
    );
  });

  it("calls toast with the error message when mutationCache.onError fires with an Error", () => {
    const cache = queryClient.getMutationCache();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cache as any).config.onError(new Error("Mutation error"));

    expect(mockToast).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Request failed",
        description: "Mutation error",
        variant: "destructive",
      }),
    );
  });
});
