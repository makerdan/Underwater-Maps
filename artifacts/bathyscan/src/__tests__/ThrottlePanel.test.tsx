/**
 * ThrottlePanel — unit-aware text rendering.
 *
 * Verifies that the throttle panel honours the user's `units` preference
 * across every piece of text it renders (tick labels, numeric input value,
 * unit suffix) and that typing a value in km/h commits the correct
 * underlying mph value to the app state.
 */
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { ThrottlePanel } from "@/components/ThrottlePanel";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { useDriveBoatStore } from "@/lib/driveBoatStore";
import { AppProvider, useAppState } from "@/lib/context";
import { MPH_TO_KPH } from "@/lib/units";
import { TooltipProvider } from "@/components/ui/tooltip";

function MphProbe({ onMph }: { onMph: (mph: number) => void }) {
  const { boatSpeedMph } = useAppState();
  React.useEffect(() => { onMph(boatSpeedMph); }, [boatSpeedMph, onMph]);
  return null;
}

function renderWithState(initialMph: number) {
  try { localStorage.setItem("bathyscan:boatSpeedMph", String(initialMph)); } catch { /* ignore */ }
  // driveBoatStore reads localStorage only at module-init time, so we must
  // also update the store directly to make the value visible immediately.
  useDriveBoatStore.getState().setBoatSpeedMph(initialMph);
  let latest = initialMph;
  const result = render(
    <TooltipProvider>
      <AppProvider>
        <ThrottlePanel />
        <MphProbe onMph={(v) => { latest = v; }} />
      </AppProvider>
    </TooltipProvider>,
  );
  return { ...result, getMph: () => latest };
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
  // driveBoatStore is module-level and persists across tests; reset it so
  // boatSpeedMph committed in one test cannot leak into the next.
  useDriveBoatStore.getState().resetForSignOut();
});

describe("ThrottlePanel — unit-aware text", () => {
  it("starts a new Drive Boat session at the 22 mph default when no preference exists", () => {
    useSettingsStore.getState().setUnits("imperial");
    useDriveBoatStore.getState().resetForSignOut();
    render(
      <TooltipProvider>
        <AppProvider>
          <ThrottlePanel />
        </AppProvider>
      </TooltipProvider>,
    );

    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("22");
  });

  it("persists and respects an explicitly selected boat speed", () => {
    useSettingsStore.getState().setUnits("imperial");
    useDriveBoatStore.getState().setBoatSpeedMph(31);
    render(
      <TooltipProvider>
        <AppProvider>
          <ThrottlePanel />
        </AppProvider>
      </TooltipProvider>,
    );

    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("31");
    expect(localStorage.getItem("bathyscan:boatSpeedMph")).toBe("31");
  });

  it("shows km/h suffix and converted tick labels in metric mode", () => {
    useSettingsStore.getState().setUnits("metric");
    renderWithState(15);

    expect(screen.getByText("km/h")).toBeTruthy();
    // 55 mph → 89 km/h (rounded), 3 mph → 5 km/h.
    expect(screen.getByText(String(Math.round(55 * MPH_TO_KPH)))).toBeTruthy();
    expect(screen.getByText(String(Math.round(3 * MPH_TO_KPH)))).toBeTruthy();

    expect(
      (screen.getByRole("spinbutton") as HTMLInputElement).value,
    ).toBe(String(Math.round(15 * MPH_TO_KPH * 10) / 10));
  });

  it("shows mph suffix and raw mph tick labels in imperial mode", () => {
    useSettingsStore.getState().setUnits("imperial");
    renderWithState(15);

    expect(screen.getByText("mph")).toBeTruthy();
    expect(screen.getByText("55")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("15");
  });

  it("commits typed km/h values back to the underlying mph state", () => {
    useSettingsStore.getState().setUnits("metric");
    const { getMph } = renderWithState(15);

    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "32" } });
    fireEvent.blur(input);

    // 32 km/h → ~19.9 mph (rounded to a tenth).
    const expectedMph = Math.round((32 / MPH_TO_KPH) * 10) / 10;
    expect(getMph()).toBeCloseTo(expectedMph, 1);
  });

  it("re-syncs the input when the units preference flips live", () => {
    useSettingsStore.getState().setUnits("imperial");
    renderWithState(15);

    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("15");

    act(() => {
      useSettingsStore.getState().setUnits("metric");
    });

    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe(
      String(Math.round(15 * MPH_TO_KPH * 10) / 10),
    );
    expect(screen.getByText("km/h")).toBeTruthy();
  });
});
