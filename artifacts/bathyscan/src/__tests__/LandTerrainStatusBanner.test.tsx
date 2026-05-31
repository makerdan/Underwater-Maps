import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandTerrainStatusBanner } from "@/components/LandTerrainStatusBanner";
import { useLandTerrainStore } from "@/lib/landTerrainStore";

beforeEach(() => {
  useLandTerrainStore.getState().clear();
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
    expect(banner).toHaveTextContent("LAND TERRAIN UNAVAILABLE");
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
});
