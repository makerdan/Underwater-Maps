/**
 * slack.ts — Shared slack-tide model used by /api/tidal and
 * /api/surface-conditions.
 *
 * Models tidal current speed/direction as a smooth sinusoid between
 * consecutive high/low events (slacks). Speed is zero at each event,
 * peaks midway, and direction flips through the slack window.
 *
 * When NOAA hi/lo data is unavailable, synthesizes a semi-diurnal
 * (period 12h 25m) cycle anchored to local solar noon at the supplied
 * longitude.
 */

export type TidePhase = "flooding" | "ebbing" | "slack-high" | "slack-low";

export interface TideEvent {
  type: "high" | "low";
  /** ms since epoch */
  time: number;
  height: number;
}

export interface SlackBlock {
  isSlack: boolean;
  phase: TidePhase;
  minutesToSlack: number;
  minutesSinceSlack: number;
  /** ISO timestamp of the next slack (= next high/low) */
  nextReversalAt: string;
}

export interface SlackSample {
  speedKnots: number;
  directionDeg: number;
  slack: SlackBlock;
}

export interface SlackOptions {
  /** High/low events sorted ascending. Must cover at least
   * [refTime - ~12h, refTime + ~12h] for accurate sampling. */
  events: TideEvent[];
  /** ms since epoch */
  refTime: number;
  /** Peak current at mid-cycle, in knots */
  peakSpeedKnots: number;
  /** Bearing (deg, 0=N) the current flows TOWARD during flood */
  floodBearingDeg: number;
  /** Speed below which the current is considered slack. Default 0.1 kn. */
  slackThresholdKnots?: number;
}

export const SEMI_DIURNAL_MS = (12 * 60 + 25) * 60 * 1000; // 12h 25m
export const SLACK_THRESHOLD_DEFAULT = 0.1;

/**
 * Generate a synthetic high/low schedule for a region with no nearby
 * NOAA station. Uses a semi-diurnal (12h 25m) cycle anchored to local
 * solar noon at the given longitude on the day surrounding refTime.
 *
 * Returns enough events to safely cover refTime ± `daysSpan` days.
 */
export function buildSyntheticEvents(
  refTime: number,
  lon: number,
  daysSpan = 8,
): TideEvent[] {
  // Local solar noon UTC = 12:00 UTC shifted by -lon/15 hours
  const solarNoonOffsetMs = -(lon / 15) * 3600 * 1000;
  const refDate = new Date(refTime);
  const utcMidnight = Date.UTC(
    refDate.getUTCFullYear(),
    refDate.getUTCMonth(),
    refDate.getUTCDate(),
  );
  const anchor = utcMidnight + 12 * 3600 * 1000 + solarNoonOffsetMs;

  // Place a HIGH at anchor (arbitrary but deterministic), then alternate
  // every SEMI_DIURNAL_MS / 2.
  const halfPeriod = SEMI_DIURNAL_MS / 2;
  const events: TideEvent[] = [];
  const totalSteps = daysSpan * 4 + 4; // ~4 hi/lo per day
  for (let i = -totalSteps; i <= totalSteps; i++) {
    const t = anchor + i * halfPeriod;
    const isHigh = i % 2 === 0;
    events.push({
      type: isHigh ? "high" : "low",
      time: t,
      height: isHigh ? 1.5 : -0.5,
    });
  }
  events.sort((a, b) => a.time - b.time);
  return events;
}

/**
 * Compute slack/speed/direction at refTime given surrounding events.
 */
export function computeSlackSample(opts: SlackOptions): SlackSample {
  const { events, refTime, peakSpeedKnots, floodBearingDeg } = opts;
  const threshold = opts.slackThresholdKnots ?? SLACK_THRESHOLD_DEFAULT;
  const ebbBearingDeg = (floodBearingDeg + 180) % 360;

  // Find bracketing events
  let prev: TideEvent | null = null;
  let next: TideEvent | null = null;
  for (const e of events) {
    if (e.time <= refTime) prev = e;
    else if (!next) {
      next = e;
      break;
    }
  }

  // If we lack a bracket on either side, fall back to a semi-diurnal step
  if (!prev || !next) {
    const halfPeriod = SEMI_DIURNAL_MS / 2;
    if (!prev && next) {
      prev = {
        type: next.type === "high" ? "low" : "high",
        time: next.time - halfPeriod,
        height: -next.height,
      };
    } else if (prev && !next) {
      next = {
        type: prev.type === "high" ? "low" : "high",
        time: prev.time + halfPeriod,
        height: -prev.height,
      };
    } else {
      // No events at all — synthesize a window around refTime
      prev = { type: "low", time: refTime - halfPeriod / 2, height: -0.5 };
      next = { type: "high", time: refTime + halfPeriod / 2, height: 1.5 };
    }
  }

  const span = Math.max(1, next.time - prev.time);
  const t = (refTime - prev.time) / span; // 0..1
  // |sin(π t)| → 0 at t=0, t=1; 1 at t=0.5
  const speedKnots = Math.abs(Math.sin(Math.PI * t)) * peakSpeedKnots;

  // Direction: flooding on low→high half; ebbing on high→low half.
  const flooding = prev.type === "low" && next.type === "high";
  const directionDeg = flooding ? floodBearingDeg : ebbBearingDeg;

  const isSlack = speedKnots < threshold;

  // Nearest slack event in time
  const distPrev = refTime - prev.time;
  const distNext = next.time - refTime;
  const nearestIsPrev = distPrev <= distNext;
  const nearestEvent = nearestIsPrev ? prev : next;

  let phase: TidePhase;
  if (isSlack) {
    phase = nearestEvent.type === "high" ? "slack-high" : "slack-low";
  } else {
    phase = flooding ? "flooding" : "ebbing";
  }

  const minutesToSlack = Math.max(0, Math.round(distNext / 60000));
  const minutesSinceSlack = Math.max(0, Math.round(distPrev / 60000));

  return {
    speedKnots,
    directionDeg,
    slack: {
      isSlack,
      phase,
      minutesToSlack,
      minutesSinceSlack,
      nextReversalAt: new Date(next.time).toISOString(),
    },
  };
}

/**
 * Convenience: build a tidal sample using a synthetic semi-diurnal
 * schedule (used when no NOAA station is in range).
 */
export function syntheticSlackSample(
  refTime: number,
  lon: number,
  floodBearingDeg: number,
  peakSpeedKnots: number,
  slackThresholdKnots?: number,
): SlackSample {
  const events = buildSyntheticEvents(refTime, lon);
  return computeSlackSample({
    events,
    refTime,
    peakSpeedKnots,
    floodBearingDeg,
    slackThresholdKnots,
  });
}
