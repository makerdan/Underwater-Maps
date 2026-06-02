/**
 * CurrentsPanel — HUD overlay for the bathymetric currents simulation
 * (Task #136). Lives in the left-side scroll column alongside TidePanel.
 *
 * Provides:
 *   • Master ON/OFF (mirrors settingsStore.currentsEnabled).
 *   • Source selector (Manual vs NOAA Real Data).
 *   • Manual direction + speed inputs (when source = manual).
 *   • Tide-phase scrubber (0..1 — flood peak → ebb peak → flood).
 *   • Per-layer toggles (particles / arrows / streamlines).
 *   • Legend strip showing the speed → colour ramp.
 *
 * Rendered inside the pointer-events-none HUD column with its own
 * pointer-events:auto wrapper for interactivity.
 */

import React, { useEffect, useRef } from "react";
import { useSettingsStore } from "@/lib/settingsStore";
import { useCurrentsStore, type TidalStatus } from "@/lib/currentsStore";
import { HelpIcon } from "@/components/help/HelpButton";
import { CURRENT_RAMP_STOPS, speedToColor } from "@/lib/currentColor";
import { formatSpeedFromKnots, speedSuffix, MPH_TO_KNOTS, MPH_TO_KPH, cardinal } from "@/lib/units";
import type { UnitsSystem } from "@/lib/settingsStore";

function knotsToDisplay(kt: number, units: UnitsSystem): number {
  if (units === "nautical") return kt;
  const mph = kt / MPH_TO_KNOTS;
  return units === "imperial" ? mph : mph * MPH_TO_KPH;
}

function displayToKnots(v: number, units: UnitsSystem): number {
  if (units === "nautical") return v;
  if (units === "imperial") return v * MPH_TO_KNOTS;
  return (v / MPH_TO_KPH) * MPH_TO_KNOTS;
}

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

const card: React.CSSProperties = {
  pointerEvents: "auto",
  minWidth: 240,
  maxWidth: 280,
  background: "rgba(0,10,20,0.82)",
  border: "1px solid rgba(0,229,255,0.25)",
  borderRadius: 4,
  padding: 10,
  color: "#e2e8f0",
  fontFamily: FONT,
  fontSize: 11,
  backdropFilter: "blur(6px)",
};

const header: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.22em",
  color: "#00e5ff",
  textShadow: "0 0 8px rgba(0,229,255,0.45)",
  marginBottom: 8,
};

const label: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: "0.15em",
  color: "#cbd5e1",
  textTransform: "uppercase",
};

const input: React.CSSProperties = {
  background: "rgba(15,23,42,0.85)",
  border: "1px solid rgba(0,229,255,0.18)",
  color: "#e2e8f0",
  fontFamily: FONT,
  fontSize: 11,
  padding: "3px 6px",
  borderRadius: 3,
  width: "100%",
};

const toggleBtn = (active: boolean): React.CSSProperties => ({
  background: active ? "rgba(0,229,255,0.12)" : "rgba(15,23,42,0.5)",
  border: `1px solid ${active ? "rgba(0,229,255,0.45)" : "rgba(0,229,255,0.12)"}`,
  color: active ? "#00e5ff" : "#94a3b8",
  fontFamily: FONT,
  fontSize: 9,
  letterSpacing: "0.18em",
  padding: "4px 8px",
  borderRadius: 3,
  cursor: "pointer",
  flex: 1,
});

function rgbCss({ r, g, b }: { r: number; g: number; b: number }): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

function Legend({ units }: { units: UnitsSystem }): React.ReactElement {
  const gradient = CURRENT_RAMP_STOPS
    .map((s) => {
      const c = speedToColor(s.t);
      return `${rgbCss(c)} ${Math.round(s.t * 100)}%`;
    })
    .join(", ");
  return (
    <div style={{ marginTop: 6 }} data-testid="currents-legend">
      <div style={{ ...label, marginBottom: 3 }}>Speed ({speedSuffix(units)})</div>
      <div
        style={{
          height: 8,
          borderRadius: 3,
          background: `linear-gradient(to right, ${gradient})`,
          border: "1px solid rgba(0,229,255,0.18)",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#cbd5e1", marginTop: 2 }}>
        <span>0</span>
        <span>slow</span>
        <span>fast</span>
      </div>
    </div>
  );
}

interface CurrentsPanelProps {
  embedded?: boolean;
}

export const CurrentsPanel: React.FC<CurrentsPanelProps> = ({ embedded = false }) => {
  const units = useSettingsStore((s) => s.units);
  const currentsEnabled = useSettingsStore((s) => s.currentsEnabled);
  const setCurrentsEnabled = useSettingsStore((s) => s.setCurrentsEnabled);
  const currentsSource = useSettingsStore((s) => s.currentsSource);
  const setCurrentsSource = useSettingsStore((s) => s.setCurrentsSource);
  const currentsManualDirectionDeg = useSettingsStore((s) => s.currentsManualDirectionDeg);
  const setCurrentsManualDirectionDeg = useSettingsStore((s) => s.setCurrentsManualDirectionDeg);
  const currentsManualSpeedKt = useSettingsStore((s) => s.currentsManualSpeedKt);
  const setCurrentsManualSpeedKt = useSettingsStore((s) => s.setCurrentsManualSpeedKt);
  const currentsTidePhase = useSettingsStore((s) => s.currentsTidePhase);
  const setCurrentsTidePhase = useSettingsStore((s) => s.setCurrentsTidePhase);
  const currentsAutoAdvance = useSettingsStore((s) => s.currentsAutoAdvance);
  const setCurrentsAutoAdvance = useSettingsStore((s) => s.setCurrentsAutoAdvance);
  const currentsShowParticles = useSettingsStore((s) => s.currentsShowParticles);
  const setCurrentsShowParticles = useSettingsStore((s) => s.setCurrentsShowParticles);
  const currentsShowArrows = useSettingsStore((s) => s.currentsShowArrows);
  const setCurrentsShowArrows = useSettingsStore((s) => s.setCurrentsShowArrows);
  const currentsShowStreamlines = useSettingsStore((s) => s.currentsShowStreamlines);
  const setCurrentsShowStreamlines = useSettingsStore((s) => s.setCurrentsShowStreamlines);
  const field = useCurrentsStore((st) => st.field);
  const noaaAmbient = useCurrentsStore((st) => st.noaaAmbient);
  const tidalStatus = useCurrentsStore((st) => st.tidalStatus);
  const retryTidal = useCurrentsStore((st) => st.retryTidal);

  const wrapStyle: React.CSSProperties = embedded
    ? { width: "100%", minWidth: 0, color: "#e2e8f0", fontFamily: FONT, fontSize: 11 }
    : card;

  if (!currentsEnabled) {
    return (
      <div style={wrapStyle} data-testid="currents-panel">
        {!embedded && (
        <div style={{ ...header, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>◈ CURRENTS</span>
          <HelpIcon articleId="currents-simulation" label="Currents simulation" />
        </div>
      )}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            data-testid="currents-enable"
            style={toggleBtn(false)}
            onClick={() => setCurrentsEnabled(true)}
          >
            ○ ENABLE CURRENTS
          </button>
        </div>
      </div>
    );
  }

  const maxKt = field ? field.maxSpeed : Math.max(currentsManualSpeedKt, 0.5);

  return (
    <div style={wrapStyle} data-testid="currents-panel">
      {!embedded && (
      <div style={{ ...header, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>◉ CURRENTS</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <HelpIcon articleId="currents-simulation" label="Currents simulation" />
          <button
            data-testid="currents-disable"
            style={{ ...toggleBtn(true), flex: 0, padding: "2px 8px" }}
            onClick={() => setCurrentsEnabled(false)}
          >
            OFF
          </button>
        </div>
      </div>
      )}
      {embedded && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <button
            data-testid="currents-disable"
            style={{ ...toggleBtn(true), flex: 0, padding: "2px 8px" }}
            onClick={() => setCurrentsEnabled(false)}
          >
            OFF
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <button
          data-testid="currents-source-manual"
          style={toggleBtn(currentsSource === "manual")}
          onClick={() => setCurrentsSource("manual")}
        >
          MANUAL
        </button>
        <button
          data-testid="currents-source-noaa"
          style={toggleBtn(currentsSource === "noaa")}
          onClick={() => setCurrentsSource("noaa")}
          title={
            noaaAmbient
              ? noaaAmbient.source === "noaa"
                ? `NOAA tidal currents${noaaAmbient.stationName ? ` — ${noaaAmbient.stationName}` : ""}`
                : "Tide-derived estimate (no NOAA station in range)"
              : tidalStatus === "loading"
                ? "Fetching NOAA data…"
                : tidalStatus === "unavailable"
                  ? "No NOAA tidal station found in range"
                  : "NOAA tidal currents"
          }
        >
          NOAA
        </button>
      </div>

      {currentsSource === "manual" ? (
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={label}>Dir° <span style={{ opacity: 0.7 }}>{cardinal(currentsManualDirectionDeg)}</span></div>
            <input
              type="number"
              min={0}
              max={360}
              step={5}
              value={Math.round(currentsManualDirectionDeg)}
              onChange={(e) => setCurrentsManualDirectionDeg(Number(e.target.value) || 0)}
              style={input}
              data-testid="currents-manual-dir"
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>Speed ({speedSuffix(units)})</div>
            <input
              type="number"
              min={0}
              max={parseFloat(knotsToDisplay(10, units).toFixed(1))}
              step={0.1}
              value={parseFloat(knotsToDisplay(currentsManualSpeedKt, units).toFixed(2))}
              onChange={(e) => setCurrentsManualSpeedKt(displayToKnots(Number(e.target.value) || 0, units))}
              style={input}
              data-testid="currents-manual-speed"
            />
          </div>
        </div>
      ) : (
        <NoaaReadout
          tidalStatus={tidalStatus}
          noaaAmbient={noaaAmbient}
          units={units}
          onRetry={retryTidal}
          onSwitchToManual={() => setCurrentsSource("manual")}
        />
      )}

      <div style={{ marginBottom: 8 }}>
        <div style={{ ...label, display: "flex", justifyContent: "space-between" }}>
          <span>Tide Phase</span>
          <span style={{ color: "#e2e8f0" }}>{Math.round(currentsTidePhase * 100)}%</span>
        </div>
        <TidePhaseSlider
          value={currentsTidePhase}
          onChange={setCurrentsTidePhase}
        />
        <button
          style={{
            ...toggleBtn(currentsAutoAdvance),
            marginTop: 4,
            width: "100%",
            flex: 0,
          }}
          onClick={() => setCurrentsAutoAdvance(!currentsAutoAdvance)}
          data-testid="currents-auto-advance"
        >
          {currentsAutoAdvance ? "◉ AUTO-ADVANCE" : "○ AUTO-ADVANCE"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
        <button
          style={toggleBtn(currentsShowParticles)}
          onClick={() => setCurrentsShowParticles(!currentsShowParticles)}
          data-testid="currents-toggle-particles"
        >
          ✦ PART
        </button>
        <button
          style={toggleBtn(currentsShowArrows)}
          onClick={() => setCurrentsShowArrows(!currentsShowArrows)}
          data-testid="currents-toggle-arrows"
        >
          ➤ ARR
        </button>
        <button
          style={toggleBtn(currentsShowStreamlines)}
          onClick={() => setCurrentsShowStreamlines(!currentsShowStreamlines)}
          data-testid="currents-toggle-streams"
        >
          ∿ FLOW
        </button>
      </div>

      <Legend units={units} />

      {field && (
        <div style={{ marginTop: 6, fontSize: 9, color: "#94a3b8" }} data-testid="currents-field-stats">
          Field: {field.resolution}² · max {formatSpeedFromKnots(maxKt, { units, decimals: 2 })}
        </div>
      )}
    </div>
  );
};

interface NoaaReadoutProps {
  tidalStatus: TidalStatus;
  noaaAmbient: { directionDeg: number; speedKt: number; source?: "noaa" | "estimated"; stationId?: string; stationName?: string } | null;
  units: UnitsSystem;
  onRetry: () => void;
  onSwitchToManual: () => void;
}

function NoaaReadout({ tidalStatus, noaaAmbient, units, onRetry, onSwitchToManual }: NoaaReadoutProps): React.ReactElement {
  const actionBtn: React.CSSProperties = {
    background: "none",
    border: "1px solid rgba(0,229,255,0.3)",
    color: "#00e5ff",
    fontFamily: FONT,
    fontSize: 9,
    letterSpacing: "0.15em",
    padding: "3px 8px",
    borderRadius: 3,
    cursor: "pointer",
    marginTop: 4,
  };

  if (tidalStatus === "loading") {
    if (noaaAmbient) {
      return (
        <div style={{ marginBottom: 8, fontSize: 10, color: "#e2e8f0" }} data-testid="currents-noaa-readout">
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: "1 1 0" }}>
              {noaaAmbient.source === "noaa" ? "NOAA" : "Estimated"}:{" "}
              {noaaAmbient.directionDeg.toFixed(0)}°{" "}
              {cardinal(noaaAmbient.directionDeg)} @{" "}
              {formatSpeedFromKnots(noaaAmbient.speedKt, { units, decimals: 2 })}
            </span>
            <span
              data-testid="currents-noaa-refreshing"
              style={{
                fontSize: 8,
                letterSpacing: "0.15em",
                color: "#94a3b8",
                border: "1px solid rgba(148,163,184,0.3)",
                borderRadius: 2,
                padding: "1px 4px",
              }}
            >
              REFRESHING…
            </span>
          </div>
          {noaaAmbient.source === "noaa" &&
          (noaaAmbient.stationName || noaaAmbient.stationId) ? (
            <div style={{ fontSize: 9, color: "#cbd5e1", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-testid="currents-noaa-station">
              Station:{" "}
              {noaaAmbient.stationName ?? "—"}
              {noaaAmbient.stationId ? ` (${noaaAmbient.stationId})` : ""}
            </div>
          ) : noaaAmbient.source === "estimated" ? (
            <div style={{ fontSize: 9, color: "#fbbf24", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-testid="currents-noaa-estimated">
              No NOAA station in range — using tide-derived estimate.
            </div>
          ) : null}
        </div>
      );
    }
    return (
      <div style={{ marginBottom: 8, fontSize: 10, color: "#94a3b8" }} data-testid="currents-noaa-readout">
        <span data-testid="currents-noaa-loading">⟳ Fetching NOAA data…</span>
      </div>
    );
  }

  if (tidalStatus === "unavailable") {
    return (
      <div style={{ marginBottom: 8, fontSize: 10, color: "#e2e8f0" }} data-testid="currents-noaa-readout">
        <div style={{ color: "#fbbf24", marginBottom: 4 }} data-testid="currents-noaa-unavailable">
          No NOAA tidal station found within 100 km of this location.
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button style={actionBtn} data-testid="currents-noaa-retry" onClick={onRetry}>
            ↺ Retry
          </button>
          <button style={{ ...actionBtn, color: "#94a3b8", borderColor: "rgba(148,163,184,0.3)" }} data-testid="currents-noaa-switch-manual" onClick={onSwitchToManual}>
            Switch to Manual
          </button>
        </div>
      </div>
    );
  }

  if (tidalStatus === "ok" && noaaAmbient) {
    return (
      <div style={{ marginBottom: 8, fontSize: 10, color: "#e2e8f0", minWidth: 0 }} data-testid="currents-noaa-readout">
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {noaaAmbient.source === "noaa" ? "NOAA" : "Estimated"}:{" "}
          {noaaAmbient.directionDeg.toFixed(0)}°{" "}
          {cardinal(noaaAmbient.directionDeg)} @{" "}
          {formatSpeedFromKnots(noaaAmbient.speedKt, { units, decimals: 2 })}
        </div>
        {noaaAmbient.source === "noaa" &&
        (noaaAmbient.stationName || noaaAmbient.stationId) ? (
          <div
            style={{ fontSize: 9, color: "#cbd5e1", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            data-testid="currents-noaa-station"
          >
            Station:{" "}
            {noaaAmbient.stationName ?? "—"}
            {noaaAmbient.stationId ? ` (${noaaAmbient.stationId})` : ""}
          </div>
        ) : noaaAmbient.source === "estimated" ? (
          <div
            style={{ fontSize: 9, color: "#fbbf24", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            data-testid="currents-noaa-estimated"
          >
            No NOAA station in range — using tide-derived estimate.
          </div>
        ) : null}
      </div>
    );
  }

  if (tidalStatus === "ok" && !noaaAmbient) {
    return (
      <div style={{ marginBottom: 8, fontSize: 10, color: "#94a3b8" }} data-testid="currents-noaa-readout">
        <span>Processing…</span>
      </div>
    );
  }

  // tidalStatus === "idle": source just switched to NOAA, fetch not yet started.
  // Render a visible standby message so e2e tests can assert the element is
  // present and visible immediately after the source toggle (currents.spec.ts).
  return (
    <div style={{ marginBottom: 8, fontSize: 10, color: "#94a3b8" }} data-testid="currents-noaa-readout">
      <span data-testid="currents-noaa-idle">⟳ Connecting to NOAA…</span>
    </div>
  );
}

/**
 * Range slider for the tide-phase scrubber.
 *
 * Subscribes to the native `input` event in addition to React's synthetic
 * onChange so programmatic scrubs that assign `el.value` directly and
 * dispatch a bubbling Event (e.g. in headless e2e tests) still propagate
 * to the store. React's `valueTracker` swallows assignments that go
 * through its wrapped value setter — without the native listener, the
 * controlled `value` snaps back to the store value and the readout never
 * moves. Real user drags still flow through onChange (idempotent setter
 * call), so behaviour for end-users is unchanged.
 */
function TidePhaseSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}): React.ReactElement {
  const ref = useRef<HTMLInputElement | null>(null);
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: Event) => {
      const t = e.target as HTMLInputElement | null;
      if (!t) return;
      const n = Number(t.value);
      if (!Number.isFinite(n)) return;
      cbRef.current(n / 1000);
    };
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
    return () => {
      el.removeEventListener("input", handler);
      el.removeEventListener("change", handler);
    };
  }, []);

  return (
    <input
      ref={ref}
      type="range"
      min={0}
      max={1000}
      value={Math.round(value * 1000)}
      onChange={(e) => onChange(Number(e.target.value) / 1000)}
      style={{ width: "100%", accentColor: "#00e5ff" }}
      data-testid="currents-tide-phase"
    />
  );
}
