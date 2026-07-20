/**
 * ManualConditionsChip — regression tests for the persistent sidebar chip.
 *
 * @tag freshwater-env
 *
 * Guards against:
 *   • Users losing awareness that manual conditions are still overriding live
 *     data while the Drift Planner section / Plan tab is not open — the chip
 *     must render from any tab whenever conditions are active.
 *   • Chip missing when only persisted (source=manual) conditions are active
 *   • Chip visible when persisted conditions exist but source=real
 *   • Jump button not switching the sidebar to the Plan tab
 *   • Clear button not fully clearing session + persisted + active source
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ManualConditions } from "@/lib/settingsStore";

// ── vi.hoisted: mutable state readable before mock factories execute ──────────

const h = vi.hoisted(() => {
  const sessionByDataset: Record<string, ManualConditions | undefined> = {};
  const persistedByDataset: Record<string, ManualConditions | undefined> = {};
  const activeSourceByDataset: Record<string, "real" | "manual"> = {};
  const clearSessionManualConditions = vi.fn();
  const clearDatasetManualConditions = vi.fn();
  const setManualConditionsActiveSource = vi.fn();
  const setSidebarMode = vi.fn();
  const terrainHolder: { value: { datasetId: string } | null } = {
    value: { datasetId: "fw-test-lake" },
  };
  return {
    sessionByDataset,
    persistedByDataset,
    activeSourceByDataset,
    clearSessionManualConditions,
    clearDatasetManualConditions,
    setManualConditionsActiveSource,
    setSidebarMode,
    terrainHolder,
  };
});

// ── Mock @/lib/context ─────────────────────────────────────────────────────────

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: h.terrainHolder.value }),
}));

// ── Mock uiStore ───────────────────────────────────────────────────────────────

vi.mock("@/lib/uiStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/uiStore")>();
  const storeState = () => ({
    sessionManualConditions: h.sessionByDataset as Record<string, ManualConditions>,
    clearSessionManualConditions: h.clearSessionManualConditions,
    setSidebarMode: h.setSidebarMode,
  });
  const useUiStore = Object.assign(
    (sel: (s: ReturnType<typeof storeState>) => unknown) => sel(storeState()),
    {
      getState: storeState,
      setState: vi.fn(),
      subscribe: () => () => {},
    },
  );
  return { ...actual, useUiStore };
});

// ── Mock settingsStore ─────────────────────────────────────────────────────────

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const storeState = () => ({
    datasetManualConditions: h.persistedByDataset as Record<string, ManualConditions>,
    manualConditionsActiveSource: h.activeSourceByDataset as Record<string, "real" | "manual">,
    clearDatasetManualConditions: h.clearDatasetManualConditions,
    setManualConditionsActiveSource: h.setManualConditionsActiveSource,
  });
  const useSettingsStore = Object.assign(
    (sel: (s: ReturnType<typeof storeState>) => unknown) => sel(storeState()),
    {
      getState: storeState,
      setState: vi.fn(),
      subscribe: () => () => {},
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
    },
  );
  return { ...actual, useSettingsStore };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const SAMPLE: ManualConditions = {
  windSpeedKnots: 12,
  windDirectionDeg: 270,
  surfaceTempC: null,
  currentSpeedKnots: 0.5,
  currentDirectionDeg: 90,
  waterLevelM: null,
};

const DATASET = "fw-test-lake";

beforeEach(() => {
  for (const k of Object.keys(h.sessionByDataset)) delete h.sessionByDataset[k];
  for (const k of Object.keys(h.persistedByDataset)) delete h.persistedByDataset[k];
  for (const k of Object.keys(h.activeSourceByDataset)) delete h.activeSourceByDataset[k];
  h.clearSessionManualConditions.mockClear();
  h.clearDatasetManualConditions.mockClear();
  h.setManualConditionsActiveSource.mockClear();
  h.setSidebarMode.mockClear();
  h.terrainHolder.value = { datasetId: DATASET };
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("ManualConditionsChip — persistent sidebar indicator", () => {
  it("renders when session conditions are active (Drift Planner section not open)", async () => {
    const { ManualConditionsChip } = await import("@/components/ManualConditionsChip");

    h.sessionByDataset[DATASET] = SAMPLE;

    // Note: the chip is rendered directly under the sidebar mode tabs in
    // App.tsx, entirely outside the Plan-tab Drift & Route section — this
    // render has no DriftPlannerPanel/WeatherPanel mounted at all.
    render(<ManualConditionsChip />);

    expect(screen.getByTestId("manual-conditions-chip")).toBeInTheDocument();
  });

  it("renders when persisted conditions exist with source=manual", async () => {
    const { ManualConditionsChip } = await import("@/components/ManualConditionsChip");

    h.persistedByDataset[DATASET] = SAMPLE;
    h.activeSourceByDataset[DATASET] = "manual";

    render(<ManualConditionsChip />);

    expect(screen.getByTestId("manual-conditions-chip")).toBeInTheDocument();
  });

  it("hidden when no conditions are active", async () => {
    const { ManualConditionsChip } = await import("@/components/ManualConditionsChip");

    render(<ManualConditionsChip />);

    expect(screen.queryByTestId("manual-conditions-chip")).toBeNull();
  });

  it("hidden when persisted conditions exist but source=real", async () => {
    const { ManualConditionsChip } = await import("@/components/ManualConditionsChip");

    h.persistedByDataset[DATASET] = SAMPLE;
    h.activeSourceByDataset[DATASET] = "real";

    render(<ManualConditionsChip />);

    expect(screen.queryByTestId("manual-conditions-chip")).toBeNull();
  });

  it("hidden when terrain is null (no dataset loaded)", async () => {
    const { ManualConditionsChip } = await import("@/components/ManualConditionsChip");

    h.terrainHolder.value = null;
    h.sessionByDataset[DATASET] = SAMPLE;

    render(<ManualConditionsChip />);

    expect(screen.queryByTestId("manual-conditions-chip")).toBeNull();
  });

  it("clicking the chip body jumps to the Plan tab", async () => {
    const { ManualConditionsChip } = await import("@/components/ManualConditionsChip");

    h.sessionByDataset[DATASET] = SAMPLE;

    render(<ManualConditionsChip />);

    fireEvent.click(screen.getByTestId("manual-conditions-chip-jump"));

    expect(h.setSidebarMode).toHaveBeenCalledWith("plan");
  });

  it("clicking clear removes session + persisted conditions and resets source", async () => {
    const { ManualConditionsChip } = await import("@/components/ManualConditionsChip");

    h.sessionByDataset[DATASET] = SAMPLE;

    render(<ManualConditionsChip />);

    fireEvent.click(screen.getByTestId("manual-conditions-chip-clear"));

    expect(h.clearSessionManualConditions).toHaveBeenCalledWith(DATASET);
    expect(h.clearDatasetManualConditions).toHaveBeenCalledWith(DATASET);
    expect(h.setManualConditionsActiveSource).toHaveBeenCalledWith(DATASET, "real");
  });
});
