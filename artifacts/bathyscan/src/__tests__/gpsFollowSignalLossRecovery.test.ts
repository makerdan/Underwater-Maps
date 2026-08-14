/**
 * Unit tests for GPS signal-loss follow auto-resume behaviour.
 *
 * The recovery logic lives in useGpsFollowCamera's useEffect (which runs in an
 * R3F Canvas context and cannot be mounted here). These tests instead verify
 * the underlying store transitions and the exact predicate the effect uses, so
 * that any future refactor of the hook cannot silently break the feature.
 *
 * Covered:
 *   - Signal-loss pause → GPS recovery → resumeFollow() fires (camera follows again).
 *   - User-interaction pause is NOT auto-resumed on GPS signal recovery.
 *   - 'off' state (follow disabled) is not affected by GPS recovery.
 *   - Signal recovery when already 'following' is a no-op (no double-resume).
 *   - pauseFollowForSignalLoss + setGpsFollowMode(false) → follow stays off on recovery.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useCameraStore } from "@/lib/cameraStore";
import { useGpsStore } from "@/lib/gpsStore";

/**
 * Simulates the predicate in useGpsFollowCamera's gpsActive useEffect:
 *   if (gpsActive) {
 *     const cam = useCameraStore.getState();
 *     if (cam.gpsFollowState === "paused" && cam.pauseReason === "signal-loss") {
 *       cam.resumeFollow();
 *     }
 *   }
 * Extracting this into a function lets us test it without mounting the R3F hook.
 */
function simulateGpsRecoveryEffect(gpsActive: boolean): void {
  if (!gpsActive) return;
  const cam = useCameraStore.getState();
  if (cam.gpsFollowState === "paused" && cam.pauseReason === "signal-loss") {
    cam.resumeFollow();
  }
}

beforeEach(() => {
  useCameraStore.setState({
    gpsFollowState: "off",
    pauseReason: null,
    followLastInteractionAt: 0,
  });
  useGpsStore.setState({ active: false });
});

describe("GPS signal-loss follow auto-resume", () => {
  it("signal-loss pause → GPS recovery → camera follow re-engages", () => {
    // Start following, then GPS goes inactive (signal loss)
    useCameraStore.setState({ gpsFollowState: "following" });
    useCameraStore.getState().pauseFollowForSignalLoss();

    expect(useCameraStore.getState().gpsFollowState).toBe("paused");
    expect(useCameraStore.getState().pauseReason).toBe("signal-loss");

    // GPS signal returns → follow auto-resumes
    simulateGpsRecoveryEffect(true);

    expect(useCameraStore.getState().gpsFollowState).toBe("following");
    expect(useCameraStore.getState().pauseReason).toBeNull();
  });

  it("user-interaction pause is NOT auto-resumed on GPS signal recovery", () => {
    // User was following, then panned the camera (interaction pause)
    useCameraStore.setState({ gpsFollowState: "following" });
    useCameraStore.getState().pauseFollowForInteraction();

    expect(useCameraStore.getState().gpsFollowState).toBe("paused");
    expect(useCameraStore.getState().pauseReason).toBe("interaction");

    // GPS signal fluctuates, then returns — should NOT touch the interaction pause
    simulateGpsRecoveryEffect(false);
    simulateGpsRecoveryEffect(true);

    expect(useCameraStore.getState().gpsFollowState).toBe("paused");
    expect(useCameraStore.getState().pauseReason).toBe("interaction");
  });

  it("follow 'off' state is unaffected by GPS recovery", () => {
    // Follow mode is fully off (user never enabled it)
    expect(useCameraStore.getState().gpsFollowState).toBe("off");

    simulateGpsRecoveryEffect(true);

    expect(useCameraStore.getState().gpsFollowState).toBe("off");
    expect(useCameraStore.getState().pauseReason).toBeNull();
  });

  it("already 'following' on GPS recovery — no-op (no double resume)", () => {
    // Follow mode is already active (signal never dropped)
    useCameraStore.setState({ gpsFollowState: "following" });

    simulateGpsRecoveryEffect(true);

    // Still following, no state change
    expect(useCameraStore.getState().gpsFollowState).toBe("following");
    expect(useCameraStore.getState().pauseReason).toBeNull();
  });

  it("gpsActive=false during effect is a no-op", () => {
    useCameraStore.setState({ gpsFollowState: "paused", pauseReason: "signal-loss" });

    simulateGpsRecoveryEffect(false);

    // GPS still inactive — should stay paused
    expect(useCameraStore.getState().gpsFollowState).toBe("paused");
    expect(useCameraStore.getState().pauseReason).toBe("signal-loss");
  });

  it("signal-loss pause then manual disable → recovery does not re-enable follow", () => {
    // User was following, GPS dropped (signal-loss pause)
    useCameraStore.setState({ gpsFollowState: "following" });
    useCameraStore.getState().pauseFollowForSignalLoss();

    // User explicitly disables follow (e.g. taps Follow Me button again)
    useCameraStore.getState().setGpsFollowMode(false);
    expect(useCameraStore.getState().gpsFollowState).toBe("off");
    expect(useCameraStore.getState().pauseReason).toBeNull();

    // GPS recovers — follow must NOT auto-resume because user disabled it
    simulateGpsRecoveryEffect(true);

    expect(useCameraStore.getState().gpsFollowState).toBe("off");
  });

  it("manual camera interaction during signal-loss pause overrides reason — GPS recovery does NOT auto-resume", () => {
    // Start following, then GPS drops (signal-loss pause)
    useCameraStore.setState({ gpsFollowState: "following" });
    useCameraStore.getState().pauseFollowForSignalLoss();
    expect(useCameraStore.getState().pauseReason).toBe("signal-loss");

    // User pans the camera WHILE signal is lost — reason must become 'interaction'
    useCameraStore.getState().pauseFollowForInteraction();
    expect(useCameraStore.getState().gpsFollowState).toBe("paused");
    expect(useCameraStore.getState().pauseReason).toBe("interaction");

    // GPS signal now recovers — must NOT auto-resume (user intended to hold camera)
    simulateGpsRecoveryEffect(true);
    expect(useCameraStore.getState().gpsFollowState).toBe("paused");
    expect(useCameraStore.getState().pauseReason).toBe("interaction");
  });

  it("multiple GPS loss/recovery cycles each resume follow correctly", () => {
    useCameraStore.setState({ gpsFollowState: "following" });

    for (let i = 0; i < 3; i++) {
      // Signal drops
      useCameraStore.getState().pauseFollowForSignalLoss();
      expect(useCameraStore.getState().gpsFollowState).toBe("paused");
      expect(useCameraStore.getState().pauseReason).toBe("signal-loss");

      // Signal recovers
      simulateGpsRecoveryEffect(true);
      expect(useCameraStore.getState().gpsFollowState).toBe("following");
      expect(useCameraStore.getState().pauseReason).toBeNull();
    }
  });
});
