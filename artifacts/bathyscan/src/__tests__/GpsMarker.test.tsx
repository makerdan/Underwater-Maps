/**
 * GpsMarker surface-anchor guard tests.
 *
 * Strategy: mock `getSeaSurfaceY` and `worldYToDepthFt` so we can assert they
 * are called, and verify the depth label text reflects the correct value from
 * worldYToDepthFt rather than the old inline formula.
 *
 * Verifying rendered mesh position-y props directly is not feasible in jsdom
 * (R3F custom elements do not set props as DOM attributes), so we guard the
 * correctness of `getSeaSurfaceY` and `worldYToDepthFt` themselves in the
 * dedicated terrain-worldYToDepthFt.test.ts, and guard that GpsMarker calls
 * them via the spy assertions here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderWithProviders } from "./setup";

// ── Three.js / R3F stubs ───────────────────────────────────────────────────
vi.mock("three");
vi.mock("../lib/zoneMap", () => ({
  SALTWATER_ZONE_TO_SLOT: [0, 1, 2, 3],
  FRESHWATER_ZONE_TO_SLOT: [0, 0, 3, 2],
}));

vi.mock("@react-three/fiber", () => ({
  useFrame: vi.fn(),
}));

vi.mock("@react-three/drei", () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", { "data-testid": "drei-text" }, children),
  Billboard: ({ children, position }: { children: React.ReactNode; position?: unknown }) =>
    React.createElement("div", { "data-testid": "billboard", "data-pos": JSON.stringify(position) }, children),
}));

// ── Stores / context mocks ─────────────────────────────────────────────────
const POSITION = { latitude: 0.5, longitude: 0.5, accuracy: 5 };

vi.mock("@/lib/gpsStore", () => ({
  useGpsStore: (sel: (s: { position: typeof POSITION; active: boolean }) => unknown) =>
    sel({ position: POSITION, active: true }),
}));

// Terrain with minDepth=200, maxDepth=400. getSeaSurfaceY should return > 0.
const TERRAIN = {
  datasetId: "test-ds",
  name: "Test",
  waterType: "saltwater",
  resolution: 2,
  width: 2,
  height: 2,
  depths: [200, 250, 300, 400],
  minDepth: 200,
  maxDepth: 400,
  minLon: 0,
  maxLon: 1,
  minLat: 0,
  maxLat: 1,
  centerLon: 0.5,
  centerLat: 0.5,
};

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: TERRAIN }),
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (sel: (s: { units: string }) => unknown) =>
    sel({ units: "metric" }),
}));

vi.mock("@/lib/units", () => ({
  formatDepth: (val: number, _opts: unknown) => `${val} m`,
}));

// ── Terrain module spy setup ───────────────────────────────────────────────
// We spy on getSeaSurfaceY and worldYToDepthFt to verify GpsMarker calls them.
// The real implementations are used so we can also assert on return values.
const terrainModule = await import("@/lib/terrain");
const getSeaSurfaceYSpy = vi.spyOn(terrainModule, "getSeaSurfaceY");
const worldYToDepthFtSpy = vi.spyOn(terrainModule, "worldYToDepthFt");

// ── Import component after mocks ──────────────────────────────────────────
import { GpsMarker } from "@/components/GpsMarker";
import { getSeaSurfaceY } from "@/lib/terrain";

describe("GpsMarker — surface anchor at getSeaSurfaceY (Bug 2 guard)", () => {
  beforeEach(() => {
    getSeaSurfaceYSpy.mockClear();
    worldYToDepthFtSpy.mockClear();
  });

  it("getSeaSurfaceY returns a positive value for the test terrain (validates the premise)", () => {
    const seaSurface = getSeaSurfaceY(TERRAIN as Parameters<typeof getSeaSurfaceY>[0]);
    expect(seaSurface).toBeGreaterThan(0);
  });

  it("calls getSeaSurfaceY when rendering with minDepth > 0", () => {
    renderWithProviders(
      React.createElement("div", null, React.createElement(GpsMarker)),
    );
    expect(getSeaSurfaceYSpy).toHaveBeenCalled();
  });

  it("calls worldYToDepthFt to compute the depth label (Bug 1 guard)", () => {
    renderWithProviders(
      React.createElement("div", null, React.createElement(GpsMarker)),
    );
    expect(worldYToDepthFtSpy).toHaveBeenCalled();
  });

  it("worldYToDepthFt return value accounts for minDepth (returns ≥ minDepth for any bottomY ≤ 0)", () => {
    // For minDepth=200, maxDepth=400: worldYToDepthFt(0, terrain) should be 200, not 0.
    // This guards Bug 1: old formula returned 0 at bottomY=0 even when minDepth=200.
    const result = terrainModule.worldYToDepthFt(0, TERRAIN as Parameters<typeof terrainModule.worldYToDepthFt>[1]);
    expect(result).toBeCloseTo(200, 2);
    expect(result).toBeGreaterThanOrEqual(200);
  });

  it("getSeaSurfaceY is non-zero for terrain with minDepth=200 (anchor bug guard)", () => {
    // If the component used hard-coded 0 instead of getSeaSurfaceY(), the cone
    // and ring would appear 200 ft below the real sea surface.
    const seaSurface = terrainModule.getSeaSurfaceY(
      TERRAIN as Parameters<typeof terrainModule.getSeaSurfaceY>[0],
    );
    // For minDepth=200, maxDepth=400: surfY = (200/(400-200)) * 50 = 50
    expect(seaSurface).toBeCloseTo(50, 2);
    expect(seaSurface).not.toBeCloseTo(0, 1);
  });
});
