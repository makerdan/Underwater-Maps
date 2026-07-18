/**
 * quickDrop.ts — unit tests for the frozen conditions snapshot gatherer.
 *
 * Verifies:
 *  - GPS quality fields (accuracy/speed/heading) are copied through.
 *  - Terrain depth is bilinearly sampled; out-of-bounds → unavailable.
 *  - Tide/current/weather come from offline packs only; missing pack →
 *    all sources "unavailable" (never a live fetch).
 *  - A slow pack lookup is bounded by the time budget and cannot block
 *    the drop.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GpsPosition } from "@/lib/gpsStore";
import type { TerrainData } from "@workspace/api-client-react";

const packMocks = vi.hoisted(() => ({
  getPackForLocation: vi.fn(),
  getOfflineTideValue: vi.fn(),
  getOfflineWeatherValue: vi.fn(),
}));

vi.mock("@/lib/offlinePackStore", () => packMocks);

import { gatherConditionsSnapshot, sampleTerrainDepth } from "@/lib/quickDrop";

const GPS: GpsPosition = {
  longitude: -132.5,
  latitude: 55.5,
  accuracy: 6,
  timestamp: Date.now(),
  speed: 2.5,
  heading: 310,
};

// Flat 2x2 terrain, uniform depth 40 m.
const TERRAIN = {
  datasetId: "test-ds",
  minLon: -133,
  maxLon: -132,
  minLat: 55,
  maxLat: 56,
  resolution: 2,
  depths: [40, 40, 40, 40],
} as unknown as TerrainData;

beforeEach(() => {
  packMocks.getPackForLocation.mockReset().mockResolvedValue(null);
  packMocks.getOfflineTideValue.mockReset();
  packMocks.getOfflineWeatherValue.mockReset();
});

describe("sampleTerrainDepth", () => {
  it("interpolates depth inside bounds", () => {
    expect(sampleTerrainDepth(55.5, -132.5, TERRAIN)).toBeCloseTo(40);
  });

  it("returns null outside bounds", () => {
    expect(sampleTerrainDepth(10, 10, TERRAIN)).toBeNull();
  });
});

describe("gatherConditionsSnapshot", () => {
  it("copies GPS accuracy, speed and heading", async () => {
    const snap = await gatherConditionsSnapshot(GPS, TERRAIN);
    expect(snap.gpsAccuracyM).toBe(6);
    expect(snap.speedMps).toBe(2.5);
    expect(snap.headingDeg).toBe(310);
    expect(snap.capturedAt).toBeTruthy();
  });

  it("samples terrain depth when in bounds", async () => {
    const snap = await gatherConditionsSnapshot(GPS, TERRAIN);
    expect(snap.depthSource).toBe("terrain");
    expect(snap.depthM).toBeCloseTo(40);
  });

  it("marks depth unavailable without terrain or out of bounds", async () => {
    const noTerrain = await gatherConditionsSnapshot(GPS, null);
    expect(noTerrain.depthSource).toBe("unavailable");
    expect(noTerrain.depthM).toBeNull();

    const outOfBounds = await gatherConditionsSnapshot(
      { ...GPS, latitude: 10, longitude: 10 },
      TERRAIN,
    );
    expect(outOfBounds.depthSource).toBe("unavailable");
  });

  it("marks tide/weather unavailable when no offline pack covers the location", async () => {
    const snap = await gatherConditionsSnapshot(GPS, TERRAIN);
    expect(snap.tideSource).toBe("unavailable");
    expect(snap.weatherSource).toBe("unavailable");
    expect(snap.tideHeightM).toBeNull();
    expect(snap.windSpeedKnots).toBeNull();
  });

  it("uses cached pack values when a pack is available", async () => {
    packMocks.getPackForLocation.mockResolvedValue({ id: "pack-1" });
    packMocks.getOfflineTideValue.mockReturnValue({
      tideHeight: 1.4,
      currentSpeed: 0.8,
      currentDirection: 120,
      source: "pack",
    });
    packMocks.getOfflineWeatherValue.mockReturnValue({
      windSpeedKnots: 12,
      windDirDeg: 250,
      tempC: 14,
      observedAt: "2026-07-18T04:00:00Z",
    });

    const snap = await gatherConditionsSnapshot(GPS, TERRAIN);
    expect(snap.tideSource).toBe("pack");
    expect(snap.tideHeightM).toBe(1.4);
    expect(snap.currentSpeedKt).toBe(0.8);
    expect(snap.currentDirDeg).toBe(120);
    expect(snap.weatherSource).toBe("pack");
    expect(snap.windSpeedKnots).toBe(12);
    expect(snap.windDirDeg).toBe(250);
    expect(snap.tempC).toBe(14);
    expect(snap.weatherObservedAt).toBe("2026-07-18T04:00:00Z");
  });

  it("weather stays unavailable when the pack has no observation", async () => {
    packMocks.getPackForLocation.mockResolvedValue({ id: "pack-1" });
    packMocks.getOfflineTideValue.mockReturnValue({
      tideHeight: 1.0,
      currentSpeed: 0.2,
      currentDirection: 90,
      source: "pack",
    });
    packMocks.getOfflineWeatherValue.mockReturnValue(null);

    const snap = await gatherConditionsSnapshot(GPS, TERRAIN);
    expect(snap.tideSource).toBe("pack");
    expect(snap.weatherSource).toBe("unavailable");
  });

  it("times out a slow pack lookup within the budget instead of blocking", async () => {
    packMocks.getPackForLocation.mockReturnValue(
      new Promise(() => {
        /* never resolves */
      }),
    );

    const start = Date.now();
    const snap = await gatherConditionsSnapshot(GPS, TERRAIN, { timeBudgetMs: 50 });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(snap.tideSource).toBe("unavailable");
    expect(snap.weatherSource).toBe("unavailable");
    // GPS + depth still captured despite the stalled pack read.
    expect(snap.depthSource).toBe("terrain");
  });

  it("survives a pack lookup rejection", async () => {
    packMocks.getPackForLocation.mockRejectedValue(new Error("idb broken"));
    const snap = await gatherConditionsSnapshot(GPS, TERRAIN);
    expect(snap.tideSource).toBe("unavailable");
    expect(snap.weatherSource).toBe("unavailable");
  });
});
