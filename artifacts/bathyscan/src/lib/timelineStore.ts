/**
 * useTimelineStore — global time state for the timeline scrubber bar.
 *
 * Drives all time-sensitive overlays (tide, currents, weather) from a single
 * time source. The scrubber bar reads/writes this store; overlays will be
 * wired to consume it in the next task.
 *
 * currentTime and timeRange are written back to settingsStore as ISO strings
 * for best-effort session restore on the next page load.
 */
import { create } from "zustand";
import { useSettingsStore } from "./settingsStore";

export interface TimeRange {
  start: Date;
  end: Date;
}

interface TimelineStore {
  currentTime: Date;
  timeRange: TimeRange;
  isPlaying: boolean;
  setTime: (t: Date) => void;
  setRange: (range: TimeRange) => void;
  setPlaying: (p: boolean) => void;
}

function defaultRange(): TimeRange {
  const now = new Date();
  return {
    start: new Date(now.getTime() - 12 * 3_600_000),
    end: new Date(now.getTime() + 12 * 3_600_000),
  };
}

function initialState(): { currentTime: Date; timeRange: TimeRange } {
  try {
    const s = useSettingsStore.getState();
    const storedTime = s.timelineCurrentTime ? new Date(s.timelineCurrentTime) : null;
    const storedRange = s.timelineRange
      ? {
          start: new Date(s.timelineRange.start),
          end: new Date(s.timelineRange.end),
        }
      : null;

    const timeRange =
      storedRange &&
      !isNaN(storedRange.start.getTime()) &&
      !isNaN(storedRange.end.getTime()) &&
      storedRange.end > storedRange.start
        ? storedRange
        : defaultRange();

    const now = new Date();
    const rawTime =
      storedTime && !isNaN(storedTime.getTime()) ? storedTime : now;

    const currentTime = new Date(
      Math.min(
        Math.max(rawTime.getTime(), timeRange.start.getTime()),
        timeRange.end.getTime(),
      ),
    );
    return { currentTime, timeRange };
  } catch {
    const timeRange = defaultRange();
    return { currentTime: new Date(), timeRange };
  }
}

export const useTimelineStore = create<TimelineStore>((set) => {
  const { currentTime, timeRange } = initialState();
  return {
    currentTime,
    timeRange,
    isPlaying: false,

    setTime: (t) => {
      let clamped: Date | undefined;
      set((state) => {
        clamped = new Date(
          Math.min(
            Math.max(t.getTime(), state.timeRange.start.getTime()),
            state.timeRange.end.getTime(),
          ),
        );
        return { currentTime: clamped };
      });
      // Persist the clamped value so stored time is always within the range
      useSettingsStore.setState({ timelineCurrentTime: (clamped ?? t).toISOString() });
    },

    setRange: (range) => {
      set((state) => {
        const clampedTime = new Date(
          Math.min(
            Math.max(state.currentTime.getTime(), range.start.getTime()),
            range.end.getTime(),
          ),
        );
        return { timeRange: range, currentTime: clampedTime };
      });
      useSettingsStore.setState({
        timelineRange: {
          start: range.start.toISOString(),
          end: range.end.toISOString(),
        },
      });
    },

    setPlaying: (p) => set({ isPlaying: p }),
  };
});
