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
import { useCurrentsStore } from "@/lib/currentsStore";
import { CURRENT_RAMP_STOPS, speedToColor } from "@/lib/currentColor";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

const card: React.CSSProperties = {
  pointerEvents: "auto",
  minWidth: 240,
  maxWidth: 280,
  background: "rgba(0,10,20,0.82)",
  border: "1px solid rgba(0,229,255,0.25)",
  borderRadius: 4,
  padding: 10,
  color: "#94a3b8",
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
  color: "#64748b",
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
  color: active ? "#00e5ff" : "#475569",
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

function Legend(): React.ReactElement {
  const gradient = CURRENT_RAMP_STOPS
    .map((s) => {
      const c = speedToColor(s.t);
      return `${rgbCss(c)} ${Math.round(s.t * 100)}%`;
    })
    .join(", ");
  return (
    <div style={{ marginTop: 6 }} data-testid="currents-legend">
      <div style={{ ...label, marginBottom: 3 }}>Speed (kt)</div>
      <div
        style={{
          height: 8,
          borderRadius: 3,
          background: `linear-gradient(to right, ${gradient})`,
          border: "1px solid rgba(0,229,255,0.18)",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#64748b", marginTop: 2 }}>
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
  const s = useSettingsStore();
  const field = useCurrentsStore((st) => st.field);
  const noaaAmbient = useCurrentsStore((st) => st.noaaAmbient);

  const wrapStyle: React.CSSProperties = embedded
    ? { width: "100%", color: "#94a3b8", fontFamily: FONT, fontSize: 11 }
    : card;

  if (!s.currentsEnabled) {
    return (
      <div style={wrapStyle} data-testid="currents-panel">
        {!embedded && <div style={header}>◈ CURRENTS</div>}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            data-testid="currents-enable"
            style={toggleBtn(false)}
            onClick={() => s.setCurrentsEnabled(true)}
          >
            ○ ENABLE CURRENTS
          </button>
        </div>
      </div>
    );
  }

  const maxKt = field ? field.maxSpeed : Math.max(s.currentsManualSpeedKt, 0.5);

  return (
    <div style={wrapStyle} data-testid="currents-panel">
      {!embedded && (
      <div style={{ ...header, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>◉ CURRENTS</span>
        <button
          data-testid="currents-disable"
          style={{ ...toggleBtn(true), flex: 0, padding: "2px 8px" }}
          onClick={() => s.setCurrentsEnabled(false)}
        >
          OFF
        </button>
      </div>
      )}
      {embedded && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <button
            data-testid="currents-disable"
            style={{ ...toggleBtn(true), flex: 0, padding: "2px 8px" }}
            onClick={() => s.setCurrentsEnabled(false)}
          >
            OFF
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <button
          data-testid="currents-source-manual"
          style={toggleBtn(s.currentsSource === "manual")}
          onClick={() => s.setCurrentsSource("manual")}
        >
          MANUAL
        </button>
        <button
          data-testid="currents-source-noaa"
          style={toggleBtn(s.currentsSource === "noaa")}
          onClick={() => s.setCurrentsSource("noaa")}
          title={
            noaaAmbient
              ? noaaAmbient.source === "noaa"
                ? `NOAA tidal currents${noaaAmbient.stationName ? ` — ${noaaAmbient.stationName}` : ""}`
                : "Tide-derived estimate (no NOAA station in range)"
              : "Enable Tidal overlay to fetch NOAA data"
          }
        >
          NOAA
        </button>
      </div>

      {s.currentsSource === "manual" ? (
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={label}>Dir°</div>
            <input
              type="number"
              min={0}
              max={360}
              step={5}
              value={Math.round(s.currentsManualDirectionDeg)}
              onChange={(e) => s.setCurrentsManualDirectionDeg(Number(e.target.value) || 0)}
              style={input}
              data-testid="currents-manual-dir"
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>Speed (kt)</div>
            <input
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={s.currentsManualSpeedKt}
              onChange={(e) => s.setCurrentsManualSpeedKt(Number(e.target.value) || 0)}
              style={input}
              data-testid="currents-manual-speed"
            />
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 8, fontSize: 10, color: "#94a3b8" }} data-testid="currents-noaa-readout">
          {noaaAmbient ? (
            <>
              <div>
                {noaaAmbient.source === "noaa" ? "NOAA" : "Estimated"}:{" "}
                {noaaAmbient.directionDeg.toFixed(0)}° @{" "}
                {noaaAmbient.speedKt.toFixed(2)} kt
              </div>
              {noaaAmbient.source === "noaa" &&
              (noaaAmbient.stationName || noaaAmbient.stationId) ? (
                <div
                  style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}
                  data-testid="currents-noaa-station"
                >
                  Station:{" "}
                  {noaaAmbient.stationName ?? "—"}
                  {noaaAmbient.stationId ? ` (${noaaAmbient.stationId})` : ""}
                </div>
              ) : noaaAmbient.source === "estimated" ? (
                <div
                  style={{ fontSize: 9, color: "#fbbf24", marginTop: 2 }}
                  data-testid="currents-noaa-estimated"
                >
                  No NOAA station in range — using tide-derived estimate.
                </div>
              ) : null}
            </>
          ) : (
            <span style={{ color: "#fbbf24" }}>
              NOAA unavailable — enable Tidal overlay.
            </span>
          )}
        </div>
      )}

      <div style={{ marginBottom: 8 }}>
        <div style={{ ...label, display: "flex", justifyContent: "space-between" }}>
          <span>Tide Phase</span>
          <span style={{ color: "#94a3b8" }}>{Math.round(s.currentsTidePhase * 100)}%</span>
        </div>
        <TidePhaseSlider
          value={s.currentsTidePhase}
          onChange={s.setCurrentsTidePhase}
        />
        <button
          style={{
            ...toggleBtn(s.currentsAutoAdvance),
            marginTop: 4,
            width: "100%",
            flex: 0,
          }}
          onClick={() => s.setCurrentsAutoAdvance(!s.currentsAutoAdvance)}
          data-testid="currents-auto-advance"
        >
          {s.currentsAutoAdvance ? "◉ AUTO-ADVANCE" : "○ AUTO-ADVANCE"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
        <button
          style={toggleBtn(s.currentsShowParticles)}
          onClick={() => s.setCurrentsShowParticles(!s.currentsShowParticles)}
          data-testid="currents-toggle-particles"
        >
          ✦ PART
        </button>
        <button
          style={toggleBtn(s.currentsShowArrows)}
          onClick={() => s.setCurrentsShowArrows(!s.currentsShowArrows)}
          data-testid="currents-toggle-arrows"
        >
          ➤ ARR
        </button>
        <button
          style={toggleBtn(s.currentsShowStreamlines)}
          onClick={() => s.setCurrentsShowStreamlines(!s.currentsShowStreamlines)}
          data-testid="currents-toggle-streams"
        >
          ∿ FLOW
        </button>
      </div>

      <Legend />

      {field && (
        <div style={{ marginTop: 6, fontSize: 9, color: "#475569" }} data-testid="currents-field-stats">
          Field: {field.resolution}² · max {maxKt.toFixed(2)} kt
        </div>
      )}
    </div>
  );
};

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
