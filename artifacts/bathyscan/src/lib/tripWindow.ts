/**
 * tripWindow.ts — Pure logic for the Trip Window finder.
 *
 * Groups the 48-hour surface forecast into contiguous stretches of equal
 * "boatability" (go / marginal / no-go) and filters them by the user's
 * minimum trip duration so 1-hour slivers don't masquerade as usable outings.
 *
 * Verdict thresholds (aligned with ForecastStrip's constants):
 *   go       — wind < 12 kn AND wave < 0.8 m  (good fishing conditions)
 *   no-go    — wind ≥ 22 kn OR  wave ≥ 1.5 m  ("Rough" per conditionLabel)
 *   marginal — everything in between
 */

export type TripVerdict = "go" | "marginal" | "no-go";

/** Structural subset of the generated ForecastHour used by this module. */
export interface TripForecastHour {
  /** Hour offset relative to "now" (0–47). */
  relHour: number;
  /** UTC ISO timestamp of the top of this hour. */
  isoTime: string;
  windSpeedKnots: number;
  waveHeightM: number;
}

export interface TripWindow {
  verdict: TripVerdict;
  /** ISO start of the first hour in the stretch. */
  startIso: string;
  /** ISO start of the hour AFTER the last hour (exclusive end). */
  endIso: string;
  /** relHour of the first hour (for scrubber snapping). */
  startRelHour: number;
  /** Contiguous length in whole hours. */
  durationH: number;
  /** Worst wind across the stretch (kn). */
  maxWindKt: number;
  /** Worst wave across the stretch (m). */
  maxWaveM: number;
}

/** Trip-length choices offered by the panel. 0 = no minimum. */
export const TRIP_LENGTH_OPTIONS_H = [0, 2, 4, 6] as const;

export const GO_WIND_KN = 12;
export const GO_WAVE_M = 0.8;
export const NOGO_WIND_KN = 22;
export const NOGO_WAVE_M = 1.5;

/** User-tunable thresholds for the Trip Window classifier. */
export interface TripThresholds {
  goWindKn: number;
  goWaveM: number;
  noGoWindKn: number;
  noGoWaveM: number;
}

/** Default thresholds that match today's fixed constants. */
export const DEFAULT_TRIP_THRESHOLDS: TripThresholds = {
  goWindKn: GO_WIND_KN,
  goWaveM: GO_WAVE_M,
  noGoWindKn: NOGO_WIND_KN,
  noGoWaveM: NOGO_WAVE_M,
};

/** Classify a single forecast hour as go / marginal / no-go. */
export function classifyHour(
  h: TripForecastHour,
  thresholds: TripThresholds = DEFAULT_TRIP_THRESHOLDS,
): TripVerdict {
  if (h.windSpeedKnots >= thresholds.noGoWindKn || h.waveHeightM >= thresholds.noGoWaveM) {
    return "no-go";
  }
  if (h.windSpeedKnots < thresholds.goWindKn && h.waveHeightM < thresholds.goWaveM) {
    return "go";
  }
  return "marginal";
}

/**
 * Merge the hourly forecast into contiguous same-verdict stretches.
 *
 * Hours must be sorted by relHour (as delivered by the API). A gap in
 * relHour (missing hour) always breaks the current stretch — a window must
 * be genuinely contiguous to count toward a trip duration. Hours with
 * non-finite wind/wave values are skipped (and break the stretch).
 */
export function computeTripWindows(
  hours: TripForecastHour[],
  thresholds: TripThresholds = DEFAULT_TRIP_THRESHOLDS,
): TripWindow[] {
  const out: TripWindow[] = [];
  let cur: TripWindow | null = null;
  let prevRelHour: number | null = null;

  for (const h of hours) {
    if (
      !Number.isFinite(h.windSpeedKnots) ||
      !Number.isFinite(h.waveHeightM) ||
      !Number.isFinite(new Date(h.isoTime).getTime())
    ) {
      cur = null;
      prevRelHour = null;
      continue;
    }

    const verdict = classifyHour(h, thresholds);
    const contiguous = prevRelHour !== null && h.relHour === prevRelHour + 1;

    if (cur && contiguous && cur.verdict === verdict) {
      cur.durationH += 1;
      cur.endIso = new Date(new Date(h.isoTime).getTime() + 3_600_000).toISOString();
      cur.maxWindKt = Math.max(cur.maxWindKt, h.windSpeedKnots);
      cur.maxWaveM = Math.max(cur.maxWaveM, h.waveHeightM);
    } else {
      cur = {
        verdict,
        startIso: h.isoTime,
        endIso: new Date(new Date(h.isoTime).getTime() + 3_600_000).toISOString(),
        startRelHour: h.relHour,
        durationH: 1,
        maxWindKt: h.windSpeedKnots,
        maxWaveM: h.waveHeightM,
      };
      out.push(cur);
    }
    prevRelHour = h.relHour;
  }

  return out;
}

/** True when the window is long enough for the chosen minimum trip length. */
export function meetsMinDuration(w: TripWindow, minDurationH: number): boolean {
  return w.durationH >= Math.max(0, minDurationH);
}

/**
 * The single best usable stretch for the chosen trip length, or null.
 *
 * Ranking: only go/marginal windows meeting the minimum duration qualify;
 * "go" beats "marginal"; then longer beats shorter; then earlier beats later.
 */
export function findBestTripWindow(
  windows: TripWindow[],
  minDurationH: number,
): TripWindow | null {
  let best: TripWindow | null = null;
  for (const w of windows) {
    if (w.verdict === "no-go" || !meetsMinDuration(w, minDurationH)) continue;
    if (
      !best ||
      (w.verdict === "go" && best.verdict !== "go") ||
      (w.verdict === best.verdict && w.durationH > best.durationH)
    ) {
      best = w;
    }
  }
  return best;
}

/** Format an ISO timestamp as "HH:MM" UTC. */
export function formatTripTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "--:--";
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Format a window's time span as "HH:MM – HH:MM UTC". */
export function formatTripRange(w: TripWindow): string {
  return `${formatTripTime(w.startIso)} – ${formatTripTime(w.endIso)} UTC`;
}
