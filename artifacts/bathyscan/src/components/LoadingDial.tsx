/**
 * Circular progress dial used in the Map & Data panel to show how much of a
 * dataset's terrain payload has loaded. Reads from `useActiveLoadStore` and
 * derives a 0..1 progress value plus an optional ETA via `computeProgress`.
 *
 * The dial re-ticks itself on a short interval while the load is on the
 * time-based fallback curve so the asymptotic progress advances smoothly
 * even without new byte events.
 */
import React, { useEffect, useState } from "react";
import { computeProgress, useActiveLoadStore } from "@/lib/activeLoadStore";

const ETA_THRESHOLD_MS = 500;

export interface LoadingDialProps {
  /** Optional override for the underlying progress (0..1). When omitted the
   *  component reads the active load state for the supplied `datasetId`. */
  progress?: number;
  /** When set, the dial only renders for this datasetId (no-op otherwise). */
  datasetId?: string;
  /** Accessible label fragment, e.g. dataset name. */
  label?: string;
  /** Pixel size of the SVG. */
  size?: number;
  /** Hide the ETA text even when an estimate is available. */
  hideEta?: boolean;
}

export const LoadingDial: React.FC<LoadingDialProps> = ({
  progress: progressOverride,
  datasetId,
  label,
  size = 14,
  hideEta = false,
}) => {
  const active = useActiveLoadStore((s) => s.active);
  const history = useActiveLoadStore((s) => s.history);
  const tickNow = useActiveLoadStore((s) => s.tickNow);
  // Local rerender tick so time-based curves advance smoothly even
  // when there are no new byte events.
  const [, setLocalTick] = useState(0);

  const matchesActive = active && (!datasetId || active.datasetId === datasetId);
  const needsTimer = progressOverride == null && matchesActive;

  useEffect(() => {
    if (!needsTimer) return;
    const id = setInterval(() => {
      tickNow();
      setLocalTick((n) => n + 1);
    }, 150);
    return () => clearInterval(id);
  }, [needsTimer, tickNow]);

  let progress: number;
  let etaMs: number | null = null;
  let elapsedMs = 0;
  if (progressOverride != null) {
    progress = Math.max(0, Math.min(1, progressOverride));
  } else if (matchesActive) {
    const view = computeProgress(active, history);
    progress = view.progress;
    etaMs = view.etaMs;
    elapsedMs = view.elapsedMs;
  } else {
    progress = 0;
  }

  const r = (size - 2) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - progress);
  const pct = Math.round(progress * 100);

  const showEta =
    !hideEta &&
    etaMs != null &&
    etaMs >= 500 &&
    elapsedMs >= ETA_THRESHOLD_MS;
  const etaSeconds = showEta ? Math.max(1, Math.round((etaMs ?? 0) / 1000)) : null;

  const ariaLabel = label
    ? `Loading ${label}, ${pct} percent`
    : `Loading, ${pct} percent`;

  return (
    <span
      data-testid="loading-dial"
      data-progress={progress.toFixed(3)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: "block" }}
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(0,229,255,0.18)"
          strokeWidth={1.5}
        />
        <circle
          data-testid="loading-dial-arc"
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#00e5ff"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{
            transition: "stroke-dashoffset 150ms linear",
            transform: "rotate(-90deg)",
            transformOrigin: "50% 50%",
          }}
        />
      </svg>
      {etaSeconds != null && (
        <span
          data-testid="loading-dial-eta"
          style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#7dd3fc", letterSpacing: "0.04em" }}
        >
          ~{etaSeconds}s
        </span>
      )}
    </span>
  );
};
