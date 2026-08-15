/**
 * GeneralSection water-type change → defaultMapLoad validation (Task:
 * settings data correctness).
 *
 * Covers:
 *   - Switching water type clears a preset defaultMapLoad that does not
 *     exist in the new type's preset list.
 *   - A preset that DOES exist in the new type's list is kept.
 *   - Upload-kind and null defaultMapLoad are never touched (and no preset
 *     fetch is made for them).
 *   - A failed preset fetch keeps the stored value.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { DefaultMapLoad } from "@/lib/settingsStore";

const h = vi.hoisted(() => {
  const data = {
    waterType: "saltwater" as "saltwater" | "freshwater",
    defaultMapLoad: null as { kind: "preset" | "upload"; id: string } | null,
  };
  const setWaterType = vi.fn((v: "saltwater" | "freshwater") => { data.waterType = v; });
  const setDefaultMapLoad = vi.fn((v: { kind: "preset" | "upload"; id: string } | null) => {
    data.defaultMapLoad = v;
  });
  const getDatasets = vi.fn();
  return { data, setWaterType, setDefaultMapLoad, getDatasets };
});

vi.mock("@workspace/api-client-react", () => ({
  getDatasets: h.getDatasets,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", vi.fn()],
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();

  const state = () => ({
    waterType: h.data.waterType,
    setWaterType: h.setWaterType,
    units: "metric" as const,
    setUnits: vi.fn(),
    depthUnit: "metres" as const,
    setDepthUnit: vi.fn(),
    temperatureUnit: "auto" as const,
    setTemperatureUnit: vi.fn(),
    defaultMapLoad: h.data.defaultMapLoad as DefaultMapLoad | null,
    setDefaultMapLoad: h.setDefaultMapLoad,
    defaultRegion: "" as const,
    setDefaultRegion: vi.fn(),
    hasSeenOnboarding: true,
    setHasSeenOnboarding: vi.fn(),
    syncedSnapshot: null,
    lastSyncedAt: null,
    resetSection: vi.fn(),
  });

  const useSettingsStore = Object.assign(
    <T,>(sel: (s: ReturnType<typeof state>) => T): T => sel(state()),
    {
      getState: () => state(),
      setState: vi.fn(),
      persist: { hasHydrated: () => true, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );

  return { ...actual, useSettingsStore };
});

vi.mock("@/components/DefaultMapLoadPicker", () => ({
  DefaultMapLoadPicker: () => <div data-testid="default-map-load-picker" />,
}));

vi.mock("@/pages/settings/components/SyncContext", () => ({
  SectionActionsRow: () => null,
}));

import { GeneralSection } from "../GeneralSection";

beforeEach(() => {
  h.setWaterType.mockClear();
  h.setDefaultMapLoad.mockClear();
  h.getDatasets.mockReset();
  h.data.waterType = "saltwater";
  h.data.defaultMapLoad = null;
});

describe("GeneralSection — water-type change validates defaultMapLoad", () => {
  it("clears a preset defaultMapLoad missing from the new type's preset list", async () => {
    h.data.defaultMapLoad = { kind: "preset", id: "sitka-sound" };
    h.getDatasets.mockResolvedValue([{ id: "lake-minnetonka" }, { id: "mille-lacs" }]);

    render(<GeneralSection />);
    fireEvent.click(screen.getByTestId("settings-water-type-freshwater"));

    expect(h.setWaterType).toHaveBeenCalledWith("freshwater");
    expect(h.getDatasets).toHaveBeenCalledWith({ waterType: "freshwater" });
    await waitFor(() => expect(h.setDefaultMapLoad).toHaveBeenCalledWith(null));
  });

  it("keeps a preset defaultMapLoad that exists in the new type's preset list", async () => {
    h.data.defaultMapLoad = { kind: "preset", id: "lake-minnetonka" };
    h.getDatasets.mockResolvedValue([{ id: "lake-minnetonka" }, { id: "mille-lacs" }]);

    render(<GeneralSection />);
    fireEvent.click(screen.getByTestId("settings-water-type-freshwater"));

    await waitFor(() => expect(h.getDatasets).toHaveBeenCalled());
    // Give the resolved promise a tick to run its .then handler.
    await Promise.resolve();
    expect(h.setDefaultMapLoad).not.toHaveBeenCalled();
  });

  it("does not fetch presets or touch an upload-kind defaultMapLoad", () => {
    h.data.defaultMapLoad = { kind: "upload", id: "my-upload" };

    render(<GeneralSection />);
    fireEvent.click(screen.getByTestId("settings-water-type-freshwater"));

    expect(h.setWaterType).toHaveBeenCalledWith("freshwater");
    expect(h.getDatasets).not.toHaveBeenCalled();
    expect(h.setDefaultMapLoad).not.toHaveBeenCalled();
  });

  it("does not fetch presets when defaultMapLoad is null", () => {
    render(<GeneralSection />);
    fireEvent.click(screen.getByTestId("settings-water-type-freshwater"));

    expect(h.getDatasets).not.toHaveBeenCalled();
    expect(h.setDefaultMapLoad).not.toHaveBeenCalled();
  });

  it("keeps the stored value when the preset fetch fails", async () => {
    h.data.defaultMapLoad = { kind: "preset", id: "sitka-sound" };
    h.getDatasets.mockRejectedValue(new Error("network down"));

    render(<GeneralSection />);
    fireEvent.click(screen.getByTestId("settings-water-type-freshwater"));

    await waitFor(() => expect(h.getDatasets).toHaveBeenCalled());
    await Promise.resolve();
    expect(h.setDefaultMapLoad).not.toHaveBeenCalled();
    expect(h.data.defaultMapLoad).toEqual({ kind: "preset", id: "sitka-sound" });
  });

  it("skips clearing when the user switches water type again before the fetch resolves", async () => {
    h.data.defaultMapLoad = { kind: "preset", id: "sitka-sound" };
    let resolveFetch: (v: Array<{ id: string }>) => void = () => {};
    h.getDatasets.mockImplementation(
      () => new Promise((res) => { resolveFetch = res; }),
    );

    render(<GeneralSection />);
    fireEvent.click(screen.getByTestId("settings-water-type-freshwater"));
    // User flips back before the freshwater preset list arrives.
    h.data.waterType = "saltwater";
    resolveFetch([{ id: "lake-minnetonka" }]);

    await Promise.resolve();
    await Promise.resolve();
    expect(h.setDefaultMapLoad).not.toHaveBeenCalled();
  });
});
