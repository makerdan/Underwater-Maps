/**
 * ManualConditionsForm — drift preview regression tests.
 *
 * @tag freshwater-env
 *
 * Verifies:
 *   1. The drift preview box is visible when the form is open.
 *   2. Changing wind speed updates the preview value.
 *   3. Changing current speed updates the preview value.
 *   4. computeManualDriftPreview pure function returns correct structure.
 *   5. Zero wind + zero current yields near-zero drift distance.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ManualConditions } from "@/lib/settingsStore";

// ── vi.hoisted: mutable state readable before mock factories execute ──────────

const h = vi.hoisted(() => {
  const persistedByDataset: Record<string, ManualConditions | undefined> = {};
  const sessionByDataset: Record<string, ManualConditions | undefined> = {};
  const setDatasetManualConditions = vi.fn();
  const setSessionManualConditions = vi.fn();
  return { persistedByDataset, sessionByDataset, setDatasetManualConditions, setSessionManualConditions };
});

// ── Mock settingsStore ─────────────────────────────────────────────────────────

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const storeState = () => ({
    units: "nautical" as const,
    datasetManualConditions: h.persistedByDataset as Record<string, ManualConditions>,
    setDatasetManualConditions: h.setDatasetManualConditions,
    clearDatasetManualConditions: vi.fn(),
    manualConditionsActiveSource: {},
    setManualConditionsActiveSource: vi.fn(),
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

// ── Mock uiStore ───────────────────────────────────────────────────────────────

vi.mock("@/lib/uiStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/uiStore")>();
  const storeState = () => ({
    sessionManualConditions: h.sessionByDataset as Record<string, ManualConditions>,
    setSessionManualConditions: h.setSessionManualConditions,
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("ManualConditionsForm — drift preview UI", () => {
  beforeEach(() => {
    for (const k of Object.keys(h.persistedByDataset)) delete h.persistedByDataset[k];
    for (const k of Object.keys(h.sessionByDataset)) delete h.sessionByDataset[k];
    h.setDatasetManualConditions.mockClear();
    h.setSessionManualConditions.mockClear();
  });

  it("renders the drift preview box when the form is visible", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    render(<ManualConditionsForm datasetId="lake-preview" />);

    expect(screen.getByTestId("manual-conditions-drift-preview")).toBeInTheDocument();
  });

  it("preview value updates when wind speed input changes", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    render(<ManualConditionsForm datasetId="lake-preview" />);

    const previewEl = screen.getByTestId("manual-conditions-drift-preview-value");
    const initialText = previewEl.textContent ?? "";

    const windInput = screen.getByTestId("manual-conditions-wind-speed");
    fireEvent.change(windInput, { target: { value: "40" } });

    const updatedText = screen.getByTestId("manual-conditions-drift-preview-value").textContent ?? "";
    expect(updatedText).not.toBe(initialText);
  });

  it("preview value updates when current speed input changes", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    render(<ManualConditionsForm datasetId="lake-preview" />);

    const previewEl = screen.getByTestId("manual-conditions-drift-preview-value");
    const initialText = previewEl.textContent ?? "";

    const currentInput = screen.getByTestId("manual-conditions-current-speed");
    fireEvent.change(currentInput, { target: { value: "5" } });

    const updatedText = screen.getByTestId("manual-conditions-drift-preview-value").textContent ?? "";
    expect(updatedText).not.toBe(initialText);
  });

  it("drift preview is hidden when activeSource=real (form body is hidden)", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    render(
      <ManualConditionsForm
        datasetId="lake-preview"
        realDataAvailable
        activeSource="real"
        onSourceChange={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("manual-conditions-drift-preview")).toBeNull();
  });
});

describe("computeManualDriftPreview — pure function", () => {
  it("returns distKm and bearingDeg fields", async () => {
    const { computeManualDriftPreview } = await import("@/components/ManualConditionsForm");
    const conditions: ManualConditions = {
      windSpeedKnots: 10,
      windDirectionDeg: 0,
      surfaceTempC: null,
      currentSpeedKnots: 0.5,
      currentDirectionDeg: 0,
      waterLevelM: null,
    };
    const result = computeManualDriftPreview(conditions);
    expect(result).toHaveProperty("distKm");
    expect(result).toHaveProperty("bearingDeg");
    expect(typeof result.distKm).toBe("number");
    expect(typeof result.bearingDeg).toBe("number");
  });

  it("returns distKm > 0 when wind and current are non-zero", async () => {
    const { computeManualDriftPreview } = await import("@/components/ManualConditionsForm");
    const conditions: ManualConditions = {
      windSpeedKnots: 12,
      windDirectionDeg: 270,
      surfaceTempC: null,
      currentSpeedKnots: 0.5,
      currentDirectionDeg: 90,
      waterLevelM: null,
    };
    const result = computeManualDriftPreview(conditions);
    expect(result.distKm).toBeGreaterThan(0);
  });

  it("returns near-zero distKm when both wind and current are zero", async () => {
    const { computeManualDriftPreview } = await import("@/components/ManualConditionsForm");
    const conditions: ManualConditions = {
      windSpeedKnots: 0,
      windDirectionDeg: 0,
      surfaceTempC: null,
      currentSpeedKnots: 0,
      currentDirectionDeg: 0,
      waterLevelM: null,
    };
    const result = computeManualDriftPreview(conditions);
    expect(result.distKm).toBeCloseTo(0, 6);
  });

  it("bearingDeg is normalised to [0, 360)", async () => {
    const { computeManualDriftPreview } = await import("@/components/ManualConditionsForm");
    const conditions: ManualConditions = {
      windSpeedKnots: 15,
      windDirectionDeg: 315,
      surfaceTempC: null,
      currentSpeedKnots: 1,
      currentDirectionDeg: 270,
      waterLevelM: null,
    };
    const result = computeManualDriftPreview(conditions);
    expect(result.bearingDeg).toBeGreaterThanOrEqual(0);
    expect(result.bearingDeg).toBeLessThan(360);
  });
});
