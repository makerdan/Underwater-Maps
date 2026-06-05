/**
 * etaCalibration.ts
 *
 * Per-file-type throughput calibration table and ETA estimation logic.
 *
 * Maintains a bounded in-process history of total job durations (ms) keyed by
 * file extension.  The first ETA estimate for a new job seeds from this table
 * when fewer than 2 live milestones have been recorded, then blends out as
 * live milestone data accumulates.  Not persisted across restarts — the table
 * bootstraps itself after the first few jobs of each type in a new process.
 */

export const CALIBRATION_MAX_SAMPLES = 10;
export const extensionDurationHistory = new Map<string, number[]>();

/**
 * A milestone is skipped (not pushed to the ring buffer) when BOTH the elapsed
 * time AND the progress delta since the previous milestone are below these
 * thresholds.  Coalescing rapid, small-step milestones prevents the next
 * legitimate delta from spanning a large progress gap over a tiny wall-clock
 * interval, which would otherwise produce an unrealistically fast rate and a
 * backwards-jumping ETA.
 */
export const MIN_MILESTONE_DELTA_MS = 500;
export const MIN_MILESTONE_DELTA_PROGRESS = 3;

/**
 * Minimal job-state shape required by updateProgressWithEta.
 * The full JobState in datasets.ts satisfies this interface structurally.
 */
export interface EtaJobState {
  progress: number;
  stageTimestamps?: Array<{ progress: number; ts: number }>;
  eta?: number | null;
  stageStartedAt?: Date | null;
  soundingCount?: number;
  fileExt?: string;
  jobStartedAt?: number;
  fileBytes?: number;
}

/**
 * Record a completed job's total wall-clock duration (ms) for the given file
 * extension.  Bounded to the last CALIBRATION_MAX_SAMPLES entries.
 */
export function recordExtensionDuration(ext: string, durationMs: number): void {
  if (!ext) return;
  const arr = extensionDurationHistory.get(ext) ?? [];
  arr.push(durationMs);
  if (arr.length > CALIBRATION_MAX_SAMPLES) arr.shift();
  extensionDurationHistory.set(ext, arr);
}

/**
 * Returns the median of recorded durations for an extension, or null if no
 * history is available.
 */
export function historicalMedianMs(ext: string): number | null {
  const arr = extensionDurationHistory.get(ext);
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Record a progress milestone timestamp on the job and recompute ETA.
 *
 * Three-tier estimation strategy:
 *
 * 1. Pre-2-milestones (assembly stage): seeds from the per-extension
 *    calibration table when history is available, so the very first ETA
 *    display (at milestone 20 or 35) starts from a realistic baseline rather
 *    than a null or wildly extrapolated value.
 *
 * 2. 2+ milestones — rolling milestone rate (blended): the live progress-per-ms
 *    rate is blended with the historical estimate.  The historical weight starts
 *    at 1.0 at the 2nd milestone and fades linearly to 0 by the 5th milestone,
 *    after which the live rate drives the ETA entirely.
 *    Pre-40% estimates also apply the file-size-scaled penalty (1.5–3×) so the
 *    early estimate errs conservatively.
 *
 * 3. Post-60% with soundingCount known (tar archives): after the terrain
 *    gridding step completes (milestone 80), we have an observed pts/ms
 *    throughput rate.  We use it to estimate the remaining overview gridding
 *    time rather than extrapolating from the raw progress rate.
 *
 * - Up to 5 milestone timestamps are kept (bounded memory).
 * - ETA is null until either 2 milestones are recorded or calibration history
 *   is available for the file extension.
 * - ETA is 0 once progress reaches 100.
 * - `stageStartedAt` is updated to the current timestamp on every call so the
 *   most recent milestone is always available for DB persistence.
 */
export function updateProgressWithEta(job: EtaJobState, progress: number): void {
  job.progress = progress;
  const now = Date.now();

  if (!job.stageTimestamps) job.stageTimestamps = [];

  const lastMilestone = job.stageTimestamps[job.stageTimestamps.length - 1];
  const shouldSkip =
    lastMilestone != null &&
    now - lastMilestone.ts < MIN_MILESTONE_DELTA_MS &&
    progress - lastMilestone.progress < MIN_MILESTONE_DELTA_PROGRESS;

  if (!shouldSkip) {
    job.stageTimestamps.push({ progress, ts: now });
    if (job.stageTimestamps.length > 5) job.stageTimestamps.shift();
  }

  job.stageStartedAt = new Date(now);

  if (progress >= 100) {
    job.eta = 0;
    return;
  }

  if (progress === 80 && job.soundingCount != null && job.soundingCount > 0) {
    const t60entry = job.stageTimestamps.find((m) => m.progress === 60);
    if (t60entry && now > t60entry.ts) {
      const terrainMs = now - t60entry.ts;
      const overviewEstimateMs = terrainMs * 0.3;
      const dbEstimateMs = 500;
      job.eta = Math.max(1, Math.round((overviewEstimateMs + dbEstimateMs) / 1000));
      return;
    }
  }
  if (progress === 88 && job.soundingCount != null) {
    job.eta = 1;
    return;
  }

  const remaining = 100 - progress;
  const milestoneCount = job.stageTimestamps.length;

  if (milestoneCount < 2) {
    const median = job.fileExt ? historicalMedianMs(job.fileExt) : null;
    if (median != null && median > 0) {
      const elapsed = job.jobStartedAt != null ? now - job.jobStartedAt : 0;
      const estimatedRemaining = Math.max(median - elapsed, median * (remaining / 100));
      job.eta = Math.max(1, Math.round(estimatedRemaining / 1000));
    } else {
      job.eta = null;
    }
    return;
  }

  const last = job.stageTimestamps[milestoneCount - 1]!;
  const prev = job.stageTimestamps[milestoneCount - 2]!;
  const deltaProgress = last.progress - prev.progress;
  const deltaMs = last.ts - prev.ts;

  if (deltaProgress > 0 && deltaMs > 50) {
    const ratePerMs = deltaProgress / deltaMs;

    let penalty = 1.0;
    if (progress < 40) {
      const mb = (job.fileBytes ?? 0) / (1024 * 1024);
      penalty = 1.5 + Math.min(1.5, (mb / 50) * 1.5);
    }

    const liveEtaSec = Math.max(1, Math.round(((remaining / ratePerMs) * penalty) / 1000));

    const median = job.fileExt ? historicalMedianMs(job.fileExt) : null;
    if (median != null && median > 0) {
      const historicalWeight = Math.max(0, 1 - (milestoneCount - 2) / 3);
      const elapsed = job.jobStartedAt != null ? now - job.jobStartedAt : 0;
      const historicalRemaining = Math.max(median - elapsed, median * (remaining / 100));
      const historicalEtaSec = Math.max(1, Math.round(historicalRemaining / 1000));
      job.eta = Math.round(historicalWeight * historicalEtaSec + (1 - historicalWeight) * liveEtaSec);
    } else {
      job.eta = liveEtaSec;
    }
  }
}

/**
 * Reset the in-process calibration table.
 * Exposed for test isolation only — do not call in production code.
 */
export function clearCalibrationHistoryForTest(): void {
  extensionDurationHistory.clear();
}
