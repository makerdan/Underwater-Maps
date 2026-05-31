/**
 * fishingWindows.ts — Pure utility for computing tide-aware fishing windows.
 *
 * Crosses the tidal schedule (already loaded by useTidalSchedule) with a
 * species' tidalPreference to return up to 3 scored time windows per day,
 * grouped across up to 3 days.
 *
 * Rules:
 *   "slack"  — windows are the pre-computed slack windows from the schedule
 *              (±~45 min around each high/low slack). Stars based on tide type:
 *              high-water slack = 3 ★ (prey congregates), low-water slack = 2 ★.
 *   "ebb"    — 90-min window centered on mid-ebb (midpoint between high→low).
 *              All get 3 ★ (peak scavenger activity).
 *   "flood"  — 90-min window centered on mid-flood (midpoint between low→high).
 *              All get 3 ★.
 *   "any"    — returns [] (no tidal preference).
 */
import type { TidalSchedule, TidalScheduleEvent } from "@/hooks/useTidalSchedule";
import type { TidalPreference } from "@/lib/habitat";

export interface FishingWindow {
  /** ISO string — start of the fishing window. */
  start: string;
  /** ISO string — end of the fishing window. */
  end: string;
  /** Human-readable tidal phase label. */
  phaseLabel: string;
  /** 1–3 stars; higher = better for the species. */
  stars: 1 | 2 | 3;
  /**
   * The exact tidal event time to snap the TidePanel scrubber to when the
   * user clicks this window.
   */
  scrubTarget: Date;
}

export interface DayWindows {
  /** 0 = today, 1 = tomorrow, 2 = day after tomorrow. */
  dayOffset: number;
  /** "Today", "Fri May 31", "Sat Jun 1", etc. */
  dayLabel: string;
  /** UTC midnight of this day. */
  date: Date;
  /** Up to 3 windows for this day. */
  windows: FishingWindow[];
}

/** Returns today's UTC midnight as a timestamp. */
function todayUtcMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Returns the UTC day bounds {start, end} for a given offset from today. */
function dayBoundsUtcMs(offset: number): { start: number; end: number } {
  const start = todayUtcMs() + offset * 86_400_000;
  return { start, end: start + 86_400_000 };
}

/** Returns a human-readable label for the given day offset. */
function makeDayLabel(offset: number): string {
  if (offset === 0) return "Today";
  const d = new Date(todayUtcMs() + offset * 86_400_000);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Formats a Date to a UTC time string like "06:30". */
function fmtTime(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Slack windows for "slack" preference within a specific UTC day range. */
function slackWindowsForDay(
  events: TidalScheduleEvent[],
  dayStart: number,
  dayEnd: number,
): FishingWindow[] {
  const out: FishingWindow[] = [];

  for (const e of events) {
    const centerMs = new Date(e.time).getTime();
    if (!Number.isFinite(centerMs)) continue;
    const wsMs = new Date(e.windowStart).getTime();
    const weMs = new Date(e.windowEnd).getTime();
    if (!Number.isFinite(wsMs) || !Number.isFinite(weMs)) continue;
    if (weMs < dayStart || wsMs >= dayEnd) continue;

    const scrubTarget = new Date(centerMs);
    const stars: 1 | 2 | 3 = e.type === "high" ? 3 : 2;
    const phaseLabel =
      e.type === "high" ? "High-water slack" : "Low-water slack";

    out.push({
      start: e.windowStart,
      end: e.windowEnd,
      phaseLabel,
      stars,
      scrubTarget,
    });

    if (out.length >= 3) break;
  }

  return out;
}

/**
 * Mid-phase windows for "ebb" or "flood" preference within a specific UTC day range.
 *
 * Ebb:   mid-point of each high → low pair.
 * Flood: mid-point of each low → high pair.
 */
function midPhaseWindowsForDay(
  events: TidalScheduleEvent[],
  phase: "ebb" | "flood",
  dayStart: number,
  dayEnd: number,
): FishingWindow[] {
  const HALF_WINDOW_MS = 45 * 60 * 1000;
  const out: FishingWindow[] = [];

  const fromType = phase === "ebb" ? "high" : "low";
  const toType = phase === "ebb" ? "low" : "high";

  for (let i = 0; i < events.length - 1; i++) {
    const a = events[i];
    const b = events[i + 1];
    if (!a || !b) continue;
    if (a.type !== fromType || b.type !== toType) continue;

    const aMs = new Date(a.time).getTime();
    const bMs = new Date(b.time).getTime();
    if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) continue;

    const midMs = (aMs + bMs) / 2;
    if (midMs + HALF_WINDOW_MS < dayStart || midMs - HALF_WINDOW_MS >= dayEnd) continue;

    const scrubTarget = new Date(midMs);
    const phaseLabel =
      phase === "ebb"
        ? `Ebb mid-tide (~${fmtTime(scrubTarget)} UTC)`
        : `Flood mid-tide (~${fmtTime(scrubTarget)} UTC)`;

    out.push({
      start: new Date(midMs - HALF_WINDOW_MS).toISOString(),
      end: new Date(midMs + HALF_WINDOW_MS).toISOString(),
      phaseLabel,
      stars: 3,
      scrubTarget,
    });

    if (out.length >= 3) break;
  }

  return out;
}

/**
 * Compute up to 3 fishing windows per day for the next `numDays` days,
 * based on the tidal schedule and the species' tidal preference.
 *
 * Returns [] when:
 *   - `schedule` is null or not available.
 *   - `preference` is "any".
 *   - No suitable events fall within the covered range.
 *
 * Days with no windows are still included in the result (empty windows array)
 * so the UI can render a "no windows" state per day if desired.
 */
export function computeFishingWindowsByDay(
  schedule: TidalSchedule | null,
  preference: TidalPreference,
  numDays = 3,
): DayWindows[] {
  if (!schedule || !schedule.available || preference === "any") return [];
  if (schedule.events.length === 0) return [];

  const events = [...schedule.events].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
  );

  const result: DayWindows[] = [];

  for (let offset = 0; offset < numDays; offset++) {
    const { start, end } = dayBoundsUtcMs(offset);

    let windows: FishingWindow[];
    switch (preference) {
      case "slack":
        windows = slackWindowsForDay(events, start, end);
        break;
      case "ebb":
        windows = midPhaseWindowsForDay(events, "ebb", start, end);
        break;
      case "flood":
        windows = midPhaseWindowsForDay(events, "flood", start, end);
        break;
      default:
        windows = [];
    }

    result.push({
      dayOffset: offset,
      dayLabel: makeDayLabel(offset),
      date: new Date(start),
      windows,
    });
  }

  return result;
}

/**
 * Compute up to 3 fishing windows for today only.
 * Kept for backward compatibility; prefer computeFishingWindowsByDay.
 */
export function computeFishingWindows(
  schedule: TidalSchedule | null,
  preference: TidalPreference,
): FishingWindow[] {
  const days = computeFishingWindowsByDay(schedule, preference, 1);
  return days[0]?.windows ?? [];
}

/**
 * Returns true when `now` falls within the window's start–end range (inclusive).
 * Works whether `now` is a real clock time or a scrubber-snapped datetime.
 */
export function isWindowActive(window: FishingWindow, now: Date): boolean {
  const startMs = new Date(window.start).getTime();
  const endMs = new Date(window.end).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return nowMs >= startMs && nowMs <= endMs;
}

/** Format a UTC ISO string as "HH:MM" for display. */
export function formatWindowTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "--:--";
  return fmtTime(d);
}

/** Format a window as "HH:MM – HH:MM UTC". */
export function formatWindowRange(start: string, end: string): string {
  return `${formatWindowTime(start)} – ${formatWindowTime(end)} UTC`;
}
