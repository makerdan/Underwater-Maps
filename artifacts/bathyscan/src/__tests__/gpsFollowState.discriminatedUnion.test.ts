/**
 * Regression tests for GpsFollowState discriminated union.
 *
 * These tests verify that the `gpsFollowState: GpsFollowState` field in
 * cameraStore correctly replaces the former `gpsFollowMode: boolean` +
 * `followPausedByInteraction: boolean` pair so the invalid combination
 * (paused=true while followMode=false) is structurally unrepresentable.
 *
 * Covered:
 *   - Initial state is 'off'
 *   - setGpsFollowMode(true) → 'following'
 *   - setGpsFollowMode(false) → 'off'
 *   - pauseFollowForInteraction while 'following' → 'paused'
 *   - pauseFollowForInteraction while 'off' → no-op (stays 'off')
 *   - resumeFollow while 'paused' → 'following'
 *   - setGpsFollowMode(false) while 'paused' → 'off' + resets timer
 *   - Store has no gpsFollowMode / followPausedByInteraction fields
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useCameraStore } from "@/lib/cameraStore";
import type { GpsFollowState } from "@/lib/cameraStore";

beforeEach(() => {
  useCameraStore.setState({ gpsFollowState: "off", followLastInteractionAt: 0 });
});

describe("GpsFollowState discriminated union", () => {
  it("starts as 'off'", () => {
    expect(useCameraStore.getState().gpsFollowState).toBe<GpsFollowState>("off");
  });

  it("setGpsFollowMode(true) transitions to 'following'", () => {
    useCameraStore.getState().setGpsFollowMode(true);
    expect(useCameraStore.getState().gpsFollowState).toBe<GpsFollowState>("following");
  });

  it("setGpsFollowMode(false) transitions to 'off' from 'following'", () => {
    useCameraStore.getState().setGpsFollowMode(true);
    useCameraStore.getState().setGpsFollowMode(false);
    expect(useCameraStore.getState().gpsFollowState).toBe<GpsFollowState>("off");
  });

  it("pauseFollowForInteraction while 'following' → 'paused'", () => {
    useCameraStore.setState({ gpsFollowState: "following" });
    useCameraStore.getState().pauseFollowForInteraction();
    expect(useCameraStore.getState().gpsFollowState).toBe<GpsFollowState>("paused");
  });

  it("pauseFollowForInteraction while 'off' → no-op (stays 'off')", () => {
    expect(useCameraStore.getState().gpsFollowState).toBe("off");
    useCameraStore.getState().pauseFollowForInteraction();
    expect(useCameraStore.getState().gpsFollowState).toBe<GpsFollowState>("off");
  });

  it("resumeFollow while 'paused' → 'following'", () => {
    useCameraStore.setState({ gpsFollowState: "paused" });
    useCameraStore.getState().resumeFollow();
    expect(useCameraStore.getState().gpsFollowState).toBe<GpsFollowState>("following");
  });

  it("setGpsFollowMode(false) while 'paused' → 'off' and resets followLastInteractionAt", () => {
    useCameraStore.setState({ gpsFollowState: "paused", followLastInteractionAt: 12345 });
    useCameraStore.getState().setGpsFollowMode(false);
    expect(useCameraStore.getState().gpsFollowState).toBe<GpsFollowState>("off");
    expect(useCameraStore.getState().followLastInteractionAt).toBe(0);
  });

  it("invalid combo (paused=true + followMode=false) has no store representation", () => {
    const state = useCameraStore.getState();
    expect((state as Record<string, unknown>)["gpsFollowMode"]).toBeUndefined();
    expect((state as Record<string, unknown>)["followPausedByInteraction"]).toBeUndefined();
  });

  it("'paused' and 'off' are mutually exclusive states — only one value at a time", () => {
    useCameraStore.setState({ gpsFollowState: "paused" });
    const s1 = useCameraStore.getState().gpsFollowState;
    expect(s1).not.toBe("off");
    expect(s1).not.toBe("following");

    useCameraStore.setState({ gpsFollowState: "off" });
    const s2 = useCameraStore.getState().gpsFollowState;
    expect(s2).not.toBe("paused");
    expect(s2).not.toBe("following");
  });
});
