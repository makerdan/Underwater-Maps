/**
 * useRawsWeather — offline fallback branch tests.
 *
 * RAWS are forest weather stations not included in the env pack.
 * When offline the hook should return unavailable (null, no error) rather
 * than a network error, and should not call fetch.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("idb-keyval", () => ({
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
}));

import { useOfflineStore } from "@/lib/offlineStore";
import { useRawsWeather } from "../useRawsWeather";

function resetStores() {
  useOfflineStore.setState({ isOnline: true });
}

describe("useRawsWeather offline fallback", () => {
  beforeEach(() => {
    resetStores();
    global.fetch = vi.fn();
  });

  it("returns null observation without error when offline", () => {
    act(() => useOfflineStore.setState({ isOnline: false }));

    const { result } = renderHook(() => useRawsWeather("dataset-123", true));

    expect(result.current.observation).toBeNull();
    expect(result.current.isError).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isCachedPack).toBe(false);
  });

  it("does NOT call fetch when offline", () => {
    act(() => useOfflineStore.setState({ isOnline: false }));

    renderHook(() => useRawsWeather("dataset-123", true));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls fetch when online (normal path)", () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ available: false }),
    });

    act(() => useOfflineStore.setState({ isOnline: true }));

    renderHook(() => useRawsWeather("dataset-123", true));

    expect(global.fetch).toHaveBeenCalled();
  });

  it("resets when not enabled regardless of online state", () => {
    act(() => useOfflineStore.setState({ isOnline: false }));

    const { result } = renderHook(() => useRawsWeather("dataset-123", false));

    expect(result.current.observation).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
  });
});
