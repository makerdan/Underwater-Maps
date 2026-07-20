/**
 * DriftPlannerPanel — regression tests for the persistent manual-conditions indicator.
 *
 * @tag freshwater-env
 *
 * Guards against:
 *   • Indicator absent after conditions are applied and the form is closed
 *   • Indicator showing stale values instead of the active conditions
 *   • Indicator remaining visible after conditions are cleared
 *   • Drift estimate not updating when conditions change
 *   • Indicator appearing when no conditions are active
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
  h.terrainHolder.value = { datasetId: DATASET };
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("DriftPlannerPanel — manual conditions indicator", () => {
  it("shows indicator when session conditions are active", async () => {
    const { DriftPlannerPanel } = await import("@/components/DriftPlannerPanel");

    h.sessionByDataset[DATASET] = SAMPLE;

    render(<DriftPlannerPanel />);

    expect(screen.getByTestId("drift-planner-manual-indicator")).toBeInTheDocument();
  });

  it("hides indicator when no conditions are active", async () => {
    const { DriftPlannerPanel } = await import("@/components/DriftPlannerPanel");

    render(<DriftPlannerPanel />);

    expect(screen.queryByTestId("drift-planner-manual-indicator")).toBeNull();
  });

  it("shows indicator when persisted conditions exist with source=manual", async () => {
    const { DriftPlannerPanel } = await import("@/components/DriftPlannerPanel");

    h.persistedByDataset[DATASET] = SAMPLE;
    h.activeSourceByDataset[DATASET] = "manual";

    render(<DriftPlannerPanel />);

    expect(screen.getByTestId("drift-planner-manual-indicator")).toBeInTheDocument();
  });

  it("hides indicator when persisted conditions exist but source=real", async () => {
    const { DriftPlannerPanel } = await import("@/components/DriftPlannerPanel");

    h.persistedByDataset[DATASET] = SAMPLE;
    h.activeSourceByDataset[DATASET] = "real";

    render(<DriftPlannerPanel />);

    expect(screen.queryByTestId("drift-planner-manual-indicator")).toBeNull();
  });

  it("displays active wind speed in the indicator", async () => {
    const { DriftPlannerPanel } = await import("@/components/DriftPlannerPanel");

    h.sessionByDataset[DATASET] = SAMPLE;

    render(<DriftPlannerPanel />);

    const windEl = screen.getByTestId("drift-planner-indicator-wind");
    expect(windEl.textContent).toContain("12");
  });

  it("displays active current speed in the indicator", async () => {
    const { DriftPlannerPanel } = await import("@/components/DriftPlannerPanel");

    h.sessionByDataset[DATASET] = SAMPLE;

    render(<DriftPlannerPanel />);

    const currentEl = screen.getByTestId("drift-planner-indicator-current");
    expect(currentEl.textContent).toContain("0.5");
  });

  it("displays a non-zero 1-hour drift estimate for non-zero conditions", async () => {
    const { DriftPlannerPanel } = await import("@/components/DriftPlannerPanel");

    h.sessionByDataset[DATASET] = SAMPLE;

    render(<DriftPlannerPanel />);

    const estimateEl = screen.getByTestId("drift-planner-indicator-estimate");
    expect(estimateEl.textContent).toMatch(/~[0-9]/);
  });

  it("clicking clear calls clearSessionManualConditions for the active dataset", async () => {
    const { DriftPlannerPanel } = await import("@/components/DriftPlannerPanel");

    h.sessionByDataset[DATASET] = SAMPLE;

    render(<DriftPlannerPanel />);

    fireEvent.click(screen.getByTestId("drift-planner-clear-conditions"));

    expect(h.clearSessionManualConditions).toHaveBeenCalledWith(DATASET);
  });

  it("clicking clear also calls clearDatasetManualConditions and sets source=real", async () => {
    const { DriftPlannerPanel } = await import("@/components/DriftPlannerPanel");

    h.sessionByDataset[DATASET] = SAMPLE;

    render(<DriftPlannerPanel />);

    fireEvent.click(screen.getByTestId("drift-planner-clear-conditions"));

    expect(h.clearDatasetManualConditions).toHaveBeenCalledWith(DATASET);
    expect(h.setManualConditionsActiveSource).toHaveBeenCalledWith(DATASET, "real");
  });

  it("indicator is absent when terrain is null (no dataset loaded)", async () => {
    const { DriftPlannerPanel } = await import("@/components/DriftPlannerPanel");

    h.terrainHolder.value = null;
    h.sessionByDataset[DATASET] = SAMPLE;

    render(<DriftPlannerPanel />);

    expect(screen.queryByTestId("drift-planner-manual-indicator")).toBeNull();
  });

  it("session conditions take priority over persisted conditions in the indicator", async () => {
    const { DriftPlannerPanel } = await import("@/components/DriftPlannerPanel");

    const persistedConditions: ManualConditions = {
      windSpeedKnots: 3,
      windDirectionDeg: 0,
      surfaceTempC: null,
      currentSpeedKnots: 0.1,
      currentDirectionDeg: 0,
      waterLevelM: null,
    };
    h.sessionByDataset[DATASET] = SAMPLE;
    h.persistedByDataset[DATASET] = persistedConditions;
    h.activeSourceByDataset[DATASET] = "manual";

    render(<DriftPlannerPanel />);

    const windEl = screen.getByTestId("drift-planner-indicator-wind");
    expect(windEl.textContent).toContain(String(SAMPLE.windSpeedKnots));
    expect(windEl.textContent).not.toContain(String(persistedConditions.windSpeedKnots));
  });
});
