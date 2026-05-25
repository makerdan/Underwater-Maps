/**
 * ZoneOverlay — AI seafloor classification status badge and zone legend.
 *
 * Shows:
 *  • A pulsing "Analysing terrain…" indicator while classification is running.
 *  • A toggle button to enable/disable the zone colour overlay on the mesh.
 *  • A compact legend listing zone names with their pastel colour swatches.
 *
 * Rendered as a DOM overlay (pointer-events: auto) positioned in the HUD.
 * The actual shader tinting is driven by uiStore.zoneOverlayEnabled which
 * TerrainMesh reads every frame via useUiStore.getState().
 */
import React from "react";
import { useClassificationStore } from "@/lib/classificationStore";
import { useUiStore } from "@/lib/uiStore";
import { useAppState } from "@/lib/context";
import { SLOT_NAMES_SALTWATER, SLOT_NAMES_FRESHWATER } from "@/lib/zoneMap";

// Pastel hex colours matching terrainShader.ts ZONE_TINT_COLORS
const SWATCH_COLORS = ["#f5d58a", "#c49a6c", "#8ab4d0", "#b06060"] as const;

const PANEL: React.CSSProperties = {
  background: "rgba(0,10,20,0.82)",
  border: "1px solid rgba(0,229,255,0.18)",
  borderRadius: 6,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  color: "#94a3b8",
  fontSize: 11,
  backdropFilter: "blur(6px)",
  pointerEvents: "auto",
  minWidth: 168,
  maxWidth: 220,
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

  // Only show this panel when there's a terrain loaded
  if (!terrain) return null;

  const waterType = terrain.waterType as "saltwater" | "freshwater";
  const slotNames = waterType === "freshwater" ? SLOT_NAMES_FRESHWATER : SLOT_NAMES_SALTWATER;
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
          style={{ fontSize: 10, ...CYAN, fontWeight: 700 }}
        >
          ◈ Zone Analysis
        </span>
        {loading && (
          <span
            className="animate-spin"
            style={{ fontSize: 10, color: "#00e5ff" }}
          >
            ◌
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        {/* Loading state */}
        {loading && (
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>
            <span className="animate-pulse">Analysing terrain</span>
            <span style={{ color: "#334155" }}> (3–8 s)</span>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div style={{ fontSize: 10, color: "#f87171", marginBottom: 6 }}>
            Classification unavailable
          </div>
        )}

        {/* Overlay toggle — only visible when zone map is ready */}
        {hasZoneMap && !loading && (
          <button
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
                border: overlayEnabled
                  ? "1.5px solid #00e5ff"
                  : "1.5px solid #334155",
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
                fontSize: 10,
                color: overlayEnabled ? "#00e5ff" : "#475569",
                transition: "color 0.15s",
              }}
            >
              Show zone colours
            </span>
          </button>
        )}

        {/* Zone legend — always shown once map is ready, overlay-toggle independent */}
        {hasZoneMap && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {SWATCH_COLORS.map((color, i) => (
              <div key={i} className="flex items-center gap-2">
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
                    fontSize: 9,
                    color: overlayEnabled ? "#94a3b8" : "#334155",
                    letterSpacing: "0.04em",
                    transition: "color 0.15s",
                  }}
                >
                  {slotNames[i]}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Waiting state (no error, no map, not loading = waiting for first dataset) */}
        {!hasZoneMap && !loading && !error && (
          <div style={{ fontSize: 9, color: "#1e293b", letterSpacing: "0.05em" }}>
            Load a dataset to classify
          </div>
        )}
      </div>
    </div>
  );
};
