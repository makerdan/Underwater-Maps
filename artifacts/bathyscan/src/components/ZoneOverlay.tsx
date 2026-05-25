/**
 * ZoneOverlay — AI seafloor classification status badge and zone legend.
 *
 * Shows:
 *  • A pulsing "Analysing terrain…" indicator while classification is running.
 *  • A toggle button to enable/disable the zone colour overlay on the mesh.
 *  • A compact legend listing ALL 8 AI zone labels with their shader-slot colours.
 *
 * Rendered as a DOM overlay (pointer-events: auto) positioned in the HUD.
 * The actual shader tinting is driven by uiStore.zoneOverlayEnabled which
 * TerrainMesh reads every frame via useUiStore.getState().
 */
import React from "react";
import { useClassificationStore } from "@/lib/classificationStore";
import { useUiStore } from "@/lib/uiStore";
import { useAppState } from "@/lib/context";
import {
  SALTWATER_ZONES,
  FRESHWATER_ZONES,
  SALTWATER_ZONE_TO_SLOT,
  FRESHWATER_ZONE_TO_SLOT,
} from "@/lib/zoneMap";

// Pastel hex colours matching terrainShader.ts ZONE_TINT_COLORS (indexed by slot 0–3)
const SLOT_COLORS = ["#f5d58a", "#c49a6c", "#8ab4d0", "#b06060"] as const;

/** Human-readable label for a raw zone key. */
function formatZoneLabel(key: string): string {
  return key.replace(/_/g, " ");
}

const PANEL: React.CSSProperties = {
  background: "rgba(2,8,18,0.94)",
  border: "1px solid rgba(0,229,255,0.28)",
  borderRadius: 6,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  color: "#cbd5e1",
  fontSize: 12,
  backdropFilter: "blur(6px)",
  pointerEvents: "auto",
  minWidth: 200,
  maxWidth: 240,
};

const CYAN: React.CSSProperties = {
  color: "#00e5ff",
  textShadow: "0 0 6px rgba(0,229,255,0.5)",
};

export const ZoneOverlay: React.FC = () => {
  const { terrain } = useAppState();
  const loading = useClassificationStore((s) => s.loading);
  const zoneMap = useClassificationStore((s) => s.zoneMap);
  const error = useClassificationStore((s) => s.error);
  const overlayEnabled = useUiStore((s) => s.zoneOverlayEnabled);
  const setOverlayEnabled = useUiStore((s) => s.setZoneOverlayEnabled);
  const paintMode = useUiStore((s) => s.zonePaintMode);
  const setPaintMode = useUiStore((s) => s.setZonePaintMode);
  const paintSlot = useUiStore((s) => s.zonePaintSlot);
  const setPaintSlot = useUiStore((s) => s.setZonePaintSlot);
  const hasEdits = useClassificationStore((s) => s.hasEdits);
  const resetToAi = useClassificationStore((s) => s.resetToAi);

  // Only show this panel when there's a terrain loaded
  if (!terrain) return null;

  const waterType = terrain.waterType as "saltwater" | "freshwater";
  const zones = waterType === "freshwater" ? FRESHWATER_ZONES : SALTWATER_ZONES;
  const zoneToSlot = waterType === "freshwater" ? FRESHWATER_ZONE_TO_SLOT : SALTWATER_ZONE_TO_SLOT;
  const hasZoneMap = !!zoneMap;

  return (
    <div style={PANEL}>
      {/* Header */}
      <div
        className="px-3 py-2 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(0,229,255,0.08)" }}
      >
        <span
          className="uppercase tracking-widest"
          style={{ fontSize: 11, ...CYAN, fontWeight: 700 }}
        >
          ◈ Zone Analysis
        </span>
        {loading && (
          <span className="animate-spin" style={{ fontSize: 10, color: "#00e5ff" }}>
            ◌
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        {/* Loading state */}
        {loading && (
          <div style={{ fontSize: 11, color: "#cbd5e1", marginBottom: 6 }}>
            <span className="animate-pulse">Analysing terrain</span>
            <span style={{ color: "#94a3b8" }}> (3–8 s)</span>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div style={{ fontSize: 11, color: "#fca5a5", marginBottom: 6 }}>
            Classification unavailable
          </div>
        )}

        {/* Overlay toggle — only visible when zone map is ready */}
        {hasZoneMap && !loading && (
          <button
            data-testid="zone-toggle"
            aria-pressed={overlayEnabled}
            onClick={() => setOverlayEnabled(!overlayEnabled)}
            className="w-full text-left flex items-center gap-2 mb-2 hover:bg-white/5 rounded transition-colors"
            style={{ cursor: "pointer", padding: "3px 0" }}
          >
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                borderRadius: 2,
                border: overlayEnabled ? "1.5px solid #00e5ff" : "1.5px solid #334155",
                background: overlayEnabled ? "rgba(0,229,255,0.2)" : "transparent",
                flexShrink: 0,
                transition: "all 0.15s",
              }}
            >
              {overlayEnabled && (
                <span
                  style={{
                    display: "block",
                    textAlign: "center",
                    lineHeight: "10px",
                    fontSize: 8,
                    color: "#00e5ff",
                  }}
                >
                  ✓
                </span>
              )}
            </span>
            <span
              style={{
                fontSize: 11,
                color: overlayEnabled ? "#00e5ff" : "#cbd5e1",
                transition: "color 0.15s",
              }}
            >
              Show zone colours
            </span>
          </button>
        )}

        {/* Zone legend — all 8 AI zone labels with their shader-slot colour */}
        {hasZoneMap && !loading && (
          <div className="zone-legend" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {zones.map((zone, i) => {
              const slot = zoneToSlot[i] ?? 0;
              const color = SLOT_COLORS[slot] ?? SLOT_COLORS[0];
              return (
                <div key={zone} className="flex items-center gap-2">
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: color,
                      flexShrink: 0,
                      opacity: overlayEnabled ? 1 : 0.45,
                      transition: "opacity 0.15s",
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      color: overlayEnabled ? "#e2e8f0" : "#94a3b8",
                      letterSpacing: "0.04em",
                      transition: "color 0.15s",
                    }}
                  >
                    {formatZoneLabel(zone)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Paint mode controls — only meaningful when overlay is on */}
        {hasZoneMap && !loading && overlayEnabled && (
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: "1px solid rgba(0,229,255,0.08)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <button
              data-testid="zone-paint-toggle"
              aria-pressed={paintMode}
              onClick={() => setPaintMode(!paintMode)}
              className="w-full text-left flex items-center gap-2 hover:bg-white/5 rounded transition-colors"
              style={{ cursor: "pointer", padding: "3px 0" }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  border: paintMode ? "1.5px solid #00e5ff" : "1.5px solid #334155",
                  background: paintMode ? "rgba(0,229,255,0.2)" : "transparent",
                  flexShrink: 0,
                  textAlign: "center",
                  lineHeight: "10px",
                  fontSize: 8,
                  color: "#00e5ff",
                }}
              >
                {paintMode ? "✎" : ""}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: paintMode ? "#00e5ff" : "#cbd5e1",
                  transition: "color 0.15s",
                }}
              >
                Paint mode
              </span>
            </button>

            {paintMode && (
              <>
                <div style={{ fontSize: 10, color: "#cbd5e1", letterSpacing: "0.05em" }}>
                  Click &amp; drag on the terrain to repaint
                </div>
                <div
                  data-testid="zone-paint-swatches"
                  style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
                >
                  {SLOT_COLORS.map((color, i) => {
                    const active = paintSlot === i;
                    return (
                      <button
                        key={i}
                        data-testid={`zone-paint-swatch-${i}`}
                        aria-label={`Paint slot ${i}`}
                        aria-pressed={active}
                        onClick={() => setPaintSlot(i as 0 | 1 | 2 | 3)}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 4,
                          background: color,
                          cursor: "pointer",
                          border: active
                            ? "2px solid #00e5ff"
                            : "2px solid rgba(255,255,255,0.08)",
                          boxShadow: active ? "0 0 6px rgba(0,229,255,0.6)" : "none",
                          transition: "all 0.12s",
                          padding: 0,
                        }}
                      />
                    );
                  })}
                </div>
              </>
            )}

            {hasEdits && (
              <button
                data-testid="zone-reset-ai"
                onClick={() => resetToAi()}
                style={{
                  fontSize: 11,
                  color: "#cbd5e1",
                  background: "transparent",
                  border: "1px solid rgba(0,229,255,0.28)",
                  borderRadius: 3,
                  padding: "4px 6px",
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                  textAlign: "left",
                }}
              >
                ↺ Reset to AI
              </button>
            )}
          </div>
        )}

        {/* Waiting state */}
        {!hasZoneMap && !loading && !error && (
          <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.05em" }}>
            Load a dataset to classify
          </div>
        )}
      </div>
    </div>
  );
};
