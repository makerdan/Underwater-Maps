import React, { useEffect, useRef, useState } from "react";
import { useAppState } from "@/lib/context";
import { colormapCanvas } from "@/lib/colormap";
import { useSettingsStore } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import { formatDepth } from "@/lib/units";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";

/**
 * DepthScaleBar — compact, collapsible depth-colour legend pinned to the
 * top-right of the scene, just below the app header.
 *
 * Collapsed (default): a single horizontal swatch + "DEPTH" label + chevron.
 * Expanded: the full vertical depth ramp with min/mid/max depth values.
 *
 * Open/closed state is purely component-local (not persisted).
 */
export const DepthScaleBar: React.FC = () => {
  const { terrain } = useAppState();
  const expandedImgRef = useRef<HTMLImageElement>(null);
  const collapsedImgRef = useRef<HTMLImageElement>(null);
  const colormapTheme = useSettingsStore((s) => s.colormapTheme);
  const units = useSettingsStore((s) => s.units);
  const shallow = usePaletteStore((s) => s.shallow);
  const deep = usePaletteStore((s) => s.deep);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!terrain) return;
    // Vertical ramp for the expanded view.
    if (expandedImgRef.current) {
      const canvas = colormapCanvas(20, 200, colormapTheme);
      expandedImgRef.current.src = canvas.toDataURL();
    }
    // Horizontal mini-swatch for the collapsed header (rotated via CSS).
    if (collapsedImgRef.current) {
      const canvas = colormapCanvas(20, 80, colormapTheme);
      collapsedImgRef.current.src = canvas.toDataURL();
    }
  }, [colormapTheme, shallow, deep, terrain, expanded]);

  if (!terrain) return null;

  return (
    <div
      data-testid="depth-scale-bar"
      style={{
        position: "absolute",
        top: 48,
        right: 12,
        zIndex: 25,
        pointerEvents: "auto",
        background: "rgba(2,8,18,0.9)",
        border: "1px solid rgba(0,229,255,0.28)",
        borderRadius: 6,
        backdropFilter: "blur(6px)",
        fontFamily: "'JetBrains Mono', monospace",
        color: "#00e5ff",
        textShadow: "0 0 6px rgba(0,229,255,0.5)",
        userSelect: "none",
      }}
    >
      <ViewscreenTooltip
        label={expanded ? "Collapse depth legend" : "Expand depth legend"}
        side="left"
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label="Toggle depth legend"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 8px",
            background: "transparent",
            border: "none",
            color: "inherit",
            fontFamily: "inherit",
            fontSize: 10,
            letterSpacing: "0.15em",
            cursor: "pointer",
            width: "100%",
          }}
        >
          <img
            ref={collapsedImgRef}
            alt=""
            aria-hidden
            style={{
              width: 36,
              height: 8,
              transform: "rotate(90deg)",
              transformOrigin: "center",
              borderRadius: 2,
              border: "1px solid rgba(0,229,255,0.25)",
              display: "block",
            }}
          />
          <span style={{ fontWeight: 700 }}>DEPTH</span>
          <span style={{ marginLeft: "auto", fontSize: 12, lineHeight: 1 }}>
            {expanded ? "▴" : "▾"}
          </span>
        </button>
      </ViewscreenTooltip>

      {expanded && (
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            gap: 8,
            padding: "6px 10px 10px",
            borderTop: "1px solid rgba(0,229,255,0.12)",
            height: 220,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              alignItems: "flex-end",
              fontSize: 10,
              lineHeight: 1,
              fontFamily: "'JetBrains Mono', monospace",
              color: "#00e5ff",
              textShadow: "0 0 6px rgba(0,229,255,0.5)",
            }}
          >
            <span>{formatDepth(terrain.minDepth, { units })}</span>
            <span>{formatDepth((terrain.minDepth + terrain.maxDepth) / 2, { units })}</span>
            <span>{formatDepth(terrain.maxDepth, { units })}</span>
          </div>
          <ViewscreenTooltip label="Colour scale for seafloor depth" side="left">
            <img
              ref={expandedImgRef}
              alt="depth colormap"
              style={{
                width: 14,
                height: 200,
                border: "1px solid rgba(0,229,255,0.2)",
                borderRadius: 2,
                display: "block",
              }}
            />
          </ViewscreenTooltip>
        </div>
      )}
    </div>
  );
};
