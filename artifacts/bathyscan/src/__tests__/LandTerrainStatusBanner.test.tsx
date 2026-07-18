import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LandTerrainStatusBanner } from "@/components/LandTerrainStatusBanner";
import { useLandTerrainStore } from "@/lib/landTerrainStore";

beforeEach(() => {
  useLandTerrainStore.getState().clear();
  // reset retryCount between tests
  useLandTerrainStore.setState({ retryCount: 0 });
});

describe("LandTerrainStatusBanner", () => {
  it("renders the loading pill when isLoading is true", () => {
    useLandTerrainStore.getState().setLoading(true);
    render(<LandTerrainStatusBanner />);
    const banner = screen.getByTestId("land-terrain-status-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("LOADING LAND TERRAIN");
  });

  it("renders the error pill when error is set", () => {
    useLandTerrainStore.getState().setError("fetch failed");
    render(<LandTerrainStatusBanner />);
    const banner = screen.getByTestId("land-terrain-status-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("Land terrain unavailable");
  });

  it("renders nothing when the land grid has loaded successfully (no loading, no error)", () => {
    render(<LandTerrainStatusBanner />);
    expect(screen.queryByTestId("land-terrain-status-banner")).not.toBeInTheDocument();
  });

  it("shows the loading text (not the error text) when isLoading is true even if error was previously set", () => {
    useLandTerrainStore.setState({ isLoading: true, error: "stale error" });
    render(<LandTerrainStatusBanner />);
    const banner = screen.getByTestId("land-terrain-status-banner");
    expect(banner).toHaveTextContent("LOADING LAND TERRAIN");
    expect(banner).not.toHaveTextContent("LAND TERRAIN UNAVAILABLE");
  });

  it("clears the banner after clear() is called", () => {
    useLandTerrainStore.getState().setError("some error");
    useLandTerrainStore.getState().clear();
    render(<LandTerrainStatusBanner />);
    expect(screen.queryByTestId("land-terrain-status-banner")).not.toBeInTheDocument();
  });

  // ── Retry button ──────────────────────────────────────────────────────────

  it("shows a Retry button in the error state", () => {
    useLandTerrainStore.getState().setError("network error");
    render(<LandTerrainStatusBanner />);
    expect(screen.getByTestId("land-terrain-retry-btn")).toBeInTheDocument();
    expect(screen.getByTestId("land-terrain-retry-btn")).toHaveTextContent("RETRY");
  });

  it("does not show a Retry button while loading", () => {
    useLandTerrainStore.getState().setLoading(true);
    render(<LandTerrainStatusBanner />);
    expect(screen.queryByTestId("land-terrain-retry-btn")).not.toBeInTheDocument();
  });

  it("clicking Retry calls the store retry() action and increments retryCount", () => {
    useLandTerrainStore.getState().setError("timeout");
    const retrySpy = vi.spyOn(useLandTerrainStore.getState(), "retry");

    render(<LandTerrainStatusBanner />);
    const btn = screen.getByTestId("land-terrain-retry-btn");
    fireEvent.click(btn);

    expect(retrySpy).toHaveBeenCalledTimes(1);
    expect(useLandTerrainStore.getState().retryCount).toBe(1);

    retrySpy.mockRestore();
  });

  it("clicking Retry clears the error in the store", () => {
    useLandTerrainStore.getState().setError("timeout");
    render(<LandTerrainStatusBanner />);

    fireEvent.click(screen.getByTestId("land-terrain-retry-btn"));

    expect(useLandTerrainStore.getState().error).toBeNull();
  });

  it("store retry() increments retryCount each time it is called", () => {
    // Verify the store contract independently of UI rendering: each retry()
    // call increments retryCount by 1.
    useLandTerrainStore.getState().retry();
    expect(useLandTerrainStore.getState().retryCount).toBe(1);

    useLandTerrainStore.getState().retry();
    expect(useLandTerrainStore.getState().retryCount).toBe(2);

    useLandTerrainStore.getState().retry();
    expect(useLandTerrainStore.getState().retryCount).toBe(3);
  });
});
