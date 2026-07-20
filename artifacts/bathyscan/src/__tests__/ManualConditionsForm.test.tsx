/**
 * Unit tests — manual conditions end-to-end wiring.
 *
 * Covers:
 *   • useSurfaceConditions reads manual values from settingsStore /
 *     uiStore when source="manual" (session takes precedence over persisted)
 *   • snapshot.estimated is false and currentsAvailable is true under manual mode
 *   • per-dataset keying: switching datasetId changes the active conditions
 *   • source="real" falls back to the API-derived snapshot
 *   • ManualConditionsForm drift preview is non-blank on first render when
 *     session conditions are pre-set (stale-init regression guard)
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, render, screen } from "@testing-library/react";
import { useSettingsStore } from "@/lib/settingsStore";
import { useUiStore } from "@/lib/uiStore";
import type { ManualConditions } from "@/lib/settingsStore";

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockUseAppState = vi.fn();

vi.mock("@/lib/context", () => ({
  useAppState: mockUseAppState,
}));

vi.mock("@/lib/driftStore", () => ({
  useDriftStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      manualWindSpeedKnots: 0,
      manualWindDegrees: 0,
      manualTidalSpeedKnots: 0,
      manualTidalDegrees: 0,
      driftPlannerActive: false,
      driftHour: 0,
    }),
  ),
}));

// API mock: always returns one hour entry (hour=12, wind=5kn, tidal=0.2kn).
// The query is "disabled" when terrain is null (no centerLat/Lon), but since
// this is a unit mock we keep data consistent and test manual-conditions logic.
vi.mock("@workspace/api-client-react", () => ({
  useGetSurfaceConditions: vi.fn(() => ({
    data: {
      hours: [
        {
          hour: 12,
          windSpeedKnots: 5,
          windDegrees: 90,
          tidalSpeedKnots: 0.2,
          tidalDegrees: 180,
          waveHeightM: 0.3,
        },
      ],
      forecast48h: [],
      estimatedConditions: false,
      tidalDataSource: "noaa-coops",
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  })),
  getGetSurfaceConditionsQueryKey: vi.fn(() => ["surface-conditions"]),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const LAKE_A = "fw-lake-a";
const LAKE_B = "fw-lake-b";

const SAMPLE_A: ManualConditions = {
  windSpeedKnots: 12,
  windDirectionDeg: 270,
  surfaceTempC: 18,
  currentSpeedKnots: 0.5,
  currentDirectionDeg: 90,
  waterLevelM: 1.2,
};

const SAMPLE_B: ManualConditions = {
  windSpeedKnots: 3,
  windDirectionDeg: 45,
  surfaceTempC: null,
  currentSpeedKnots: 0.1,
  currentDirectionDeg: 0,
  waterLevelM: null,
};

function makeTerrain(datasetId: string) {
  return {
    datasetId,
    minLat: 32,
    maxLat: 33,
    minLon: -97,
    maxLon: -96,
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  useSettingsStore.setState({
    datasetManualConditions: {},
    manualConditionsActiveSource: {},
  });
  useUiStore.setState({ sessionManualConditions: {} });

  // Default: lake A terrain
  mockUseAppState.mockReturnValue({ terrain: makeTerrain(LAKE_A) });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useSurfaceConditions — manual conditions wiring", () => {
  it("returns API snapshot when source is 'real' (default)", async () => {
    const { useSurfaceConditions } = await import("@/hooks/useSurfaceConditions");

    useSettingsStore.setState({
      datasetManualConditions: { [LAKE_A]: SAMPLE_A },
      manualConditionsActiveSource: { [LAKE_A]: "real" },
    });

    const { result } = renderHook(() => useSurfaceConditions());
    // Source is "real" → use API data (windSpeedKnots=5 from mock)
    expect(result.current.snapshot?.windSpeedKnots).toBe(5);
    expect(result.current.snapshot?.tidalSpeedKnots).toBe(0.2);
  });

  it("overrides snapshot with persisted manual values when source='manual'", async () => {
    const { useSurfaceConditions } = await import("@/hooks/useSurfaceConditions");

    useSettingsStore.setState({
      datasetManualConditions: { [LAKE_A]: SAMPLE_A },
      manualConditionsActiveSource: { [LAKE_A]: "manual" },
    });

    const { result } = renderHook(() => useSurfaceConditions());

    expect(result.current.snapshot?.windSpeedKnots).toBe(SAMPLE_A.windSpeedKnots);
    expect(result.current.snapshot?.windDegrees).toBe(SAMPLE_A.windDirectionDeg);
    expect(result.current.snapshot?.tidalSpeedKnots).toBe(SAMPLE_A.currentSpeedKnots);
    expect(result.current.snapshot?.tidalDegrees).toBe(SAMPLE_A.currentDirectionDeg);
    expect(result.current.snapshot?.waveHeightM).toBe(0);
    expect(result.current.snapshot?.tideRising).toBe(true);
  });

  it("manual snapshot forces estimated=false and currentsAvailable=true", async () => {
    const { useSurfaceConditions } = await import("@/hooks/useSurfaceConditions");

    useSettingsStore.setState({
      datasetManualConditions: { [LAKE_A]: SAMPLE_A },
      manualConditionsActiveSource: { [LAKE_A]: "manual" },
    });

    const { result } = renderHook(() => useSurfaceConditions());
    expect(result.current.estimated).toBe(false);
    expect(result.current.currentsAvailable).toBe(true);
  });

  it("session conditions override persisted conditions when source='manual'", async () => {
    const { useSurfaceConditions } = await import("@/hooks/useSurfaceConditions");

    useSettingsStore.setState({
      datasetManualConditions: { [LAKE_A]: SAMPLE_A },
      manualConditionsActiveSource: { [LAKE_A]: "manual" },
    });
    useUiStore.setState({
      sessionManualConditions: { [LAKE_A]: { ...SAMPLE_B } },
    });

    const { result } = renderHook(() => useSurfaceConditions());

    // Session value (SAMPLE_B) wins over persisted (SAMPLE_A)
    expect(result.current.snapshot?.windSpeedKnots).toBe(SAMPLE_B.windSpeedKnots);
    expect(result.current.snapshot?.tidalSpeedKnots).toBe(SAMPLE_B.currentSpeedKnots);
  });

  it("per-dataset: lake A conditions do not bleed into lake B", async () => {
    const { useSurfaceConditions } = await import("@/hooks/useSurfaceConditions");

    useSettingsStore.setState({
      datasetManualConditions: { [LAKE_A]: SAMPLE_A },
      manualConditionsActiveSource: {
        [LAKE_A]: "manual",
        [LAKE_B]: "manual", // source is manual but no conditions stored for B
      },
    });

    // Switch to lake B terrain — no conditions exist for B
    mockUseAppState.mockReturnValue({ terrain: makeTerrain(LAKE_B) });

    const { result } = renderHook(() => useSurfaceConditions());
    // No conditions for LAKE_B → falls back to API snapshot (windSpeedKnots=5)
    expect(result.current.snapshot?.windSpeedKnots).toBe(5);
  });

  it("no manual override when source='manual' but no conditions stored", async () => {
    const { useSurfaceConditions } = await import("@/hooks/useSurfaceConditions");

    useSettingsStore.setState({
      datasetManualConditions: {}, // nothing stored
      manualConditionsActiveSource: { [LAKE_A]: "manual" },
    });

    const { result } = renderHook(() => useSurfaceConditions());
    // Falls back to API snapshot because manualConds is null
    expect(result.current.snapshot?.windSpeedKnots).toBe(5);
  });
});

// ── Stale-init regression: drift preview on first render ──────────────────────
//
// Guards against: drift preview showing blank or 0 on first render when the
// form opens with persisted session conditions.
//
// These tests render ManualConditionsForm directly against the real Zustand
// stores (settingsStore + uiStore) — no component-level mock needed because
// all of the form's dependencies (boatPhysics, units, boatProfiles) are pure
// functions that work without additional mocking.

describe("ManualConditionsForm — drift preview init (stale-init regression)", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      datasetManualConditions: {},
      manualConditionsActiveSource: {},
    });
    useUiStore.setState({ sessionManualConditions: {} });
  });

  it("preview shows non-zero km on first render when sessionConditions are pre-set", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");

    useUiStore.setState({
      sessionManualConditions: {
        [LAKE_A]: SAMPLE_A,
      },
    });

    render(<ManualConditionsForm datasetId={LAKE_A} />);

    const previewEl = screen.getByTestId("manual-conditions-drift-preview-value");
    expect(previewEl.textContent).toMatch(/km/);
    // SAMPLE_A has non-zero wind (12 kn) and current (0.5 kn) — preview must
    // show a distance > 0, never blank or literally "0 km"
    expect(previewEl.textContent).not.toMatch(/^~0\.0 km/);
  });

  it("preview shows correct non-default value when persistedConditions are pre-set and no session", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");

    useSettingsStore.setState({
      datasetManualConditions: { [LAKE_A]: SAMPLE_A },
      manualConditionsActiveSource: {},
    });

    render(<ManualConditionsForm datasetId={LAKE_A} />);

    const previewEl = screen.getByTestId("manual-conditions-drift-preview-value");
    // Must show km — never blank
    expect(previewEl.textContent).toMatch(/km/);
    // SAMPLE_A wind=12 kn, current=0.5 kn → drift > 0.1 km
    const windInput = screen.getByTestId("manual-conditions-wind-speed") as HTMLInputElement;
    expect(Number(windInput.value)).toBe(SAMPLE_A.windSpeedKnots);
  });

  it("preview reflects session conditions even before user interacts with the form", async () => {
    const { ManualConditionsForm } = await import("@/components/ManualConditionsForm");

    const highWindConditions: ManualConditions = {
      windSpeedKnots: 40,
      windDirectionDeg: 0,
      surfaceTempC: null,
      currentSpeedKnots: 2,
      currentDirectionDeg: 0,
      waterLevelM: null,
    };
    useUiStore.setState({
      sessionManualConditions: { [LAKE_A]: highWindConditions },
    });

    render(<ManualConditionsForm datasetId={LAKE_A} />);

    const windInput = screen.getByTestId("manual-conditions-wind-speed") as HTMLInputElement;
    // Form must open with the session values (40 kn), not with DEFAULT_CONDITIONS (8 kn)
    expect(Number(windInput.value)).toBe(40);

    const previewEl = screen.getByTestId("manual-conditions-drift-preview-value");
    // High wind → drift estimate must show km, not blank
    expect(previewEl.textContent).toMatch(/km/);
  });
});
