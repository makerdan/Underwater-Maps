/**
 * ManualConditionsForm — store and persistence regression tests.
 *
 * @tag freshwater-env
 *
 * Verifies:
 *   1. Applying without "Remember for this lake" writes to session store only,
 *      NOT to the persistent settings store.
 *   2. Applying with "Remember for this lake" checked writes to both stores.
 *   3. Manual conditions keyed to dataset A are absent when rendering for dataset B.
 *   4. Input validation: negative wind speed and out-of-range current speed are
 *      clamped to valid bounds on apply (not rejected with an error).
 *   5. Compass selector: clicking NE highlights the NE button and sets direction to 45.
 *   6. Source toggle shows when realDataAvailable=true; form hides when activeSource='real'.
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

  return {
    persistedByDataset,
    sessionByDataset,
    setDatasetManualConditions,
    setSessionManualConditions,
  };
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

describe("ManualConditionsForm — store writes", () => {
  beforeEach(() => {
    // Reset state between tests
    for (const k of Object.keys(h.persistedByDataset)) {
      delete h.persistedByDataset[k];
    }
    for (const k of Object.keys(h.sessionByDataset)) {
      delete h.sessionByDataset[k];
    }
    h.setDatasetManualConditions.mockClear();
    h.setSessionManualConditions.mockClear();
  });

  it("Apply without Remember → session only, no settings PUT", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");

    // No persisted conditions → remember defaults to false
    render(<ManualConditionsForm datasetId="lake-a" />);

    const applyBtn = screen.getByTestId("manual-conditions-apply");
    expect(applyBtn).toBeInTheDocument();

    const rememberCheckbox = screen.getByTestId("manual-conditions-remember");
    expect((rememberCheckbox as HTMLInputElement).checked).toBe(false);

    fireEvent.click(applyBtn);

    expect(h.setSessionManualConditions).toHaveBeenCalledOnce();
    expect(h.setSessionManualConditions).toHaveBeenCalledWith("lake-a", expect.any(Object));
    expect(h.setDatasetManualConditions).not.toHaveBeenCalled();
  });

  it("Apply with Remember checked → writes to both session and settings stores", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");

    render(<ManualConditionsForm datasetId="lake-a" />);

    const rememberCheckbox = screen.getByTestId("manual-conditions-remember");
    fireEvent.click(rememberCheckbox);
    expect((rememberCheckbox as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByTestId("manual-conditions-apply"));

    expect(h.setSessionManualConditions).toHaveBeenCalledOnce();
    expect(h.setDatasetManualConditions).toHaveBeenCalledOnce();
    expect(h.setDatasetManualConditions).toHaveBeenCalledWith("lake-a", expect.any(Object));
  });

  it("Remember pre-checked when persisted conditions exist for the dataset", async () => {
    h.persistedByDataset["lake-b"] = {
      windSpeedKnots: 5,
      windDirectionDeg: 180,
      surfaceTempC: 12,
      currentSpeedKnots: 0.3,
      currentDirectionDeg: 90,
      waterLevelM: null,
    };
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    render(<ManualConditionsForm datasetId="lake-b" />);

    const rememberCheckbox = screen.getByTestId("manual-conditions-remember");
    expect((rememberCheckbox as HTMLInputElement).checked).toBe(true);
  });
});

describe("ManualConditionsForm — dataset isolation", () => {
  beforeEach(() => {
    for (const k of Object.keys(h.persistedByDataset)) {
      delete h.persistedByDataset[k];
    }
    for (const k of Object.keys(h.sessionByDataset)) {
      delete h.sessionByDataset[k];
    }
    h.setDatasetManualConditions.mockClear();
    h.setSessionManualConditions.mockClear();
  });

  it("session conditions for dataset-A are absent when rendering dataset-B", async () => {
    h.sessionByDataset["dataset-a"] = {
      windSpeedKnots: 15,
      windDirectionDeg: 45,
      surfaceTempC: 20,
      currentSpeedKnots: 1.5,
      currentDirectionDeg: 90,
      waterLevelM: 0.5,
    };
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    render(<ManualConditionsForm datasetId="dataset-b" />);

    // dataset-b has no session conditions → form shows defaults, not dataset-a's values
    const windInput = screen.getByTestId("manual-conditions-wind-speed") as HTMLInputElement;
    // Default windSpeedKnots is 8 (from DEFAULT_CONDITIONS in the form)
    expect(Number(windInput.value)).toBe(8);
    // dataset-a had windSpeed=15; it must not bleed into dataset-b
    expect(Number(windInput.value)).not.toBe(15);
  });

  it("Apply for dataset-B does not call setSessionManualConditions with dataset-A's id", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    render(<ManualConditionsForm datasetId="dataset-b" />);

    fireEvent.click(screen.getByTestId("manual-conditions-apply"));

    expect(h.setSessionManualConditions).toHaveBeenCalledWith("dataset-b", expect.any(Object));
    const calledWithDatasetA = (h.setSessionManualConditions.mock.calls as [string, unknown][]).some(
      ([id]) => id === "dataset-a",
    );
    expect(calledWithDatasetA).toBe(false);
  });
});

describe("ManualConditionsForm — input clamping on apply", () => {
  beforeEach(() => {
    for (const k of Object.keys(h.persistedByDataset)) {
      delete h.persistedByDataset[k];
    }
    for (const k of Object.keys(h.sessionByDataset)) {
      delete h.sessionByDataset[k];
    }
    h.setDatasetManualConditions.mockClear();
    h.setSessionManualConditions.mockClear();
  });

  it("wind speed below 0 is clamped to 0 on apply", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    render(<ManualConditionsForm datasetId="lake-clamp" />);

    const windInput = screen.getByTestId("manual-conditions-wind-speed");
    fireEvent.change(windInput, { target: { value: "-5" } });
    fireEvent.click(screen.getByTestId("manual-conditions-apply"));

    const applied = h.setSessionManualConditions.mock.calls[0]?.[1] as ManualConditions | undefined;
    expect(applied).toBeDefined();
    expect(applied!.windSpeedKnots).toBe(0);
  });

  it("current speed above 20 is clamped to 20 on apply", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    render(<ManualConditionsForm datasetId="lake-clamp" />);

    const currentInput = screen.getByTestId("manual-conditions-current-speed");
    fireEvent.change(currentInput, { target: { value: "99" } });
    fireEvent.click(screen.getByTestId("manual-conditions-apply"));

    const applied = h.setSessionManualConditions.mock.calls[0]?.[1] as ManualConditions | undefined;
    expect(applied).toBeDefined();
    expect(applied!.currentSpeedKnots).toBe(20);
  });

  it("wind speed above 80 is clamped to 80 on apply", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    render(<ManualConditionsForm datasetId="lake-clamp" />);

    const windInput = screen.getByTestId("manual-conditions-wind-speed");
    fireEvent.change(windInput, { target: { value: "200" } });
    fireEvent.click(screen.getByTestId("manual-conditions-apply"));

    const applied = h.setSessionManualConditions.mock.calls[0]?.[1] as ManualConditions | undefined;
    expect(applied).toBeDefined();
    expect(applied!.windSpeedKnots).toBe(80);
  });
});

describe("ManualConditionsForm — compass selector", () => {
  beforeEach(() => {
    for (const k of Object.keys(h.persistedByDataset)) {
      delete h.persistedByDataset[k];
    }
    for (const k of Object.keys(h.sessionByDataset)) {
      delete h.sessionByDataset[k];
    }
    h.setDatasetManualConditions.mockClear();
    h.setSessionManualConditions.mockClear();
  });

  it("clicking NE compass button sets windDirectionDeg to 45 on apply", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    render(<ManualConditionsForm datasetId="lake-compass" />);

    const neBtn = screen.getByTestId("manual-conditions-wind-dir-NE");
    expect(neBtn).toBeInTheDocument();
    fireEvent.click(neBtn);

    fireEvent.click(screen.getByTestId("manual-conditions-apply"));

    const applied = h.setSessionManualConditions.mock.calls[0]?.[1] as ManualConditions | undefined;
    expect(applied).toBeDefined();
    expect(applied!.windDirectionDeg).toBe(45);
  });

  it("clicking W compass button sets windDirectionDeg to 270 on apply", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    render(<ManualConditionsForm datasetId="lake-compass" />);

    const wBtn = screen.getByTestId("manual-conditions-wind-dir-W");
    fireEvent.click(wBtn);

    fireEvent.click(screen.getByTestId("manual-conditions-apply"));

    const applied = h.setSessionManualConditions.mock.calls[0]?.[1] as ManualConditions | undefined;
    expect(applied).toBeDefined();
    expect(applied!.windDirectionDeg).toBe(270);
  });

  it("default wind direction (225°=SW) is highlighted in compass on initial render", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    render(<ManualConditionsForm datasetId="lake-compass" />);

    // Default windDirectionDeg is 225 → nearestCompassDeg(225) = SW
    const swBtn = screen.getByTestId("manual-conditions-wind-dir-SW");
    expect(swBtn).toBeInTheDocument();
    // The SW button should have the 'active' styling (bright border color)
    const swStyle = (swBtn as HTMLButtonElement).style.borderColor;
    const otherBtn = screen.getByTestId("manual-conditions-wind-dir-N");
    const otherStyle = (otherBtn as HTMLButtonElement).style.borderColor;
    // Active button has a more prominent border than inactive
    expect(swStyle).not.toBe(otherStyle);
  });
});

describe("ManualConditionsForm — source toggle visibility", () => {
  beforeEach(() => {
    for (const k of Object.keys(h.persistedByDataset)) {
      delete h.persistedByDataset[k];
    }
    for (const k of Object.keys(h.sessionByDataset)) {
      delete h.sessionByDataset[k];
    }
    h.setDatasetManualConditions.mockClear();
    h.setSessionManualConditions.mockClear();
  });

  it("without realDataAvailable: no source toggle shown, form visible", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    render(<ManualConditionsForm datasetId="lake-src" realDataAvailable={false} />);

    expect(screen.queryByTestId("manual-conditions-source-toggle")).toBeNull();
    expect(screen.getByTestId("manual-conditions-apply")).toBeInTheDocument();
  });

  it("realDataAvailable=true + activeSource=manual: source toggle shown, form visible", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    const onSourceChange = vi.fn();
    render(
      <ManualConditionsForm
        datasetId="lake-src"
        realDataAvailable
        activeSource="manual"
        onSourceChange={onSourceChange}
      />,
    );

    expect(screen.getByTestId("manual-conditions-source-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("manual-conditions-apply")).toBeInTheDocument();
  });

  it("realDataAvailable=true + activeSource=real: source toggle shown, form hidden", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    const onSourceChange = vi.fn();
    render(
      <ManualConditionsForm
        datasetId="lake-src"
        realDataAvailable
        activeSource="real"
        onSourceChange={onSourceChange}
      />,
    );

    expect(screen.getByTestId("manual-conditions-source-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("manual-conditions-apply")).toBeNull();
  });

  it("clicking MANUAL button in source toggle calls onSourceChange('manual')", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    const onSourceChange = vi.fn();
    render(
      <ManualConditionsForm
        datasetId="lake-src"
        realDataAvailable
        activeSource="real"
        onSourceChange={onSourceChange}
      />,
    );

    fireEvent.click(screen.getByTestId("manual-conditions-source-manual"));
    expect(onSourceChange).toHaveBeenCalledWith("manual");
  });

  it("clicking STATION button in source toggle calls onSourceChange('real')", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");
    const onSourceChange = vi.fn();
    render(
      <ManualConditionsForm
        datasetId="lake-src"
        realDataAvailable
        activeSource="manual"
        onSourceChange={onSourceChange}
      />,
    );

    fireEvent.click(screen.getByTestId("manual-conditions-source-real"));
    expect(onSourceChange).toHaveBeenCalledWith("real");
  });
});
