/**
 * MarkerDetailCard — small read-only card showing details for a single marker.
 * Opened via the marker right-click menu's "View details" action.
 */
import React, { useEffect } from "react";
import { useMarkerDetailStore } from "@/lib/markerDetailStore";
import { MARKER_COLOR } from "@/lib/markerConstants";
import { MarkerIcon } from "@/lib/markerIcons";
import { useSettingsStore } from "@/lib/settingsStore";
import { formatDepth, formatTemperature } from "@/lib/units";
import { estimateWaterTemperature } from "@/lib/waterTemp";
import { useSurfaceTemperature } from "@/hooks/useSurfaceTemperature";

const MONO: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
};

export const MarkerDetailCard: React.FC = () => {
  const marker = useMarkerDetailStore((s) => s.marker);
  const hide = useMarkerDetailStore((s) => s.hide);
  const units = useSettingsStore((s) => s.units);
  // Subscribe so a change to the temperature-only override re-renders the
  // temperature row even when the global units selector hasn't moved.
  useSettingsStore((s) => s.temperatureUnit);
  // The marker itself carries the location we want SST for — far more
  // accurate than the dataset centre when markers are spread out, and it
  // means we don't need to reach into AppProvider (this component is
  // mounted globally outside it so signed-out / e2e flows keep working).
  const { anchor: sstAnchor } = useSurfaceTemperature(
    marker?.lat ?? null,
    marker?.lon ?? null,
    !!marker,
  );

  useEffect(() => {
    if (!marker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [marker, hide]);

  if (!marker) return null;

  const color = MARKER_COLOR[marker.type] ?? "#e2e8f0";
  const createdAt = marker.createdAt ? new Date(marker.createdAt) : null;

  return (
    <div
      data-testid="marker-detail-card"
      className="marker-detail-card"
      style={{
        position: "absolute",
        top: 60,
        right: 16,
        width: 280,
        zIndex: 35,
        background: "rgba(0,10,20,0.94)",
        border: `1px solid ${color}55`,
        borderRadius: 4,
        padding: "10px 14px",
        color: "#cbd5e1",
        backdropFilter: "blur(8px)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
        ...MONO,
        fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
        letterSpacing: "0.05em",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ color, fontSize: "calc(21px * var(--bs-font-scale, 1))", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 7 }}>
          <MarkerIcon type={marker.type} size={20} color={color} />
          {marker.label}
        </span>
        <button
          onClick={hide}
          style={{
            background: "none",
            border: "1px solid rgba(0,229,255,0.2)",
            color: "#cbd5e1",
            padding: "0 6px",
            borderRadius: 2,
            cursor: "pointer",
            fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
            ...MONO,
          }}
          aria-label="Close marker details"
        >
          ✕
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: "calc(15px * var(--bs-font-scale, 1))" }}>
        <span style={{ color: "#94a3b8" }}>TYPE</span>
        <span style={{ color: "#cbd5e1" }}>{marker.type}</span>
        <span style={{ color: "#94a3b8" }}>LON</span>
        <span style={{ color: "#00e5ff" }}>{marker.lon.toFixed(5)}°</span>
        <span style={{ color: "#94a3b8" }}>LAT</span>
        <span style={{ color: "#00e5ff" }}>{marker.lat.toFixed(5)}°</span>
        <span style={{ color: "#94a3b8" }}>DEPTH</span>
        <span style={{ color: "#fb923c" }}>{formatDepth(marker.depth, { units })}</span>
        <span style={{ color: "#94a3b8" }}>TEMP</span>
        {(() => {
          const sample = estimateWaterTemperature(marker.depth, sstAnchor);
          const tooltip = sample.live
            ? `${sample.source}${sample.timestamp ? ` · sampled ${new Date(sample.timestamp).toUTCString()}` : ""}`
            : "No live ocean feed available — showing an estimated thermocline based on a typical 15 °C surface.";
          return (
            <span style={{ color: "#fb923c" }} title={tooltip}>
              {formatTemperature(sample.celsius)}
              <span
                style={{
                  marginLeft: 6,
                  fontSize: "calc(12px * var(--bs-font-scale, 1))",
                  letterSpacing: "0.15em",
                  color: sample.live ? "#22d3ee" : "#f59e0b",
                }}
              >
                {sample.live ? "LIVE" : "EST"}
              </span>
            </span>
          );
        })()}
        {createdAt && (
          <>
            <span style={{ color: "#94a3b8" }}>CREATED</span>
            <span style={{ color: "#e2e8f0" }}>{createdAt.toLocaleString()}</span>
          </>
        )}
      </div>
      {marker.conditions && (
        <div
          data-testid="marker-conditions-snapshot"
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: `1px solid ${color}33`,
          }}
        >
          <div style={{ color: "#94a3b8", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", letterSpacing: "0.12em", marginBottom: 5 }}>
            CONDITIONS AT DROP
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px", fontSize: "calc(13.5px * var(--bs-font-scale, 1))" }}>
            {(() => {
              const c = marker.conditions;
              const rows: [string, string][] = [];
              if (c.gpsAccuracyM != null) rows.push(["GPS ±", `${c.gpsAccuracyM.toFixed(0)} m`]);
              if (c.speedMps != null) rows.push(["SPEED", `${(c.speedMps * 1.94384).toFixed(1)} kt`]);
              if (c.headingDeg != null) rows.push(["HEADING", `${c.headingDeg.toFixed(0)}°`]);
              if (c.depthSource === "terrain" && c.depthM != null)
                rows.push(["DEPTH", formatDepth(c.depthM, { units })]);
              if (c.tideSource === "pack") {
                if (c.tideHeightM != null) rows.push(["TIDE", `${c.tideHeightM.toFixed(2)} m`]);
                if (c.currentSpeedKt != null)
                  rows.push([
                    "CURRENT",
                    `${c.currentSpeedKt.toFixed(1)} kt${c.currentDirDeg != null ? ` @ ${c.currentDirDeg.toFixed(0)}°` : ""}`,
                  ]);
              }
              if (c.weatherSource === "pack") {
                if (c.windSpeedKnots != null)
                  rows.push([
                    "WIND",
                    `${c.windSpeedKnots.toFixed(0)} kt${c.windDirDeg != null ? ` @ ${c.windDirDeg.toFixed(0)}°` : ""}`,
                  ]);
                if (c.tempC != null) rows.push(["AIR TEMP", formatTemperature(c.tempC)]);
              }
              if (rows.length === 0) rows.push(["SNAPSHOT", "no data captured"]);
              return rows.map(([k, v]) => (
                <React.Fragment key={k}>
                  <span style={{ color: "#94a3b8" }}>{k}</span>
                  <span style={{ color: "#cbd5e1" }}>{v}</span>
                </React.Fragment>
              ));
            })()}
            <span style={{ color: "#94a3b8" }}>CAPTURED</span>
            <span style={{ color: "#e2e8f0" }}>
              {new Date(marker.conditions.capturedAt).toLocaleString()}
            </span>
          </div>
        </div>
      )}
      {marker.notes && marker.type !== "depth_pole" && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: `1px solid ${color}33`,
          }}
        >
          <div style={{ color: "#94a3b8", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", letterSpacing: "0.12em", marginBottom: 5 }}>NOTES</div>
          <div
            style={{
              background: "rgba(0,229,255,0.04)",
              border: "1px solid rgba(0,229,255,0.1)",
              borderLeft: `2px solid ${color}88`,
              borderRadius: 3,
              padding: "6px 9px",
              color: "#cbd5e1",
              fontSize: "calc(15px * var(--bs-font-scale, 1))",
              fontStyle: "italic",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
            }}
          >
            {marker.notes}
          </div>
        </div>
      )}
    </div>
  );
};
