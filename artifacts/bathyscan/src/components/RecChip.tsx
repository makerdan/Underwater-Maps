/**
 * RecChip — compact ⏺ REC button shown when a GPS trail is recording and the
 * sidebar is not on the Live tab.
 *
 * Displays a live mm:ss elapsed timer that ticks every second so the user can
 * immediately tell how long the active recording has been running.
 * Clicking the chip navigates back to the Live tab.
 */
import React, { useEffect, useState } from "react";

/** Format a seconds count as "MM:SS". */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

interface RecChipProps {
  /** Timestamp (ms since epoch) when the current recording started. */
  startedAt: number | null;
  onClick: () => void;
}

export function RecChip({ startedAt, onClick }: RecChipProps) {
  const [elapsedSec, setElapsedSec] = useState(() =>
    startedAt !== null ? Math.floor((Date.now() - startedAt) / 1000) : 0,
  );

  useEffect(() => {
    if (startedAt === null) {
      setElapsedSec(0);
      return;
    }
    const tick = () => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    tick(); // sync immediately on mount / startedAt change
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const elapsed = formatElapsed(elapsedSec);

  return (
    <button
      data-testid="rec-chip"
      onClick={onClick}
      aria-label={`Recording in progress (${elapsed}) — click to open Live tab`}
      style={{
        position: "absolute",
        bottom: 60,
        right: 16,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        background: "rgba(2,8,24,0.90)",
        border: "1px solid rgba(239,68,68,0.55)",
        borderRadius: 4,
        color: "#ef4444",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
        fontWeight: 700,
        letterSpacing: "0.14em",
        cursor: "pointer",
        backdropFilter: "blur(6px)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "#ef4444",
          boxShadow: "0 0 5px rgba(239,68,68,0.8)",
          animation: "pulse 1.2s ease-in-out infinite",
        }}
      />
      <span data-testid="rec-chip-elapsed">REC {elapsed}</span>
    </button>
  );
}
