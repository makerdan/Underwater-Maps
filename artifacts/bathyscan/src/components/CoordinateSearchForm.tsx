/**
 * CoordinateSearchForm — manual coordinate + radius dataset search.
 *
 * Rendered inside the Find Data panel's Search tab. Accepts a free-text
 * lat/lon pair (decimal degrees, degrees + decimal minutes, or DMS with
 * N/S/E/W suffixes), a radius with a km/nmi unit selector (persisted via
 * settingsStore), and a "Use my GPS" fill button. Submitting queues a
 * coordinate search on the uiStore; the Overview Map consumes it, jumps to
 * the point, draws the search circle, and runs the point-radius query.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useUiStore } from "@/lib/uiStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useGpsStore } from "@/lib/gpsStore";
import {
  parseCoordinates,
  validateRadius,
  radiusToKm,
  type RadiusUnit,
} from "@/lib/coordinateParser";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";

const INPUT: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(0,229,255,0.2)",
  borderRadius: 4,
  padding: "7px 10px",
  fontSize: 15,
  color: "#e2e8f0",
  fontFamily: "'JetBrains Mono', monospace",
  outline: "none",
};

const LABEL: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  color: "#64748b",
  marginBottom: 4,
  display: "block",
};

interface CoordinateSearchFormProps {
  /** Called after a successful submit (e.g. to close the Find Data panel). */
  onSubmitted?: () => void;
}

export const CoordinateSearchForm: React.FC<CoordinateSearchFormProps> = ({ onSubmitted }) => {
  const [coordText, setCoordText] = useState("");
  const [coordError, setCoordError] = useState<string | null>(null);
  const [radiusError, setRadiusError] = useState<string | null>(null);
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);

  const coordSearchRadius = useSettingsStore((s) => s.coordSearchRadius);
  const coordSearchRadiusUnit = useSettingsStore((s) => s.coordSearchRadiusUnit);
  const setCoordSearchRadius = useSettingsStore((s) => s.setCoordSearchRadius);
  const setCoordSearchRadiusUnit = useSettingsStore((s) => s.setCoordSearchRadiusUnit);

  // Local text state for the radius input so users can type freely; the
  // parsed value is persisted on submit / blur.
  const [radiusText, setRadiusText] = useState(String(coordSearchRadius));

  const gpsPosition = useGpsStore((s) => s.position);
  const gpsError = useGpsStore((s) => s.error);
  const startWatching = useGpsStore((s) => s.startWatching);

  // When the user clicked "Use my GPS" and a fix (or error) arrives, fill in.
  const awaitingGpsRef = useRef(false);
  useEffect(() => {
    if (!awaitingGpsRef.current) return;
    if (gpsPosition) {
      awaitingGpsRef.current = false;
      setCoordText(`${gpsPosition.latitude.toFixed(6)}, ${gpsPosition.longitude.toFixed(6)}`);
      setCoordError(null);
      setGpsMessage(null);
    } else if (gpsError) {
      awaitingGpsRef.current = false;
      setGpsMessage(gpsError);
    }
  }, [gpsPosition, gpsError]);

  const handleGpsFill = useCallback(() => {
    setGpsMessage(null);
    if (gpsPosition) {
      setCoordText(`${gpsPosition.latitude.toFixed(6)}, ${gpsPosition.longitude.toFixed(6)}`);
      setCoordError(null);
      return;
    }
    awaitingGpsRef.current = true;
    setGpsMessage("Waiting for a GPS fix…");
    startWatching();
  }, [gpsPosition, startWatching]);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const parsed = parseCoordinates(coordText);
      const radiusValue = Number(radiusText);
      const rErr = validateRadius(radiusValue, coordSearchRadiusUnit);
      setCoordError(parsed.ok ? null : parsed.error);
      setRadiusError(rErr);
      if (!parsed.ok || rErr) return;

      setCoordSearchRadius(radiusValue);
      const state = useUiStore.getState();
      state.setPendingCoordSearch({
        lat: parsed.coords.lat,
        lon: parsed.coords.lon,
        radiusKm: radiusToKm(radiusValue, coordSearchRadiusUnit),
      });
      state.setOverviewOpen(true);
      onSubmitted?.();
    },
    [coordText, radiusText, coordSearchRadiusUnit, setCoordSearchRadius, onSubmitted],
  );

  return (
    <form onSubmit={handleSubmit} data-testid="coord-search-form">
      <label style={LABEL} htmlFor="coord-search-input">
        Coordinates (lat, lon)
      </label>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          id="coord-search-input"
          data-testid="coord-search-input"
          style={{ ...INPUT, flex: 1 }}
          value={coordText}
          onChange={(e) => {
            setCoordText(e.target.value);
            if (coordError) setCoordError(null);
          }}
          placeholder='58.30, -134.42  ·  58°18.1′N 134°25.2′W'
        />
        <ViewscreenTooltip label="Fill in your current GPS position" side="top">
          <button
            type="button"
            data-testid="coord-search-gps-fill"
            onClick={handleGpsFill}
            style={{
              fontSize: 15,
              padding: "0 10px",
              background: "rgba(0,229,255,0.06)",
              border: "1px solid rgba(0,229,255,0.25)",
              borderRadius: 4,
              color: "#00e5ff",
              cursor: "pointer",
              fontFamily: "'JetBrains Mono', monospace",
            }}
            aria-label="Use my GPS position"
          >
            📡
          </button>
        </ViewscreenTooltip>
      </div>
      {coordError && (
        <div data-testid="coord-search-coord-error" style={{ fontSize: 12, color: "#f87171", marginTop: 4, lineHeight: 1.4 }}>
          ⚠ {coordError}
        </div>
      )}
      {gpsMessage && (
        <div data-testid="coord-search-gps-message" style={{ fontSize: 12, color: "#f59e0b", marginTop: 4, lineHeight: 1.4 }}>
          {gpsMessage}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <label style={LABEL} htmlFor="coord-search-radius">
            Radius
          </label>
          <input
            id="coord-search-radius"
            data-testid="coord-search-radius"
            style={INPUT}
            inputMode="decimal"
            value={radiusText}
            onChange={(e) => {
              setRadiusText(e.target.value);
              if (radiusError) setRadiusError(null);
            }}
          />
        </div>
        <div
          role="group"
          aria-label="Radius unit"
          style={{ display: "flex", border: "1px solid rgba(0,229,255,0.2)", borderRadius: 4, overflow: "hidden" }}
        >
          {(["km", "nmi"] as RadiusUnit[]).map((u) => (
            <button
              key={u}
              type="button"
              data-testid={`coord-search-unit-${u}`}
              aria-pressed={coordSearchRadiusUnit === u}
              onClick={() => setCoordSearchRadiusUnit(u)}
              style={{
                fontSize: 13,
                padding: "8px 10px",
                background: coordSearchRadiusUnit === u ? "rgba(0,229,255,0.14)" : "transparent",
                border: "none",
                color: coordSearchRadiusUnit === u ? "#00e5ff" : "#94a3b8",
                cursor: "pointer",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {u}
            </button>
          ))}
        </div>
        <button
          type="submit"
          data-testid="coord-search-submit"
          style={{
            fontSize: 13,
            padding: "8px 14px",
            background: "rgba(0,229,255,0.15)",
            border: "1px solid rgba(0,229,255,0.5)",
            borderRadius: 4,
            color: "#00e5ff",
            cursor: "pointer",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: "nowrap",
          }}
        >
          Search
        </button>
      </div>
      {radiusError && (
        <div data-testid="coord-search-radius-error" style={{ fontSize: 12, color: "#f87171", marginTop: 4, lineHeight: 1.4 }}>
          ⚠ {radiusError}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 6, lineHeight: 1.5 }}>
        Accepts decimal degrees, degrees + decimal minutes, or DMS with N/S/E/W.
        Submitting opens the Overview Map at that point.
      </div>
    </form>
  );
};
