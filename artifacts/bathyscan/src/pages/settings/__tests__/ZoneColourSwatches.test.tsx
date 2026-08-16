/**
 * ZoneColourSwatches unit tests (real zoneOverlayStore + settingsStore).
 *
 * Covers:
 *   - Missing/corrupted slots fall back to the store's canonical per-slot
 *     defaults (DEFAULT_SLOTS), not the old hardcoded slot-0 colour.
 *   - Slots are derived synchronously from the settings water type during
 *     render — no one-frame stale window that depends on the post-render
 *     activeWaterType sync effect.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { ZoneColourSwatches } from "../components/ZoneColourSwatches";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import {
  useZoneOverlayStore,
  DEFAULT_SLOTS,
  ZONE_DEFAULT_COLORS,
  type ZoneSlot,
} from "@/lib/zoneOverlayStore";

type SlotTuple = [ZoneSlot, ZoneSlot, ZoneSlot, ZoneSlot];

const fullDefaults = () => DEFAULT_SLOTS.map((s) => ({ ...s })) as SlotTuple;

// Preserve the real action so tests that stub it can restore it.
const originalSetActiveWaterType = useZoneOverlayStore.getState().setActiveWaterType;

beforeEach(() => {
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
  useZoneOverlayStore.setState({
    saltwater: fullDefaults(),
    freshwater: fullDefaults(),
    activeWaterType: "saltwater",
    slots: fullDefaults(),
  });
});

afterEach(() => {
  // Unmount before touching the store so the restore doesn't trigger a React
  // update outside act().
  cleanup();
  useZoneOverlayStore.setState({ setActiveWaterType: originalSetActiveWaterType });
});

describe("ZoneColourSwatches — missing slot defaults", () => {
  it("falls back to the store's canonical per-slot defaults, not slot 0's colour", () => {
    // Simulate corrupted/partial palette data: only 2 of 4 slots present.
    const partial = [
      { color: "#101010", visible: true },
      { color: "#202020", visible: false },
    ] as unknown as SlotTuple;
    useZoneOverlayStore.setState({
      saltwater: partial,
      slots: partial,
      activeWaterType: "saltwater",
    });

    render(<ZoneColourSwatches />);

    // Present slots render their stored colours.
    expect(
      (screen.getByTestId("settings-zone-colour-input-0") as HTMLInputElement).value.toLowerCase(),
    ).toBe("#101010");
    // Missing slots use their OWN default, not the old hardcoded #f5d58a
    // (which is slot 0's default and would mask the corruption).
    const input2 = screen.getByTestId("settings-zone-colour-input-2") as HTMLInputElement;
    const input3 = screen.getByTestId("settings-zone-colour-input-3") as HTMLInputElement;
    expect(input2.value.toLowerCase()).toBe(ZONE_DEFAULT_COLORS[2].toLowerCase());
    expect(input3.value.toLowerCase()).toBe(ZONE_DEFAULT_COLORS[3].toLowerCase());
    expect(input2.value.toLowerCase()).not.toBe("#f5d58a");
    expect(input3.value.toLowerCase()).not.toBe("#f5d58a");
  });

  it("missing slot visibility falls back to the per-slot default (visible)", () => {
    const partial = [{ color: "#101010", visible: false }] as unknown as SlotTuple;
    useZoneOverlayStore.setState({
      saltwater: partial,
      slots: partial,
      activeWaterType: "saltwater",
    });
    render(<ZoneColourSwatches />);
    // Slot 1 is missing → default visible:true → full opacity swatch.
    expect(screen.getByTestId("settings-zone-swatch-1")).toHaveStyle({ opacity: "1" });
    // Slot 0 is present with visible:false → dimmed swatch.
    expect(screen.getByTestId("settings-zone-swatch-0")).toHaveStyle({ opacity: "0.35" });
  });
});

describe("ZoneColourSwatches — synchronous water-type derivation", () => {
  it("renders the settings water type's slots even before the activeWaterType sync effect runs", () => {
    // Stub the sync action so the post-render effect CANNOT repair a stale
    // read — the old implementation (reading the `slots` mirror) would render
    // the saltwater colours here.
    useZoneOverlayStore.setState({ setActiveWaterType: vi.fn() });
    const fresh = fullDefaults();
    fresh[0] = { color: "#123456", visible: true };
    useZoneOverlayStore.setState({
      freshwater: fresh,
      activeWaterType: "saltwater",
      slots: fullDefaults(), // stale saltwater mirror
    });
    useSettingsStore.setState({ ...useSettingsStore.getState(), waterType: "freshwater" });

    render(<ZoneColourSwatches />);

    expect(
      (screen.getByTestId("settings-zone-colour-input-0") as HTMLInputElement).value.toLowerCase(),
    ).toBe("#123456");
    // Freshwater slot names confirm the label set matches the palette set.
    expect(
      screen.getByTitle("Click to change colour — Vegetation / Sandy Bed"),
    ).toBeInTheDocument();
  });

  it("keeps the zone store's activeWaterType in sync after render", () => {
    useSettingsStore.setState({ ...useSettingsStore.getState(), waterType: "freshwater" });
    render(<ZoneColourSwatches />);
    expect(useZoneOverlayStore.getState().activeWaterType).toBe("freshwater");
  });
});
