/**
 * Regression tests for CameraPosition discriminated union.
 *
 * These tests verify that the `cameraPosition: CameraPosition` field in
 * cameraStore correctly replaces the former `cameraLon: number | null` /
 * `cameraLat: number | null` pair so the one-without-the-other invalid
 * state is structurally unrepresentable.
 *
 * Covered:
 *   - Initial state is `{ known: false }`
 *   - setCameraGeo transitions to `{ known: true, lon, lat }`
 *   - setState({ cameraPosition: { known: false } }) resets to unknown
 *   - setState({ cameraPosition: { known: true, lon, lat } }) sets known
 *   - TypeScript narrows correctly — accessing .lon / .lat requires known guard
 *   - Separate lon/lat without each other is not possible via the store API
 *     (verified through the TS type — there is no `setCameraLon` action)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useCameraStore } from "@/lib/cameraStore";
import type { CameraPosition } from "@/lib/cameraStore";

beforeEach(() => {
  useCameraStore.setState({ cameraPosition: { known: false } });
});

describe("CameraPosition discriminated union", () => {
  it("starts as { known: false }", () => {
    const pos = useCameraStore.getState().cameraPosition;
    expect(pos.known).toBe(false);
  });

  it("setCameraGeo transitions to { known: true, lon, lat }", () => {
    useCameraStore.getState().setCameraGeo({
      lon: -122.5,
      lat: 47.6,
      depth: 50,
      heading: 90,
      altitude: 10,
    });
    const pos = useCameraStore.getState().cameraPosition;
    expect(pos.known).toBe(true);
    if (pos.known) {
      expect(pos.lon).toBeCloseTo(-122.5);
      expect(pos.lat).toBeCloseTo(47.6);
    }
  });

  it("setState with { known: false } resets to unknown", () => {
    useCameraStore.setState({ cameraPosition: { known: true, lon: -100, lat: 40 } });
    useCameraStore.setState({ cameraPosition: { known: false } });
    const pos = useCameraStore.getState().cameraPosition;
    expect(pos.known).toBe(false);
  });

  it("setState with { known: true } sets both lon and lat atomically", () => {
    useCameraStore.setState({ cameraPosition: { known: true, lon: -120.5, lat: 48.0 } });
    const pos = useCameraStore.getState().cameraPosition;
    expect(pos.known).toBe(true);
    if (pos.known) {
      expect(pos.lon).toBe(-120.5);
      expect(pos.lat).toBe(48.0);
    }
  });

  it("TypeScript narrowing: lon and lat accessible only inside known guard", () => {
    useCameraStore.setState({ cameraPosition: { known: true, lon: 10, lat: 20 } });
    const pos: CameraPosition = useCameraStore.getState().cameraPosition;

    if (pos.known) {
      const lon: number = pos.lon;
      const lat: number = pos.lat;
      expect(lon).toBe(10);
      expect(lat).toBe(20);
    } else {
      expect.fail("expected pos.known to be true");
    }
  });

  it("store has no setCameraLon / setCameraLat actions (lon+lat are always atomic)", () => {
    const state = useCameraStore.getState();
    expect((state as Record<string, unknown>)["setCameraLon"]).toBeUndefined();
    expect((state as Record<string, unknown>)["setCameraLat"]).toBeUndefined();
  });

  it("multiple setCameraGeo calls update lon and lat together", () => {
    useCameraStore.getState().setCameraGeo({ lon: -100, lat: 30, depth: 10, heading: 0, altitude: 5 });
    useCameraStore.getState().setCameraGeo({ lon: -110, lat: 35, depth: 20, heading: 45, altitude: 8 });
    const pos = useCameraStore.getState().cameraPosition;
    expect(pos.known).toBe(true);
    if (pos.known) {
      expect(pos.lon).toBeCloseTo(-110);
      expect(pos.lat).toBeCloseTo(35);
    }
  });
});
