/**
 * Pure tide-prediction helpers for the NOAA 31-day / 6-minute prediction
 * window served by GET /api/tides/:stationId.
 *
 * Kept free of store/React imports so interpolation boundary behaviour can
 * be unit-tested in isolation.
 */

/** One raw prediction sample from the API: ISO-8601 timestamp + feet above MLLW. */
export interface RawTideSample {
  t: string;
  v: number;
}

/** A prepared sample with the timestamp pre-parsed to epoch milliseconds. */
export interface TideSample {
  tMs: number;
  v: number;
}

export const FEET_TO_METERS = 0.3048;

/**
 * Parse and sort raw API samples into epoch-ms samples ready for binary
 * search. Non-finite values and unparseable timestamps are dropped.
 */
export function prepareTideSamples(raw: RawTideSample[]): TideSample[] {
  const out: TideSample[] = [];
  for (const s of raw) {
    const tMs = Date.parse(s.t);
    if (!Number.isFinite(tMs) || !Number.isFinite(s.v)) continue;
    out.push({ tMs, v: s.v });
  }
  out.sort((a, b) => a.tMs - b.tMs);
  return out;
}

/**
 * Interpolated tide height (feet above MLLW) at an arbitrary time.
 *
 * - Empty input → null.
 * - Times at/before the first sample clamp to the first sample's value.
 * - Times at/after the last sample clamp to the last sample's value.
 * - Otherwise linear interpolation between the two bracketing 6-minute
 *   samples (binary search, O(log n)).
 */
export function interpolateTideHeightFt(
  samples: TideSample[],
  timeMs: number,
): number | null {
  const n = samples.length;
  if (n === 0 || !Number.isFinite(timeMs)) return null;
  const first = samples[0]!;
  const last = samples[n - 1]!;
  if (timeMs <= first.tMs) return first.v;
  if (timeMs >= last.tMs) return last.v;

  // Binary search for the greatest index with tMs <= timeMs.
  let lo = 0;
  let hi = n - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.tMs <= timeMs) lo = mid;
    else hi = mid;
  }
  const a = samples[lo]!;
  const b = samples[hi]!;
  if (b.tMs === a.tMs) return a.v;
  const frac = (timeMs - a.tMs) / (b.tMs - a.tMs);
  return a.v + (b.v - a.v) * frac;
}

/** A local high or low tide extreme derived from the prediction series. */
export interface TideExtreme {
  tMs: number;
  v: number;
  kind: "high" | "low";
}

/**
 * Derive local high/low tide extremes from a prepared (sorted) sample series.
 *
 * A sample is a high when it is >= both neighbours and strictly greater than
 * at least one of them (mirrored for lows), which tolerates the flat
 * plateaus a 6-minute series produces near slack. Consecutive plateau
 * samples emit only one extreme (the plateau midpoint). Window endpoints are
 * never reported as extremes since they are artifacts of the cached window.
 */
export function findTideExtremes(samples: TideSample[]): TideExtreme[] {
  const n = samples.length;
  if (n < 3) return [];
  const out: TideExtreme[] = [];
  let i = 1;
  while (i < n - 1) {
    const prev = samples[i - 1]!.v;
    const cur = samples[i]!.v;
    // Extend across a flat plateau.
    let j = i;
    while (j < n - 1 && samples[j + 1]!.v === cur) j++;
    if (j >= n - 1) break;
    const next = samples[j + 1]!.v;
    const mid = samples[(i + j) >> 1]!;
    if (cur > prev && cur > next) {
      out.push({ tMs: mid.tMs, v: cur, kind: "high" });
    } else if (cur < prev && cur < next) {
      out.push({ tMs: mid.tMs, v: cur, kind: "low" });
    }
    i = j + 1;
  }
  return out;
}

/** Extremes falling within [startMs, endMs). */
export function extremesInRange(
  extremes: TideExtreme[],
  startMs: number,
  endMs: number,
): TideExtreme[] {
  return extremes.filter((e) => e.tMs >= startMs && e.tMs < endMs);
}

/** Convenience: interpolated height converted to metres above MLLW. */
export function interpolateTideHeightMeters(
  samples: TideSample[],
  timeMs: number,
): number | null {
  const ft = interpolateTideHeightFt(samples, timeMs);
  return ft === null ? null : ft * FEET_TO_METERS;
}
