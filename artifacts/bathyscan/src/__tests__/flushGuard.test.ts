/**
 * Tests for the `createFlushAllWithGuard` helper in `src/lib/offlineFlush.ts`.
 *
 * Verifies that the single-flight mutex prevents duplicate offline-buffer
 * flushes when the "online" event fires multiple times while a flush is
 * already in progress — the real production logic used by App.tsx.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createFlushAllWithGuard } from "@/lib/offlineFlush";

describe("createFlushAllWithGuard — isFlushing deduplication guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls each flush function exactly once when invoked twice during an in-progress flush", async () => {
    // Keep flushTrails unresolved so the second call arrives while the first
    // flush is still awaiting it (isFlushing.current === true).
    let resolveFlush!: () => void;
    const blockingPromise = new Promise<void>((resolve) => {
      resolveFlush = resolve;
    });

    const flushTrails = vi.fn().mockReturnValue(blockingPromise);
    const flushMarkers = vi.fn().mockResolvedValue(undefined);

    const flushAll = createFlushAllWithGuard(flushTrails, flushMarkers);

    // First call — flush begins but is still in progress.
    const first = flushAll();
    // Second call arrives immediately while the first is still awaiting flushTrails.
    const second = flushAll();

    // Allow the first flush to complete.
    resolveFlush();
    await first;
    await second;

    // Each underlying function must have been called exactly once.
    expect(flushTrails).toHaveBeenCalledOnce();
    expect(flushMarkers).toHaveBeenCalledOnce();
  });

  it("allows a subsequent flush after the first one fully completes", async () => {
    const flushTrails = vi.fn().mockResolvedValue(undefined);
    const flushMarkers = vi.fn().mockResolvedValue(undefined);

    const flushAll = createFlushAllWithGuard(flushTrails, flushMarkers);

    // First flush — completes fully.
    await flushAll();

    // Second flush — the guard resets after the first, so this must run.
    await flushAll();

    expect(flushTrails).toHaveBeenCalledTimes(2);
    expect(flushMarkers).toHaveBeenCalledTimes(2);
  });

  it("resets the guard after an error so subsequent flushes can proceed", async () => {
    const flushTrails = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue(undefined);
    const flushMarkers = vi.fn().mockResolvedValue(undefined);

    const flushAll = createFlushAllWithGuard(flushTrails, flushMarkers);

    // First flush throws — the finally block must still reset isFlushing.
    await expect(flushAll()).rejects.toThrow("network error");

    // Second flush must be allowed through (guard was reset in finally).
    await flushAll();

    expect(flushTrails).toHaveBeenCalledTimes(2);
    expect(flushMarkers).toHaveBeenCalledTimes(1); // only called on the 2nd success
  });
});
