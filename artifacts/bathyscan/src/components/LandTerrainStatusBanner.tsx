/**
 * LandTerrainStatusBanner — subtle HUD notice for land terrain fetch state.
 *
 * Shows:
 *   • A pulsing "Loading land terrain…" pill while the Copernicus DEM fetch
 *     is in flight (isLoading === true).
 *   • A muted "Land terrain unavailable" warning when the fetch failed
 *     (error !== null). A small "Retry" button lets the user re-trigger the
 *     fetch without reloading the page. The error banner also shows an × to
 *     dismiss immediately and a Copy button, and auto-dismisses after 10 s
 *     (timer pauses on hover).
 *
 * Nothing is rendered when the land grid has loaded successfully.
 */
import React, { useState } from "react";
import { useLandTerrainStore } from "@/lib/landTerrainStore";
import { useAutoDismiss } from "@/hooks/useAutoDismiss";
import { CopyButton } from "@/components/ui/CopyButton";

const ERROR_TEXT = "Land terrain unavailable";
const AUTO_DISMISS_MS = 10_000;

export const LandTerrainStatusBanner: React.FC = () => {
  const isLoading = useLandTerrainStore((s) => s.isLoading);
  const error = useLandTerrainStore((s) => s.error);
  const retry = useLandTerrainStore((s) => s.retry);

  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed state when a new error arrives so the banner re-appears.
  const [prevError, setPrevError] = useState(error);
  if (error !== prevError) {
    setPrevError(error);
    if (error) setDismissed(false);
  }

  const dismiss = React.useCallback(() => setDismissed(true), []);
  const { onMouseEnter, onMouseLeave } = useAutoDismiss(
    error && !dismissed ? AUTO_DISMISS_MS : undefined,
    error && !dismissed ? dismiss : undefined,
  );

  if (!isLoading && !error) return null;
  if (error && dismissed) return null;

  return (
    <div
      data-testid="land-terrain-status-banner"
      onMouseEnter={error ? onMouseEnter : undefined}
      onMouseLeave={error ? onMouseLeave : undefined}
      style={{
        position: "absolute",
        bottom: 72,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 25,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 12px",
        background: "rgba(0,10,20,0.88)",
        border: `1px solid ${isLoading ? "rgba(0,229,255,0.3)" : "rgba(251,191,36,0.4)"}`,
        borderRadius: 4,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: "calc(15px * var(--bs-font-scale, 1))",
        color: isLoading ? "#94a3b8" : "#fbbf24",
        letterSpacing: "0.08em",
        pointerEvents: isLoading ? "none" : "auto",
        backdropFilter: "blur(6px)",
        whiteSpace: "nowrap",
      }}
    >
      {isLoading ? (
        <>
          <span
            style={{
              display: "inline-block",
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#00e5ff",
              animation: "land-terrain-pulse 1.2s ease-in-out infinite",
            }}
          />
          <style>{`
            @keyframes land-terrain-pulse {
              0%, 100% { opacity: 1; transform: scale(1); }
              50% { opacity: 0.3; transform: scale(0.7); }
            }
          `}</style>
          LOADING LAND TERRAIN…
        </>
      ) : (
        <>
          <span style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))" }}>⚠</span>
          {ERROR_TEXT}
          <button
            data-testid="land-terrain-retry-btn"
            onClick={retry}
            aria-label="Retry land terrain fetch"
            style={{
              marginLeft: 6,
              padding: "1px 7px",
              background: "rgba(251,191,36,0.12)",
              border: "1px solid rgba(251,191,36,0.5)",
              borderRadius: 3,
              color: "#fbbf24",
              fontFamily: "inherit",
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
              letterSpacing: "0.08em",
              cursor: "pointer",
              lineHeight: "16px",
            }}
          >
            RETRY
          </button>
          <CopyButton
            text={ERROR_TEXT}
            className="text-amber-400/70 hover:text-amber-300"
          />
          <button
            data-testid="land-terrain-dismiss-btn"
            onClick={dismiss}
            aria-label="Dismiss land terrain error"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginLeft: 2,
              padding: 2,
              background: "transparent",
              border: "none",
              color: "#fbbf24",
              cursor: "pointer",
              opacity: 0.7,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </>
      )}
    </div>
  );
};
