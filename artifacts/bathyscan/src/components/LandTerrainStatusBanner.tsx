/**
 * LandTerrainStatusBanner — subtle HUD notice for land terrain fetch state.
 *
 * Shows:
 *   • A pulsing "Loading land terrain…" pill while the Copernicus DEM fetch
 *     is in flight (isLoading === true).
 *   • A muted "Land terrain unavailable" warning when the fetch failed
 *     (error !== null). A small "Retry" button lets the user re-trigger the
 *     fetch without reloading the page.
 *
 * Nothing is rendered when the land grid has loaded successfully.
 */
import React from "react";
import { useLandTerrainStore } from "@/lib/landTerrainStore";

export const LandTerrainStatusBanner: React.FC = () => {
  const isLoading = useLandTerrainStore((s) => s.isLoading);
  const error = useLandTerrainStore((s) => s.error);
  const retry = useLandTerrainStore((s) => s.retry);

  if (!isLoading && !error) return null;

  return (
    <div
      data-testid="land-terrain-status-banner"
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
        fontSize: 10,
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
          <span style={{ fontSize: 9 }}>⚠</span>
          LAND TERRAIN UNAVAILABLE
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
              fontSize: 9,
              letterSpacing: "0.08em",
              cursor: "pointer",
              lineHeight: "16px",
            }}
          >
            RETRY
          </button>
        </>
      )}
    </div>
  );
};
