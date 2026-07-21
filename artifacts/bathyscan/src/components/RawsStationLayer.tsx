/**
 * RawsStationLayer — popover card shown when an AOOS RAWS station pin is
 * clicked on the OverviewMap canvas.
 *
 * Canvas rendering of the pins themselves is done by renderRawsStations()
 * in overviewRenderer.ts (called from the OverviewMap rAF loop). This
 * component handles the React-side popover overlay positioned above the
 * clicked pin. It fetches the latest observation on-demand via useRawsWeather.
 */
import React from "react";
import { useRawsWeather } from "@/hooks/useRawsWeather";
import type { RawsObservation } from "@/hooks/useRawsWeather";
import { useSettingsStore } from "@/lib/settingsStore";

const MONO: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
};

/** Cardinal direction label from degrees (16-point compass). */
function cardinalDir(deg: number): string {
  const dirs = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16] ?? "?";
}

/** Format wind speed: m/s → knots or km/h depending on units. */
function fmtWindSpeed(ms: number | null | undefined, metric: boolean): string {
  if (ms == null) return "–";
  if (metric) return `${ms.toFixed(1)} m/s`;
  return `${(ms * 1.94384).toFixed(0)} kt`;
}

/** Format temperature. */
function fmtTemp(c: number | null | undefined, metric: boolean): string {
  if (c == null) return "–";
  if (metric) return `${c.toFixed(1)} °C`;
  return `${(c * 9 / 5 + 32).toFixed(1)} °F`;
}

/** Format humidity. */
function fmtHumidity(pct: number | null | undefined): string {
  if (pct == null) return "–";
  return `${Math.round(pct)} %`;
}

/** Format solar irradiance. */
function fmtSolar(wm2: number | null | undefined): string {
  if (wm2 == null) return "–";
  return `${Math.round(wm2)} W/m²`;
}

/** Format precipitation. */
function fmtPrecip(mm: number | null | undefined): string {
  if (mm == null) return "–";
  return `${mm.toFixed(1)} mm`;
}

/** Format observation timestamp to "HH:MM UTC". */
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

function buildRows(obs: RawsObservation, metric: boolean): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];

  if (obs.airTemperatureC != null) {
    rows.push({ label: "TEMP", value: fmtTemp(obs.airTemperatureC, metric) });
  }

  if (obs.windSpeedMs != null) {
    const dir =
      obs.windFromDirectionDeg != null
        ? `${cardinalDir(obs.windFromDirectionDeg)} ${Math.round(obs.windFromDirectionDeg)}° @ `
        : "";
    const gust =
      obs.windGustMs != null
        ? ` (gust ${fmtWindSpeed(obs.windGustMs, metric)})`
        : "";
    rows.push({ label: "WIND", value: `${dir}${fmtWindSpeed(obs.windSpeedMs, metric)}${gust}` });
  }

  if (obs.relativeHumidityPct != null) {
    rows.push({ label: "HUMIDITY", value: fmtHumidity(obs.relativeHumidityPct) });
  }

  if (obs.solarIrradianceWm2 != null) {
    rows.push({ label: "SOLAR", value: fmtSolar(obs.solarIrradianceWm2) });
  }

  if (obs.precipitationMm != null) {
    rows.push({ label: "PRECIP", value: fmtPrecip(obs.precipitationMm) });
  }

  rows.push({ label: "OBS", value: fmtObsTime(obs.time) });

  return rows;
}

/** Format a Date to "Mon DD  HH:MM UTC" for the timeline row. */
function fmtTimelineTime(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mon = months[d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${mon} ${day}  ${hh}:${mm} UTC`;
}

interface Props {
  datasetId: string;
  stationName: string;
  pinX: number;
  pinY: number;
  containerWidth: number;
  /** When the global timeline is active, the selected timeline moment. */
  timelineTime?: Date;
  /** True when the global timeline overlay is driving the selected time. */
  timelineActive?: boolean;
  onClose: () => void;
}

export const RawsStationPopover: React.FC<Props> = ({
  datasetId,
  stationName,
  pinX,
  pinY,
  containerWidth,
  timelineTime,
  timelineActive = false,
  onClose,
}) => {
  const units = useSettingsStore((s) => s.units);
  const metric = units === "metric";

  // When the global timeline is active, fetch the observation nearest that time.
  const { observation, isLoading, isError } = useRawsWeather(
    datasetId,
    true,
    timelineActive ? (timelineTime ?? null) : null,
  );

  const CARD_W = 240;
  const CARD_H = timelineActive ? 228 : 200;

  let left = pinX + 12;
  let top = pinY - CARD_H - 12;
  if (left + CARD_W > containerWidth - 8) left = pinX - CARD_W - 12;
  if (top < 8) top = pinY + 18;

  const rows = observation ? buildRows(observation, metric) : [];

  return (
    <div
      data-testid="raws-station-popover"
      style={{
        position: "absolute",
        left,
        top,
        width: CARD_W,
        background: "rgba(2,8,24,0.96)",
        border: "1px solid rgba(52,211,153,0.4)",
        borderRadius: 6,
        zIndex: 50,
        ...MONO,
        fontSize: "calc(15px * var(--bs-font-scale, 1))",
        color: "#e2e8f0",
        pointerEvents: "auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "7px 10px 6px",
          borderBottom: "1px solid rgba(52,211,153,0.15)",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
              letterSpacing: "0.18em",
              color: "#34d399",
              textTransform: "uppercase",
            }}
          >
            RAWS Station
          </div>
          <div
            style={{
              fontSize: "calc(15px * var(--bs-font-scale, 1))",
              color: "#e2e8f0",
              fontWeight: 700,
              marginTop: 1,
              maxWidth: 190,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {stationName}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "none",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "calc(19.5px * var(--bs-font-scale, 1))",
            lineHeight: 1,
            padding: "0 2px",
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: "8px 10px" }}>
        {timelineActive && timelineTime && (
          <div
            data-testid="raws-timeline-active-row"
            style={{
              marginBottom: 6,
              padding: "2px 5px",
              borderRadius: 3,
              background: "rgba(0,229,255,0.07)",
              border: "1px solid rgba(0,229,255,0.22)",
              display: "grid",
              gridTemplateColumns: "72px 1fr",
              alignItems: "baseline",
              gap: 4,
            }}
          >
            <span style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", letterSpacing: "0.16em", color: "#00e5ff", textTransform: "uppercase" }}>
              TIMELINE
            </span>
            <span style={{ color: "#00e5ff", fontSize: "calc(13.5px * var(--bs-font-scale, 1))" }}>{fmtTimelineTime(timelineTime)}</span>
          </div>
        )}
        {isLoading && (
          <div style={{ color: "#64748b", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", letterSpacing: "0.1em" }}>
            Fetching observation…
          </div>
        )}
        {isError && !isLoading && (
          <div style={{ color: "#ef4444", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", letterSpacing: "0.1em" }}>
            Could not reach station
          </div>
        )}
        {!isLoading && !isError && observation === null && (
          <div style={{ color: "#64748b", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", letterSpacing: "0.1em" }}>
            No recent observation available
          </div>
        )}
        {!isLoading && observation && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {rows.map(({ label, value }) => (
              <div
                key={label}
                style={{
                  display: "grid",
                  gridTemplateColumns: "72px 1fr",
                  alignItems: "baseline",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                    letterSpacing: "0.16em",
                    color: "#64748b",
                    textTransform: "uppercase",
                  }}
                >
                  {label}
                </span>
                <span style={{ color: "#e2e8f0" }}>{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer credit */}
      <div
        style={{
          padding: "4px 10px 6px",
          borderTop: "1px solid rgba(52,211,153,0.1)",
          fontSize: "calc(12px * var(--bs-font-scale, 1))",
          letterSpacing: "0.08em",
          color: "#475569",
        }}
      >
        Source:{" "}
        <a
          href="https://erddap.aoos.org/erddap"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#475569", textDecoration: "underline" }}
        >
          AOOS / RAWS
        </a>
      </div>
    </div>
  );
};
