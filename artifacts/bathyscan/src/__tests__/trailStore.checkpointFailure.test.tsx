/**
 * Trail draft checkpoint silent-failure warning.
 *
 * When sessionStorage is unavailable (private browsing, quota exhausted,
 * storage policy), every draft checkpoint fails. Previously saveDraft()
 * swallowed the exception with a bare catch {} and the user believed their
 * track was being backed up. Now the first failure sets
 * `draftCheckpointFailed` in trailStore, TrailRecorder renders a persistent
 * amber banner while recording, and the flag is cleared when recording stops.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrailRecorder } from "@/components/TrailRecorder";
import { useTrailStore, __resetSessionSeqForTests } from "@/lib/trailStore";

// ── mocks (component render only — store tests use the real modules) ─────────

vi.mock("@/lib/gpsStore", () => ({
  useGpsStore: Object.assign(
    (selector: (s: { active: boolean }) => unknown) => selector({ active: true }),
    { getState: () => ({ active: true, position: null }) },
  ),
}));

vi.mock("@/lib/settingsStore", () => {
  const state = {
    gpsRecordingInterval: 10_000,
    setGpsRecordingInterval: vi.fn(),
    defaultTrailColor: "#ff6600",
  };
  return {
    useSettingsStore: Object.assign(
      (selector: (s: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
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

// ── helpers ──────────────────────────────────────────────────────────────────

const DRAFT_CHECKPOINT_EVERY = 10;

function makePos(lon = 0) {
  return {
    longitude: lon,
    latitude: 0,
    accuracy: 1,
    timestamp: Date.now(),
    speed: null,
    heading: null,
  };
}

function resetStore() {
  useTrailStore.setState({
    recording: false,
    currentPoints: [],
    startedAt: null,
    intervalId: null,
    beforeUnloadCleanup: null,
    isOverflowing: false,
    draftTrail: null,
    draftCheckpointFailed: false,
  });
  __resetSessionSeqForTests();
}

/** Add enough points to cross exactly one checkpoint interval. */
function addOneCheckpointBatch() {
  const { addPoint } = useTrailStore.getState();
  for (let i = 0; i < DRAFT_CHECKPOINT_EVERY; i++) addPoint(makePos(i));
}

// ── store-level tests ─────────────────────────────────────────────────────────

describe("trailStore — draft checkpoint failure flag", () => {
  let setItemSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    resetStore();
    sessionStorage.clear();
  });

  afterEach(() => {
    setItemSpy?.mockRestore();
    setItemSpy = null;
  });

  it("sets draftCheckpointFailed when sessionStorage.setItem throws at the checkpoint", () => {
    setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });

    useTrailStore.setState({ recording: true, startedAt: Date.now() });
    expect(useTrailStore.getState().draftCheckpointFailed).toBe(false);

    addOneCheckpointBatch();

    expect(useTrailStore.getState().draftCheckpointFailed).toBe(true);
    // The points themselves are still collected — only the backup failed.
    expect(useTrailStore.getState().currentPoints).toHaveLength(DRAFT_CHECKPOINT_EVERY);
  });

  it("keeps the flag set (no churn) across subsequent failing checkpoints", () => {
    setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });

    useTrailStore.setState({ recording: true, startedAt: Date.now() });
    addOneCheckpointBatch();
    expect(useTrailStore.getState().draftCheckpointFailed).toBe(true);

    // Subscription must NOT fire again for later failures — flag is set once.
    const listener = vi.fn();
    const unsubscribe = useTrailStore.subscribe((state, prev) => {
      if (state.draftCheckpointFailed !== prev.draftCheckpointFailed) listener();
    });
    addOneCheckpointBatch(); // second failing checkpoint
    unsubscribe();

    expect(useTrailStore.getState().draftCheckpointFailed).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it("does NOT set the flag when sessionStorage works normally", () => {
    useTrailStore.setState({ recording: true, startedAt: Date.now() });
    addOneCheckpointBatch();

    expect(useTrailStore.getState().draftCheckpointFailed).toBe(false);
    expect(sessionStorage.getItem("bathyscan-trail-draft")).not.toBeNull();
  });

  it("clears the flag when recording stops", () => {
    useTrailStore.setState({ recording: true, startedAt: Date.now(), draftCheckpointFailed: true });

    useTrailStore.getState().stopRecording();

    expect(useTrailStore.getState().draftCheckpointFailed).toBe(false);
  });

  it("clears the flag when a session is discarded via clearPoints", () => {
    useTrailStore.setState({ draftCheckpointFailed: true });

    useTrailStore.getState().clearPoints();

    expect(useTrailStore.getState().draftCheckpointFailed).toBe(false);
  });

  it("markCheckpointFailed is idempotent", () => {
    const { markCheckpointFailed } = useTrailStore.getState();
    markCheckpointFailed();
    expect(useTrailStore.getState().draftCheckpointFailed).toBe(true);
    markCheckpointFailed(); // no throw, no change
    expect(useTrailStore.getState().draftCheckpointFailed).toBe(true);
  });
});

// ── component-level tests ─────────────────────────────────────────────────────

describe("TrailRecorder — checkpoint-failure warning banner", () => {
  beforeEach(() => {
    resetStore();
    sessionStorage.clear();
  });

  it("renders the persistent amber warning while recording with the flag set", () => {
    useTrailStore.setState({
      recording: true,
      startedAt: Date.now(),
      draftCheckpointFailed: true,
    });

    render(<TrailRecorder />);

    const warning = screen.getByTestId("trail-checkpoint-failed-warning");
    expect(warning).toBeInTheDocument();
    expect(warning.textContent).toContain(
      "Auto-backup unavailable — stop and save now to preserve your track.",
    );
    // Must sit alongside the Stop button (recording branch), not a toast.
    expect(screen.getByTestId("trail-stop-btn")).toBeInTheDocument();
  });

  it("does not render the warning during a healthy recording session", () => {
    useTrailStore.setState({
      recording: true,
      startedAt: Date.now(),
      draftCheckpointFailed: false,
    });

    render(<TrailRecorder />);

    expect(screen.queryByTestId("trail-checkpoint-failed-warning")).toBeNull();
  });

  it("does not render the warning when not recording", () => {
    // Flag true but idle — banner is scoped to the active-recording branch.
    useTrailStore.setState({ recording: false, draftCheckpointFailed: true });

    render(<TrailRecorder />);

    expect(screen.queryByTestId("trail-checkpoint-failed-warning")).toBeNull();
  });
});
