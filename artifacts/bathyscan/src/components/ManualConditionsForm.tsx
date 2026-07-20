/**
 * ManualConditionsForm — lets users enter wind, temperature, and current
 * conditions for freshwater lakes (or any location with no real sensor data).
 *
 * Shows a compact form with:
 *   • Wind speed + direction (8-point compass selector)
 *   • Surface water temperature (optional)
 *   • Current speed + direction (8-point compass selector)
 *   • Water level / stage height (optional)
 *   • "Remember for this lake" checkbox → persists to settingsStore
 *   • Source selector toggle (when real data is also available)
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import type { ManualConditions } from "@/lib/settingsStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useUiStore } from "@/lib/uiStore";
import { formatSpeedFromKnots } from "@/lib/units";
import { computeBlendedDrift, KM_PER_DEG_LAT } from "@/lib/boatPhysics";
import { getBoatProfile, DEFAULT_BOAT_PROFILE_ID } from "@/lib/boatProfiles";

// ── Compass points (8-way) ───────────────────────────────────────────────────
const COMPASS_POINTS: Array<{ label: string; deg: number }> = [
  { label: "N",  deg: 0 },
  { label: "NE", deg: 45 },
  { label: "E",  deg: 90 },
  { label: "SE", deg: 135 },
  { label: "S",  deg: 180 },
  { label: "SW", deg: 225 },
  { label: "W",  deg: 270 },
  { label: "NW", deg: 315 },
];

function nearestCompassDeg(deg: number): number {
  const normalized = ((deg % 360) + 360) % 360;
  let best = COMPASS_POINTS[0]!;
  let bestDiff = 360;
  for (const pt of COMPASS_POINTS) {
    const diff = Math.abs(normalized - pt.deg);
    const wrapped = Math.min(diff, 360 - diff);
    if (wrapped < bestDiff) { bestDiff = wrapped; best = pt; }
  }
  return best.deg;
}

// ── Styles ───────────────────────────────────────────────────────────────────
const FORM_SECTION: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const FIELD_LABEL: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 12,
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  fontWeight: 600,
  marginBottom: 2,
};

const INPUT_STYLE: React.CSSProperties = {
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(0,229,255,0.25)",
  borderRadius: 3,
  color: "#e2e8f0",
  fontSize: 14,
  padding: "3px 7px",
  width: "100%",
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  outline: "none",
};

const INPUT_UNIT: React.CSSProperties = {
  color: "#64748b",
  fontSize: 12,
  marginLeft: 4,
  whiteSpace: "nowrap",
};

const COMPASS_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: 3,
  marginTop: 2,
};

const compassBtn = (active: boolean): React.CSSProperties => ({
  background: active ? "rgba(0,229,255,0.2)" : "rgba(0,0,0,0.3)",
  border: `1px solid ${active ? "rgba(0,229,255,0.7)" : "rgba(100,116,139,0.3)"}`,
  borderRadius: 3,
  color: active ? "#00e5ff" : "#94a3b8",
  cursor: "pointer",
  fontSize: 11,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontWeight: active ? 700 : 400,
  padding: "3px 0",
  textAlign: "center",
  letterSpacing: "0.05em",
});

const DIVIDER: React.CSSProperties = {
  borderColor: "rgba(0,229,255,0.1)",
  margin: "6px 0",
};

const PREVIEW_BOX: React.CSSProperties = {
  background: "rgba(0,229,255,0.06)",
  border: "1px solid rgba(0,229,255,0.15)",
  borderRadius: 3,
  padding: "5px 8px",
  marginTop: 4,
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const PREVIEW_LABEL: React.CSSProperties = {
  color: "#64748b",
  fontSize: 11,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const PREVIEW_VALUE: React.CSSProperties = {
  color: "#7dd3fc",
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
};

const REMEMBER_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginTop: 4,
};

const APPLY_BTN: React.CSSProperties = {
  background: "rgba(0,229,255,0.15)",
  border: "1px solid rgba(0,229,255,0.5)",
  borderRadius: 3,
  color: "#00e5ff",
  cursor: "pointer",
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  letterSpacing: "0.1em",
  padding: "4px 10px",
  marginTop: 6,
};

const SOURCE_TOGGLE_ROW: React.CSSProperties = {
  display: "flex",
  gap: 4,
  marginBottom: 8,
};

const sourceBtn = (active: boolean): React.CSSProperties => ({
  flex: 1,
  background: active ? "rgba(0,229,255,0.18)" : "rgba(0,0,0,0.25)",
  border: `1px solid ${active ? "rgba(0,229,255,0.6)" : "rgba(100,116,139,0.3)"}`,
  borderRadius: 3,
  color: active ? "#00e5ff" : "#64748b",
  cursor: "pointer",
  fontSize: 11,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontWeight: active ? 700 : 400,
  letterSpacing: "0.1em",
  padding: "4px 0",
  textAlign: "center",
});

// ── Drift preview helper ─────────────────────────────────────────────────────

const EIGHT_POINT_LABELS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/**
 * Compute a lightweight 1-hour drift preview from manual conditions.
 *
 * Uses the same blended model as computeDrift (70% current + 30% wind leeway)
 * with the default open-skiff boat profile. Returns the estimated drift
 * distance in km and the compass bearing it moves toward.
 *
 * Exported for unit testing.
 */
export function computeManualDriftPreview(
  conditions: ManualConditions,
  refLat = 45,
): { distKm: number; bearingDeg: number } {
  const profile = getBoatProfile(DEFAULT_BOAT_PROFILE_ID);
  const leewayFactor = profile.leewayFactor * profile.windageFactor;
  const { dLat, dLon } = computeBlendedDrift({
    tidalSpeedKnots: conditions.currentSpeedKnots,
    tidalDegrees: conditions.currentDirectionDeg,
    windSpeedKnots: conditions.windSpeedKnots,
    windDegrees: conditions.windDirectionDeg,
    leewayFactor,
    refLat,
  });
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180);
  const dLatKm = dLat * KM_PER_DEG_LAT;
  const dLonKm = dLon * kmPerDegLon;
  const distKm = Math.sqrt(dLatKm * dLatKm + dLonKm * dLonKm);
  const bearingRad = Math.atan2(dLonKm, dLatKm);
  const bearingDeg = ((bearingRad * 180) / Math.PI + 360) % 360;
  return { distKm, bearingDeg };
}

function bearingToCompass(deg: number): string {
  const idx = Math.round(deg / 45) % 8;
  return EIGHT_POINT_LABELS[idx < 0 ? idx + 8 : idx] ?? "N";
}

// ── Subcomponent: compass direction selector ─────────────────────────────────
function CompassSelector({
  value,
  onChange,
  testId,
}: {
  value: number;
  onChange: (deg: number) => void;
  testId?: string;
}) {
  const active = nearestCompassDeg(value);
  return (
    <div style={COMPASS_GRID} data-testid={testId}>
      {COMPASS_POINTS.map((pt) => (
        <button
          key={pt.label}
          style={compassBtn(active === pt.deg)}
          onClick={() => onChange(pt.deg)}
          data-testid={testId ? `${testId}-${pt.label}` : undefined}
          type="button"
        >
          {pt.label}
        </button>
      ))}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export type ManualConditionsFields = "wind" | "temp" | "current" | "waterLevel";

interface ManualConditionsFormProps {
  datasetId: string;
  /** Which field groups to show. Defaults to all. */
  fields?: ManualConditionsFields[];
  /** When real data is also available, show source selector. */
  realDataAvailable?: boolean;
  activeSource?: 'real' | 'manual';
  onSourceChange?: (source: 'real' | 'manual') => void;
  /** Called when user submits conditions. */
  onApply?: (conditions: ManualConditions) => void;
}

const DEFAULT_CONDITIONS: ManualConditions = {
  windSpeedKnots: 8,
  windDirectionDeg: 225,
  surfaceTempC: null,
  currentSpeedKnots: 0.2,
  currentDirectionDeg: 0,
  waterLevelM: null,
};

export const ManualConditionsForm: React.FC<ManualConditionsFormProps> = ({
  datasetId,
  fields,
  realDataAvailable = false,
  activeSource = 'manual',
  onSourceChange,
  onApply,
}) => {
  const units = useSettingsStore((s) => s.units);
  const persistedConditions = useSettingsStore((s) => s.datasetManualConditions[datasetId]);
  const setDatasetManualConditions = useSettingsStore((s) => s.setDatasetManualConditions);
  const sessionConditions = useUiStore((s) => s.sessionManualConditions[datasetId]);
  const setSessionManualConditions = useUiStore((s) => s.setSessionManualConditions);

  // Resolve initial values: session > persisted > defaults
  const resolved = sessionConditions ?? persistedConditions ?? DEFAULT_CONDITIONS;

  const [draft, setDraft] = useState<ManualConditions>(resolved);
  const [remember, setRemember] = useState<boolean>(!!persistedConditions);
  const [applied, setApplied] = useState<boolean>(false);

  const driftPreview = useMemo(() => computeManualDriftPreview(draft), [draft]);

  const showField = useCallback((f: ManualConditionsFields) => {
    if (!fields || fields.length === 0) return true;
    return fields.includes(f);
  }, [fields]);

  // Sync if persisted conditions change externally (e.g. hydration from server)
  useEffect(() => {
    if (!sessionConditions && persistedConditions) {
      setDraft(persistedConditions);
      setRemember(true);
    }
  }, [persistedConditions, sessionConditions]);

  function handleApply() {
    const clamped: ManualConditions = {
      ...draft,
      windSpeedKnots: Math.max(0, Math.min(80, draft.windSpeedKnots)),
      windDirectionDeg: nearestCompassDeg(draft.windDirectionDeg),
      currentSpeedKnots: Math.max(0, Math.min(20, draft.currentSpeedKnots)),
      currentDirectionDeg: nearestCompassDeg(draft.currentDirectionDeg),
    };
    setSessionManualConditions(datasetId, clamped);
    if (remember) {
      setDatasetManualConditions(datasetId, clamped);
    }
    onApply?.(clamped);
    setApplied(true);
    setTimeout(() => setApplied(false), 1500);
  }

  function patch(partial: Partial<ManualConditions>) {
    setDraft((d) => ({ ...d, ...partial }));
    setApplied(false);
  }

  return (
    <div data-testid="manual-conditions-form" style={{ fontSize: 13 }}>
      {/* Source toggle — only shown when real data is also available */}
      {realDataAvailable && onSourceChange && (
        <div style={SOURCE_TOGGLE_ROW} data-testid="manual-conditions-source-toggle">
          <button
            type="button"
            style={sourceBtn(activeSource === 'real')}
            onClick={() => onSourceChange('real')}
            data-testid="manual-conditions-source-real"
          >
            ◉ STATION
          </button>
          <button
            type="button"
            style={sourceBtn(activeSource === 'manual')}
            onClick={() => onSourceChange('manual')}
            data-testid="manual-conditions-source-manual"
          >
            ✎ MANUAL
          </button>
        </div>
      )}

      {/* When real source is selected, just show the toggle; hide the form */}
      {realDataAvailable && activeSource === 'real' ? null : (
        <div style={FORM_SECTION}>
          {/* Wind */}
          {showField("wind") && (
            <>
              <div>
                <div style={FIELD_LABEL}>Wind</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="number"
                    min={0}
                    max={80}
                    step={0.5}
                    value={draft.windSpeedKnots}
                    onChange={(e) => patch({ windSpeedKnots: Number(e.target.value) })}
                    style={{ ...INPUT_STYLE, width: 70 }}
                    data-testid="manual-conditions-wind-speed"
                  />
                  <span style={INPUT_UNIT}>kn</span>
                </div>
                <CompassSelector
                  value={draft.windDirectionDeg}
                  onChange={(deg) => patch({ windDirectionDeg: deg })}
                  testId="manual-conditions-wind-dir"
                />
              </div>
              {(showField("temp") || showField("current") || showField("waterLevel")) && (
                <hr style={DIVIDER} />
              )}
            </>
          )}

          {/* Surface temperature */}
          {showField("temp") && (
            <>
              <div>
                <div style={FIELD_LABEL}>Surface temp</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="number"
                    min={-5}
                    max={45}
                    step={0.5}
                    placeholder="—"
                    value={draft.surfaceTempC === null ? "" : draft.surfaceTempC}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      patch({ surfaceTempC: v });
                    }}
                    style={{ ...INPUT_STYLE, width: 70 }}
                    data-testid="manual-conditions-temp"
                  />
                  <span style={INPUT_UNIT}>°C</span>
                </div>
              </div>
              {(showField("current") || showField("waterLevel")) && (
                <hr style={DIVIDER} />
              )}
            </>
          )}

          {/* Current */}
          {showField("current") && (
            <>
              <div>
                <div style={FIELD_LABEL}>Current</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    step={0.1}
                    value={draft.currentSpeedKnots}
                    onChange={(e) => patch({ currentSpeedKnots: Number(e.target.value) })}
                    style={{ ...INPUT_STYLE, width: 70 }}
                    data-testid="manual-conditions-current-speed"
                  />
                  <span style={INPUT_UNIT}>{formatSpeedFromKnots(1, { units }).replace(/[\d.]+/, "").trim() === "" ? "kn" : `kn (${formatSpeedFromKnots(draft.currentSpeedKnots, { units })})`}</span>
                </div>
                <CompassSelector
                  value={draft.currentDirectionDeg}
                  onChange={(deg) => patch({ currentDirectionDeg: deg })}
                  testId="manual-conditions-current-dir"
                />
              </div>
              {showField("waterLevel") && <hr style={DIVIDER} />}
            </>
          )}

          {/* Water level */}
          {showField("waterLevel") && (
            <div>
              <div style={FIELD_LABEL}>Water level</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  type="number"
                  min={-10}
                  max={30}
                  step={0.01}
                  placeholder="—"
                  value={draft.waterLevelM === null ? "" : draft.waterLevelM}
                  onChange={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    patch({ waterLevelM: v });
                  }}
                  style={{ ...INPUT_STYLE, width: 70 }}
                  data-testid="manual-conditions-water-level"
                />
                <span style={INPUT_UNIT}>m</span>
              </div>
            </div>
          )}

          {/* Drift preview */}
          <div style={PREVIEW_BOX} data-testid="manual-conditions-drift-preview">
            <span style={PREVIEW_LABEL}>Drift 1 h:</span>
            <span style={PREVIEW_VALUE} data-testid="manual-conditions-drift-preview-value">
              ~{driftPreview.distKm < 0.1 ? "<0.1" : driftPreview.distKm.toFixed(1)} km{" "}
              {bearingToCompass(driftPreview.bearingDeg)}
            </span>
          </div>

          {/* Remember + Apply */}
          <div style={REMEMBER_ROW}>
            <input
              id={`manual-remember-${datasetId}`}
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              data-testid="manual-conditions-remember"
              style={{ accentColor: "#00e5ff", cursor: "pointer" }}
            />
            <label
              htmlFor={`manual-remember-${datasetId}`}
              style={{ color: "#94a3b8", fontSize: 12, cursor: "pointer" }}
            >
              Remember for this lake
            </label>
          </div>
          <button
            type="button"
            style={APPLY_BTN}
            onClick={handleApply}
            data-testid="manual-conditions-apply"
          >
            {applied ? "✓ Applied" : "▶ Apply"}
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * Utility: get the effective manual conditions for a dataset, preferring
 * session-only values over persisted ones.
 */
export function resolveManualConditions(
  datasetId: string,
  session: Record<string, ManualConditions>,
  persisted: Record<string, ManualConditions>,
): ManualConditions | null {
  return session[datasetId] ?? persisted[datasetId] ?? null;
}
