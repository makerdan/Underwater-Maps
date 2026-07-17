/**
 * SeafloorClassificationPanel — unified sidebar panel that combines
 * the Substrate overlay toggle and the Zone Analysis / Zone Colours controls.
 *
 * Replaces the standalone ZoneOverlay embedded in the "Map & Data" section
 * and the hidden `substrateColorMode` toggle buried in the Overlays panel.
 * The two features are surfaced together here because zone colours directly
 * tint substrate polygons when both are active — making the relationship
 * obvious and reducing user confusion.
 *
 * Rendered via <SidebarSectionGroup> + <SidebarSection id="seafloorClassification">
 * in App.tsx.  The ZoneOverlay component is reused with `embedded={true}` so
 * all existing classification, paint-mode, and undo/redo logic is unchanged.
 */
import React from "react";
import { useUiStore } from "@/lib/uiStore";
import { useClassificationStore } from "@/lib/classificationStore";
import { ZoneOverlay } from "@/components/ZoneOverlay";
import { AdvancedSection } from "@/components/AdvancedSection";

const MONO = "'JetBrains Mono', 'Fira Code', monospace";

const CYAN: React.CSSProperties = {
  color: "#00e5ff",
  textShadow: "0 0 6px rgba(0,229,255,0.5)",
};

export const SeafloorClassificationPanel: React.FC = () => {
  const substrateEnabled = useUiStore((s) => s.substrateColorMode);
  const setSubstrateEnabled = useUiStore((s) => s.setSubstrateColorMode);
  const zoneOverlayEnabled = useUiStore((s) => s.zoneOverlayEnabled);
  const zonePaintMode = useUiStore((s) => s.zonePaintMode);
  const zoneMapReady = useClassificationStore((s) => s.zoneMap !== null);

  const bothActive = substrateEnabled && zoneOverlayEnabled;
  const activePaintMode = zonePaintMode && zoneOverlayEnabled;

  return (
    <div style={{ fontFamily: MONO, fontSize: 18 }}>
      {/* ── Sub-mode indicator row ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px 4px",
          borderBottom: "1px dashed rgba(0,229,255,0.08)",
        }}
      >
        <span
          style={{
            fontSize: 13.5,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: !activePaintMode ? "#00e5ff" : "#475569",
            fontWeight: !activePaintMode ? 700 : 400,
            textShadow: !activePaintMode ? "0 0 6px rgba(0,229,255,0.4)" : "none",
            transition: "color 0.15s",
          }}
        >
          VIEW
        </span>
        <span style={{ fontSize: 13.5, color: "#334155", letterSpacing: "0.1em" }}>|</span>
        <span
          style={{
            fontSize: 13.5,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: activePaintMode ? "#fb923c" : "#475569",
            fontWeight: activePaintMode ? 700 : 400,
            textShadow: activePaintMode ? "0 0 6px rgba(251,146,60,0.5)" : "none",
            transition: "color 0.15s",
          }}
        >
          PAINT
        </span>
        {activePaintMode && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 12,
              letterSpacing: "0.12em",
              color: "#fb923c",
              background: "rgba(251,146,60,0.1)",
              border: "1px solid rgba(251,146,60,0.3)",
              borderRadius: 3,
              padding: "1px 5px",
            }}
          >
            ACTIVE
          </span>
        )}
      </div>

      {/* ── Substrate toggle ── */}
      <div style={{ padding: "8px 12px", borderBottom: "1px dashed rgba(0,229,255,0.10)" }}>
        <div
          style={{
            fontSize: 13.5,
            letterSpacing: "0.15em",
            color: "#94a3b8",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          ShoreZone Substrate Layer
        </div>
        <button
          data-testid="seafloor-substrate-toggle"
          aria-pressed={substrateEnabled}
          onClick={() => setSubstrateEnabled(!substrateEnabled)}
          className="w-full text-left flex items-center gap-2 hover:bg-white/5 rounded transition-colors"
          style={{ cursor: "pointer", padding: "2px 0" }}
        >
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              borderRadius: 2,
              border: substrateEnabled
                ? "1.5px solid #00e5ff"
                : "1.5px solid #cbd5e1",
              background: substrateEnabled
                ? "rgba(0,229,255,0.2)"
                : "transparent",
              flexShrink: 0,
              transition: "all 0.15s",
            }}
          >
            {substrateEnabled && (
              <span
                style={{
                  display: "block",
                  textAlign: "center",
                  lineHeight: "10px",
                  fontSize: 12,
                  color: "#00e5ff",
                }}
              >
                ✓
              </span>
            )}
          </span>
          <span
            style={{
              fontSize: 16.5,
              color: substrateEnabled ? "#00e5ff" : "#cbd5e1",
              transition: "color 0.15s",
            }}
          >
            Show substrate polygons
          </span>
        </button>
        <div
          style={{
            marginTop: 4,
            fontSize: 13.5,
            color: "#475569",
            letterSpacing: "0.04em",
            lineHeight: 1.45,
          }}
        >
          Drapes real ShoreZone polygon boundaries over the terrain.
        </div>
      </div>

      {/* ── Zone colours ↔ substrate callout ── */}
      {(substrateEnabled || zoneOverlayEnabled) && (
        <div
          style={{
            margin: "6px 12px",
            padding: "5px 8px",
            border: `1px solid ${bothActive ? "rgba(0,229,255,0.3)" : "rgba(100,116,139,0.25)"}`,
            borderRadius: 4,
            background: bothActive
              ? "rgba(0,229,255,0.05)"
              : "rgba(30,41,59,0.4)",
          }}
        >
          <div
            style={{
              fontSize: 13.5,
              color: bothActive ? "#00e5ff" : "#64748b",
              letterSpacing: "0.06em",
              lineHeight: 1.5,
              transition: "color 0.2s",
            }}
          >
            {bothActive ? (
              <>
                <span style={CYAN}>◈</span>{" "}
                Zone colours are tinting substrate polygons by category.
                Turn off either to decouple them.
              </>
            ) : (
              <>
                ◈ Enable both <em>Show substrate polygons</em> and{" "}
                <em>Show zone colours</em> below to tint polygons by zone
                category.
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Zone Analysis — behind Advanced toggle (paint brush, zone colours, classification) ── */}
      <AdvancedSection panelId="seafloorAdvanced" indicator={zoneMapReady}>
        <div style={{ padding: "4px 0 4px 0" }}>
          <ZoneOverlay embedded />
        </div>
      </AdvancedSection>
    </div>
  );
};
