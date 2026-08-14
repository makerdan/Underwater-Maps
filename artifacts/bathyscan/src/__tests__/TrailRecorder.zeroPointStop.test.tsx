/**
 * Component-level test: TrailRecorder shows a "No trail points recorded"
 * toast when the user stops a recording session that collected zero GPS points.
 *
 * This exercises the full wiring from the stop-button click through
 * handleStop() → stopRecording() → zero-point toast path in the real component.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi, type MockedFunction } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TrailRecorder } from "@/components/TrailRecorder";
import { useTrailStore } from "@/lib/trailStore";
import { toast } from "@/hooks/use-toast";

// ── mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/gpsStore", () => ({
  useGpsStore: (selector: (s: { active: boolean }) => unknown) =>
    selector({ active: true }),
}));

vi.mock("@/lib/settingsStore", () => {
  const state = {
    gpsRecordingInterval: 10_000,
    setGpsRecordingInterval: vi.fn(),
    defaultTrailColor: "#ff6600",
  };
  return {
    useSettingsStore: (selector: (s: typeof state) => unknown) => selector(state),
  };
});

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: null }),
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/authorizedFetch", () => ({
  authorizedFetch: vi.fn(),
}));

const mockToast = toast as MockedFunction<typeof toast>;

// ── helpers ──────────────────────────────────────────────────────────────────

function resetStore() {
  useTrailStore.setState({
    recording: false,
    currentPoints: [],
    startedAt: null,
    intervalId: null,
    beforeUnloadCleanup: null,
    isOverflowing: false,
    draftTrail: null,
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("TrailRecorder — zero-point stop toast", () => {
  beforeEach(() => {
    resetStore();
    mockToast.mockClear();
  });

  it("shows 'No trail points recorded' toast when stop is clicked with zero points", async () => {
    // Put the store in an active recording session with no collected points
    useTrailStore.setState({
      recording: true,
      currentPoints: [],
      startedAt: Date.now(),
    });

    render(<TrailRecorder />);

    const stopBtn = screen.getByTestId("trail-stop-btn");
    fireEvent.click(stopBtn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "No trail points recorded" }),
      );
    });
  });

  it("does NOT show the no-points toast when stop is clicked with collected points", async () => {
    // terrain is null so the save path bails after the point check — that's fine
    useTrailStore.setState({
      recording: true,
      currentPoints: [{ lon: 1, lat: 2, accuracy: 3, timestamp: 100, seq: 0 }],
      startedAt: Date.now(),
    });

    render(<TrailRecorder />);

    const stopBtn = screen.getByTestId("trail-stop-btn");
    fireEvent.click(stopBtn);

    // Wait a tick for async handleStop to start
    await new Promise((r) => setTimeout(r, 10));

    // No "No trail points recorded" toast
    const noPointsCalls = mockToast.mock.calls.filter(
      ([arg]) => arg.title === "No trail points recorded",
    );
    expect(noPointsCalls).toHaveLength(0);
  });

  it("shows the draft-recovery banner when draftTrail is set and not recording", () => {
    useTrailStore.setState({
      recording: false,
      draftTrail: {
        points: [{ lon: 5, lat: 6, accuracy: 1, timestamp: 50, seq: 0 }],
        startedAt: Date.now() - 60_000,
        sessionSeq: 1,
      },
    });

    render(<TrailRecorder />);

    expect(screen.getByTestId("trail-draft-banner")).toBeInTheDocument();
    expect(screen.getByTestId("trail-draft-resume-btn")).toBeInTheDocument();
    expect(screen.getByTestId("trail-draft-discard-btn")).toBeInTheDocument();
  });

  it("hides the draft-recovery banner when there is no draft", () => {
    useTrailStore.setState({ recording: false, draftTrail: null });

    render(<TrailRecorder />);

    expect(screen.queryByTestId("trail-draft-banner")).toBeNull();
  });
});
