/**
 * fishingWindows.ts — Pure utility for computing tide-aware fishing windows.
 *
 * Crosses the tidal schedule (already loaded by useTidalSchedule) with a
 * species' tidalPreference to return up to 3 scored time windows for today.
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

/** Returns today's UTC midnight as a timestamp. */
function todayUtcMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Returns tomorrow's UTC midnight as a timestamp. */
function tomorrowUtcMs(): number {
  return todayUtcMs() + 86_400_000;
}

/** Formats a Date to a local time string like "06:30" using UTC hours/minutes. */
function fmtTime(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Slack windows for "slack" preference — pulled directly from schedule events. */
function slackWindows(events: TidalScheduleEvent[]): FishingWindow[] {
  const dayStart = todayUtcMs();
  const dayEnd = tomorrowUtcMs();
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
 * Mid-phase windows for "ebb" or "flood" preference.
 *
 * Ebb:   mid-point of each high → low pair.
 * Flood: mid-point of each low → high pair.
 */
function midPhaseWindows(
  events: TidalScheduleEvent[],
  phase: "ebb" | "flood",
): FishingWindow[] {
  const dayStart = todayUtcMs();
  const dayEnd = tomorrowUtcMs();
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
 * Compute up to 3 fishing windows for today based on the tidal schedule
 * and the species' tidal preference.
 *
 * Returns [] when:
 *   - `schedule` is null or not available.
 *   - `preference` is "any".
 *   - No suitable events fall within today's UTC day.
 */
export function computeFishingWindows(
  schedule: TidalSchedule | null,
  preference: TidalPreference,
): FishingWindow[] {
  if (!schedule || !schedule.available || preference === "any") return [];
  if (schedule.events.length === 0) return [];

  const events = [...schedule.events].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
  );

  switch (preference) {
    case "slack":
      return slackWindows(events);
    case "ebb":
      return midPhaseWindows(events, "ebb");
    case "flood":
      return midPhaseWindows(events, "flood");
    default:
      return [];
  }
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
