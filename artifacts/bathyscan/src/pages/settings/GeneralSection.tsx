import React from "react";
import { useLocation } from "wouter";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore, type WaterType } from "@/lib/settingsStore";
import { clearStaleDefaultMapLoad } from "@/lib/clearStaleDefaultMapLoad";
import { DefaultMapLoadPicker } from "@/components/DefaultMapLoadPicker";
import { S, FONT } from "./styles";
import { SectionActionsRow } from "./components/SyncContext";
import { SelectRow } from "./components/RowWidgets";

export function GeneralSection() {
  const s = useSettingsStore(useShallow((s) => s));
  const [, setLocation] = useLocation();

  const handleReplayTour = () => {
    s.setHasSeenOnboarding(false);
    setLocation("/");
  };

  const handleWaterTypeChange = (wt: WaterType) => {
    s.setWaterType(wt);
    // A preset Default Map Load is water-type specific — reconcile it via
    // the shared helper (also used by the compact HUD WaterTypeToggle so
    // the two switch entry points cannot drift apart).
    void clearStaleDefaultMapLoad(wt);
  };
  return (
    <>
      <h2 style={S.sectionTitle}>◈ GENERAL</h2>
      <SectionActionsRow sections={["environment", "hud", "data"]} withReset={false} />
      {/* Environment card */}
      <div style={S.card}>
        <div style={S.row}>
          <div>
            <div style={S.label}>Exploration Mode</div>
            <div style={S.sublabel}>
              Switches datasets, species, marker types, and AI guidance
            </div>
          </div>
          <div role="radiogroup" aria-label="Water type" style={{ display: "flex", gap: 6 }}>
            {(["saltwater", "freshwater"] as const).map((wt) => {
              const active = s.waterType === wt;
              const color = wt === "freshwater" ? "#4ade80" : "#00e5ff";
              return (
                <button
                  key={wt}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`settings-water-type-${wt}`}
                  onClick={() => handleWaterTypeChange(wt)}
                  style={{
                    fontSize: "calc(9px * var(--bs-font-scale, 1))",
                    letterSpacing: "0.15em",
                    padding: "4px 12px",
                    borderRadius: 4,
                    border: `1px solid ${active ? color : "rgba(0,229,255,0.18)"}`,
                    background: active ? `${color}14` : "transparent",
                    color: active ? color : "#94a3b8",
                    cursor: "pointer",
                    fontFamily: FONT,
                    transition: "all 0.12s",
                  }}
                >
                  {wt === "saltwater" ? "≈ SALTWATER" : "~ FRESHWATER"}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ padding: "10px 16px 12px", fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#94a3b8", lineHeight: 1.6 }}>
          {s.waterType === "freshwater" ? (
            <span style={{ color: "#4ade80", fontSize: "calc(9px * var(--bs-font-scale, 1))", letterSpacing: "0.08em" }}>
              ~ Freshwater mode: lakes, reservoirs, freshwater species, limnology AI context.
            </span>
          ) : (
            <span style={{ color: "#00e5ff", fontSize: "calc(9px * var(--bs-font-scale, 1))", letterSpacing: "0.08em" }}>
              ≈ Saltwater mode: ocean datasets, marine species, marine geology AI context.
            </span>
          )}
        </div>
      </div>
      {/* Units card */}
      <div style={S.card}>
        <div style={S.cardHeader}>UNITS</div>
        <SelectRow
          label="Units"
          value={s.units}
          onChange={s.setUnits}
          options={[
            { value: "metric", label: "Metric (m, km/h)" },
            { value: "imperial", label: "Imperial (ft, mph)" },
            { value: "nautical", label: "Nautical (ft, kn)" },
          ]}
          sublabel="Switching also updates depth (unless you've picked a different depth unit below) and temperature (when set to Auto)"
        />
        <SelectRow
          label="Depth Unit"
          value={s.depthUnit}
          onChange={s.setDepthUnit}
          options={[
            { value: "metres", label: "Metres" },
            { value: "feet", label: "Feet" },
          ]}
          sublabel="Override depth display unit independently of the global units system"
        />
        <SelectRow
          label="Temperature Unit"
          value={s.temperatureUnit}
          onChange={s.setTemperatureUnit}
          options={[
            { value: "auto", label: "Auto (follow Units)" },
            { value: "celsius", label: "Celsius (°C)" },
            { value: "fahrenheit", label: "Fahrenheit (°F)" },
          ]}
          sublabel="Override temperature display unit independently of the global units system"
        />
      </div>
      {/* Startup Defaults card */}
      <div style={S.card}>
        <div style={S.cardHeader}>STARTUP DEFAULTS</div>
        <div style={S.row}>
          <div>
            <div style={S.label}>Default Map Load</div>
            <div style={S.sublabel}>Dataset that opens automatically on every launch</div>
          </div>
          <DefaultMapLoadPicker
            value={s.defaultMapLoad}
            onChange={s.setDefaultMapLoad}
          />
        </div>
        {/* No bundled preset regions exist yet, so show a plain note instead
            of a single-option (non-functional) selector. Restore a SelectRow
            here once bundled regions ship. */}
        <div style={{ ...S.row, borderBottom: "none" }}>
          <div>
            <div style={S.label}>Default Region</div>
            <p style={{ ...S.sublabel, margin: "2px 0 0" }} data-testid="default-region-note">
              No bundled regions available. Upload your own data or save a
              dataset from Find Data to use as a default.
            </p>
          </div>
        </div>
      </div>
      {/* Guided Tour card — restored after the Settings.tsx split dropped it
          (e2e contract: replay-tour-btn lives in the GENERAL tab). */}
      <div style={S.card}>
        <div style={S.cardHeader}>GUIDED TOUR</div>
        <div style={S.row}>
          <div>
            <div style={S.label}>Replay App Tour</div>
            <div style={S.sublabel}>Reset the onboarding tour and restart it from the beginning</div>
          </div>
          <button
            type="button"
            data-testid="replay-tour-btn"
            onClick={handleReplayTour}
            style={{
              background: "rgba(0,229,255,0.08)",
              border: "1px solid rgba(0,229,255,0.3)",
              borderRadius: 4,
              color: "#00e5ff",
              fontSize: "calc(9px * var(--bs-font-scale, 1))",
              letterSpacing: "0.15em",
              padding: "6px 14px",
              cursor: "pointer",
              fontFamily: FONT,
              transition: "background 0.1s",
              flexShrink: 0,
            }}
          >
            ▶ REPLAY TOUR
          </button>
        </div>
        <div style={{ ...S.row, borderBottom: "none" }}>
          <div>
            <div style={S.label}>Tour status</div>
            <div style={S.sublabel}>
              Whether you have already completed or skipped the guided tour.
            </div>
          </div>
          <span
            style={{
              fontSize: "calc(9px * var(--bs-font-scale, 1))",
              letterSpacing: "0.15em",
              color: s.hasSeenOnboarding ? "#4ade80" : "#fbbf24",
              fontFamily: FONT,
            }}
          >
            {s.hasSeenOnboarding ? "✓ COMPLETED" : "NOT STARTED"}
          </span>
        </div>
      </div>
    </>
  );
}
