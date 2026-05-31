/**
 * WeatherStationLayer — popover card shown when a NOAA weather station pin
 * is clicked on the OverviewMap canvas.
 *
 * Canvas rendering of the pins themselves is done by renderWeatherStations()
 * in overviewRenderer.ts (called from the OverviewMap rAF loop). This
 * component handles the React-side popover overlay positioned above the
 * clicked pin.
 */
import React from "react";
import type { WeatherStation } from "@workspace/api-client-react";
import { useSettingsStore } from "@/lib/settingsStore";

/** Cardinal direction label from degrees (16-point compass). */
function cardinalDir(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                 "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16] ?? "?";
}

/** Format temperature: C if metric, F if imperial. */
function fmtTemp(tempC: number | null | undefined, metric: boolean): string {
  if (tempC == null) return "–";
  if (metric) return `${tempC.toFixed(1)} °C`;
  return `${(tempC * 9 / 5 + 32).toFixed(1)} °F`;
}

/** Format visibility: miles if imperial, km if metric. */
function fmtVis(miles: number | null | undefined, metric: boolean): string {
  if (miles == null) return "–";
  if (metric) return `${(miles * 1.60934).toFixed(1)} km`;
  return `${miles.toFixed(1)} mi`;
}

/** Format ceiling: ft if imperial, m if metric. */
function fmtCeiling(ft: number | null | undefined, metric: boolean): string {
  if (ft == null) return "CLEAR";
  if (metric) return `${Math.round(ft * 0.3048)} m AGL`;
  return `${ft.toLocaleString()} ft AGL`;
}

/** Format wind: knots always (standard for aviation). */
function fmtWind(
  speedKnots: number | null | undefined,
  dirDeg: number | null | undefined,
): string {
  if (speedKnots == null) return "–";
  const dir = dirDeg != null ? `${cardinalDir(dirDeg)} ${Math.round(dirDeg)}°` : "VRB";
  return `${dir} @ ${speedKnots.toFixed(0)} kt`;
}

/** Format observedAt ISO timestamp to "HH:MM UTC". */
function fmtObsTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  try {
    const d = new Date(iso);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm} UTC`;
  } catch {
    return "–";
  }
}

interface Props {
  station: WeatherStation;
  /** Canvas-space pixel position of the station pin (used for positioning). */
  pinX: number;
  pinY: number;
  /** Width of the canvas container, used to flip card left when near the right edge. */
  containerWidth: number;
  faaWeatherCamsUrl: string | null;
  onClose: () => void;
}

const MONO: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
};

export const WeatherStationPopover: React.FC<Props> = ({
  station,
  pinX,
  pinY,
  containerWidth,
  faaWeatherCamsUrl,
  onClose,
}) => {
  const units = useSettingsStore((s) => s.units);
  const metric = units === "metric";

  const CARD_W = 220;
  const CARD_H = 220;

  // Prefer opening above+right of pin; flip if too close to edge
  let left = pinX + 12;
  let top = pinY - CARD_H - 12;
  if (left + CARD_W > containerWidth - 8) left = pinX - CARD_W - 12;
  if (top < 8) top = pinY + 18;

  const rows: Array<{ label: string; value: string }> = [
    { label: "WIND", value: fmtWind(station.windSpeedKnots, station.windDirDeg) },
    { label: "VIS", value: fmtVis(station.visibilityMiles, metric) },
    { label: "CEILING", value: fmtCeiling(station.ceilingFt, metric) },
    { label: "TEMP", value: fmtTemp(station.tempC, metric) },
    { label: "OBS", value: fmtObsTime(station.observedAt) },
  ];

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: CARD_W,
        background: "rgba(2,8,24,0.96)",
        border: "1px solid rgba(0,229,255,0.35)",
        borderRadius: 6,
        zIndex: 50,
        ...MONO,
        fontSize: 10,
        color: "#cbd5e1",
        backdropFilter: "blur(8px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
        pointerEvents: "auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 10px 6px",
          borderBottom: "1px solid rgba(0,229,255,0.12)",
        }}
      >
        <div>
          <div style={{ color: "#00e5ff", fontWeight: 700, fontSize: 11, letterSpacing: "0.1em" }}>
            {station.id}
          </div>
          <div
            style={{
              color: "#94a3b8",
              fontSize: 9,
              marginTop: 2,
              maxWidth: 170,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {station.name}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close station popover"
          style={{
            background: "none",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
            padding: "2px 4px",
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* Observation rows */}
      <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 5 }}>
        {rows.map(({ label, value }) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ color: "#64748b", letterSpacing: "0.08em", flexShrink: 0 }}>{label}</span>
            <span style={{ color: "#e2e8f0", textAlign: "right" }}>{value}</span>
          </div>
        ))}
      </div>

      {/* FAA WeatherCams link */}
      {faaWeatherCamsUrl && (
        <div
          style={{
            borderTop: "1px solid rgba(0,229,255,0.08)",
            padding: "6px 10px",
          }}
        >
          <a
            href={faaWeatherCamsUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#7dd3fc",
              fontSize: 9,
              textDecoration: "none",
              letterSpacing: "0.08em",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            FAA WeatherCams ↗
          </a>
        </div>
      )}
    </div>
  );
};
