/**
 * Component tests for CoordinateSearchForm — the manual coordinate + radius
 * search form in the Find Data panel's Search tab.
 *
 * Covers:
 * - Valid submit queues a pendingCoordSearch on uiStore (radius converted to
 *   km), opens the Overview Map, persists the radius, and calls onSubmitted.
 * - Invalid coordinates show the inline coord error and nothing is queued.
 * - Invalid radius shows the inline radius error and nothing is queued.
 * - Radius unit toggle persists via settingsStore and converts nmi → km.
 * - GPS fill: immediate fill when a fix exists; waiting → fill when a fix
 *   arrives; permission-denied error surfaces in the inline GPS message.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// Reactive zustand-backed settingsStore mock. Includes persist/setState so
// modules that touch useSettingsStore.persist at init don't crash.
vi.mock("@/lib/settingsStore", async () => {
  const { create } = await import("zustand");
  interface S {
    coordSearchRadius: number;
    coordSearchRadiusUnit: "km" | "nmi";
    setCoordSearchRadius: (v: number) => void;
    setCoordSearchRadiusUnit: (u: "km" | "nmi") => void;
  }
  const useSettingsStore = create<S>((set) => ({
    coordSearchRadius: 10,
    coordSearchRadiusUnit: "km",
    setCoordSearchRadius: (v) => set({ coordSearchRadius: v }),
    setCoordSearchRadiusUnit: (u) => set({ coordSearchRadiusUnit: u }),
  }));
  Object.assign(useSettingsStore, {
    persist: {
      hasHydrated: () => true,
      onFinishHydration: () => () => {},
    },
  });
  return { useSettingsStore };
});

vi.mock("@/lib/uiStore", async () => {
  const { create } = await import("zustand");
  interface U {
    pendingCoordSearch:
      | { lat: number; lon: number; radiusKm: number }
      | null;
    overviewOpen: boolean;
    setPendingCoordSearch: (r: U["pendingCoordSearch"]) => void;
    setOverviewOpen: (b: boolean) => void;
  }
  const useUiStore = create<U>((set) => ({
    pendingCoordSearch: null,
    overviewOpen: false,
    setPendingCoordSearch: (r) => set({ pendingCoordSearch: r }),
    setOverviewOpen: (b) => set({ overviewOpen: b }),
  }));
  return { useUiStore };
});

vi.mock("@/lib/gpsStore", async () => {
  const { create } = await import("zustand");
  interface G {
    position: { latitude: number; longitude: number; accuracy: number; timestamp: number } | null;
    error: string | null;
    startWatching: () => void;
  }
  const useGpsStore = create<G>(() => ({
    position: null,
    error: null,
    startWatching: vi.fn(),
  }));
  return { useGpsStore };
});

import { CoordinateSearchForm } from "../CoordinateSearchForm";
import { useUiStore } from "@/lib/uiStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useGpsStore } from "@/lib/gpsStore";

beforeEach(() => {
  useUiStore.setState({ pendingCoordSearch: null, overviewOpen: false });
  useSettingsStore.setState({ coordSearchRadius: 10, coordSearchRadiusUnit: "km" });
  useGpsStore.setState({ position: null, error: null, startWatching: vi.fn() });
});

function fillAndSubmit(coords: string, radius?: string) {
  fireEvent.change(screen.getByTestId("coord-search-input"), {
    target: { value: coords },
  });
  if (radius !== undefined) {
    fireEvent.change(screen.getByTestId("coord-search-radius"), {
      target: { value: radius },
    });
  }
  fireEvent.click(screen.getByTestId("coord-search-submit"));
}

describe("CoordinateSearchForm — submit", () => {
  it("queues a coordinate search and opens the Overview Map on valid submit", () => {
    const onSubmitted = vi.fn();
    render(<CoordinateSearchForm onSubmitted={onSubmitted} />);
    fillAndSubmit("55.7, -132.45", "10");

    const state = useUiStore.getState();
    expect(state.pendingCoordSearch).toEqual({ lat: 55.7, lon: -132.45, radiusKm: 10 });
    expect(state.overviewOpen).toBe(true);
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    // Radius value persisted to settings.
    expect(useSettingsStore.getState().coordSearchRadius).toBe(10);
    expect(screen.queryByTestId("coord-search-coord-error")).toBeNull();
    expect(screen.queryByTestId("coord-search-radius-error")).toBeNull();
  });

  it("accepts DMS input with hemisphere suffixes", () => {
    render(<CoordinateSearchForm />);
    fillAndSubmit(`58°18'4.5"N 134°25'11.2"W`, "5");
    const pending = useUiStore.getState().pendingCoordSearch;
    expect(pending).not.toBeNull();
    expect(pending!.lat).toBeCloseTo(58 + 18 / 60 + 4.5 / 3600, 5);
    expect(pending!.lon).toBeCloseTo(-(134 + 25 / 60 + 11.2 / 3600), 5);
  });

  it("shows an inline error and queues nothing for malformed coordinates", () => {
    const onSubmitted = vi.fn();
    render(<CoordinateSearchForm onSubmitted={onSubmitted} />);
    fillAndSubmit("not coordinates", "10");

    expect(screen.getByTestId("coord-search-coord-error")).toBeInTheDocument();
    expect(useUiStore.getState().pendingCoordSearch).toBeNull();
    expect(useUiStore.getState().overviewOpen).toBe(false);
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("clears the coord error as soon as the input changes", () => {
    render(<CoordinateSearchForm />);
    fillAndSubmit("garbage", "10");
    expect(screen.getByTestId("coord-search-coord-error")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("coord-search-input"), {
      target: { value: "55.7, -132.45" },
    });
    expect(screen.queryByTestId("coord-search-coord-error")).toBeNull();
  });

  it("shows an inline error for an invalid radius and queues nothing", () => {
    render(<CoordinateSearchForm />);
    fillAndSubmit("55.7, -132.45", "0");
    expect(screen.getByTestId("coord-search-radius-error")).toHaveTextContent(
      /greater than zero/,
    );
    expect(useUiStore.getState().pendingCoordSearch).toBeNull();
  });

  it("rejects a radius above the server cap with a user-visible message", () => {
    render(<CoordinateSearchForm />);
    fillAndSubmit("55.7, -132.45", "99999");
    expect(screen.getByTestId("coord-search-radius-error")).toHaveTextContent(/too large/);
    expect(useUiStore.getState().pendingCoordSearch).toBeNull();
  });
});

describe("CoordinateSearchForm — radius unit persistence & conversion", () => {
  it("unit toggle persists to settingsStore and reflects aria-pressed", () => {
    render(<CoordinateSearchForm />);
    const nmiBtn = screen.getByTestId("coord-search-unit-nmi");
    const kmBtn = screen.getByTestId("coord-search-unit-km");
    expect(kmBtn).toHaveAttribute("aria-pressed", "true");
    expect(nmiBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(nmiBtn);
    expect(useSettingsStore.getState().coordSearchRadiusUnit).toBe("nmi");
    expect(nmiBtn).toHaveAttribute("aria-pressed", "true");
    expect(kmBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("submits nmi radii converted to km (1 nmi = 1.852 km)", () => {
    render(<CoordinateSearchForm />);
    fireEvent.click(screen.getByTestId("coord-search-unit-nmi"));
    fillAndSubmit("55.7, -132.45", "10");
    const pending = useUiStore.getState().pendingCoordSearch;
    expect(pending!.radiusKm).toBeCloseTo(18.52, 10);
    // The raw value (in the chosen unit) is what gets persisted.
    expect(useSettingsStore.getState().coordSearchRadius).toBe(10);
    expect(useSettingsStore.getState().coordSearchRadiusUnit).toBe("nmi");
  });

  it("round-trips: a persisted unit is picked up on next mount", () => {
    useSettingsStore.setState({ coordSearchRadius: 3, coordSearchRadiusUnit: "nmi" });
    render(<CoordinateSearchForm />);
    expect(screen.getByTestId("coord-search-unit-nmi")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("coord-search-radius")).toHaveValue("3");
  });
});

describe("CoordinateSearchForm — GPS fill", () => {
  it("fills immediately when a GPS fix already exists", () => {
    useGpsStore.setState({
      position: { latitude: 55.123456, longitude: -132.654321, accuracy: 5, timestamp: 0, speed: null, heading: null },
    });
    render(<CoordinateSearchForm />);
    fireEvent.click(screen.getByTestId("coord-search-gps-fill"));
    expect(screen.getByTestId("coord-search-input")).toHaveValue(
      "55.123456, -132.654321",
    );
    expect(screen.queryByTestId("coord-search-gps-message")).toBeNull();
  });

  it("starts watching and fills when a fix arrives", () => {
    const startWatching = vi.fn();
    useGpsStore.setState({ startWatching });
    render(<CoordinateSearchForm />);
    fireEvent.click(screen.getByTestId("coord-search-gps-fill"));
    expect(startWatching).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("coord-search-gps-message")).toHaveTextContent(
      /Waiting for a GPS fix/,
    );

    act(() => {
      useGpsStore.setState({ position: { latitude: 58.3, longitude: -134.42, accuracy: 5, timestamp: 0, speed: null, heading: null } });
    });
    expect(screen.getByTestId("coord-search-input")).toHaveValue(
      "58.300000, -134.420000",
    );
    expect(screen.queryByTestId("coord-search-gps-message")).toBeNull();
  });

  it("surfaces a permission-denied error in the GPS message", () => {
    render(<CoordinateSearchForm />);
    fireEvent.click(screen.getByTestId("coord-search-gps-fill"));
    act(() => {
      useGpsStore.setState({
        error: "GPS permission denied. Enable location access for this site.",
      });
    });
    expect(screen.getByTestId("coord-search-gps-message")).toHaveTextContent(
      /permission denied/i,
    );
    // Input untouched.
    expect(screen.getByTestId("coord-search-input")).toHaveValue("");
  });
});
