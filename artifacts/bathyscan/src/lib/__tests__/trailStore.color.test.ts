/**
 * Unit tests for the trailStore `color` field — ensuring a fresh
 * startRecording() picks up the user's defaultTrailColor setting and
 * resumeRecording() preserves the color from the paused session.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTrailStore } from "../trailStore";
import { useSettingsStore } from "../settingsStore";

// trailStore imports gpsStore only inside the interval callback; mock it so
// timer advances don't try to read real GPS state.
vi.mock("@/lib/gpsStore", () => ({
  useGpsStore: { getState: () => ({ position: null }) },
}));

function resetStore(): void {
  const s = useTrailStore.getState();
  if (s.recording) s.stopRecording();
  useTrailStore.setState({
    recording: false,
    color: "#ff6600",
    currentPoints: [],
    startedAt: null,
    intervalId: null,
    isOverflowing: false,
  });
}

describe("trailStore — color field", () => {
  beforeEach(resetStore);

  it("starts with the default trail color", () => {
    expect(useTrailStore.getState().color).toBe("#ff6600");
  });

  it("applies defaultTrailColor from settings on startRecording", () => {
    useSettingsStore.setState({ defaultTrailColor: "#00aaff" });
    useTrailStore.getState().startRecording(1000);
    expect(useTrailStore.getState().color).toBe("#00aaff");
    useTrailStore.getState().stopRecording();
  });

  it("picks up the color set at recording time, not the store initial", () => {
    useSettingsStore.setState({ defaultTrailColor: "#cc2200" });
    useTrailStore.getState().startRecording(1000);
    const colorAtStart = useTrailStore.getState().color;
    // Changing the setting after recording starts does NOT retroactively change the color
    useSettingsStore.setState({ defaultTrailColor: "#ffffff" });
    expect(useTrailStore.getState().color).toBe(colorAtStart);
    expect(useTrailStore.getState().color).toBe("#cc2200");
    useTrailStore.getState().stopRecording();
  });

  it("uses an explicitly passed color instead of defaultTrailColor on startRecording", () => {
    useSettingsStore.setState({ defaultTrailColor: "#aabbcc" });
    useTrailStore.getState().startRecording(1000, "#11ff22");
    expect(useTrailStore.getState().color).toBe("#11ff22");
    useTrailStore.getState().stopRecording();
  });

  it("preserves the color from the paused session on resumeRecording", () => {
    useSettingsStore.setState({ defaultTrailColor: "#aabbcc" });
    useTrailStore.getState().startRecording(1000);
    expect(useTrailStore.getState().color).toBe("#aabbcc");
    useTrailStore.getState().stopRecording();

    // Change the default — resume should keep the original session color
    useSettingsStore.setState({ defaultTrailColor: "#ffffff" });
    useTrailStore.getState().resumeRecording(1000);
    expect(useTrailStore.getState().color).toBe("#aabbcc");
    useTrailStore.getState().stopRecording();
  });
});
