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
});

describe("ThrottlePanel — unit-aware text", () => {
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
