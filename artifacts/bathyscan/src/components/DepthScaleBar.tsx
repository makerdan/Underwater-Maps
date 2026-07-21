import React, { useEffect, useRef, useState } from "react";
import { useAppState } from "@/lib/context";
import { colormapCanvas } from "@/lib/colormap";
import { useSettingsStore } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import { formatDepth } from "@/lib/units";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";

const FT_TO_M = 0.3048;

/**
 * DepthScaleBar — compact, collapsible depth-colour legend pinned to the
 * top-right of the scene, just below the app header.
 *
 * Collapsed (default): a single horizontal swatch + "DEPTH" label + chevron.
 * Expanded: the full vertical depth ramp (200 px) with tick labels at each of
 * the 10 band boundaries that fall within the dataset's actual depth range.
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
  const bandColorsKey = usePaletteStore((s) => s.bandColors.join(","));
  const bandBoundaries = usePaletteStore((s) => s.bandBoundaries);
  const blendBands = usePaletteStore((s) => s.blendBands);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!terrain) return;
    // Vertical ramp for the expanded view. Generated even while collapsed so
    // expanding the legend doesn't show a one-frame blank — and so the
    // colormap canvas is exercised with its canonical 200px height for tests.
    const range = { min: terrain.minDepth, max: terrain.maxDepth };
    const expandedCanvas = colormapCanvas(20, 200, colormapTheme, range);
    if (expandedImgRef.current) {
      expandedImgRef.current.src = expandedCanvas.toDataURL();
    }
    // Horizontal mini-swatch for the collapsed header (rotated via CSS).
    if (collapsedImgRef.current) {
      const canvas = colormapCanvas(20, 80, colormapTheme, range);
      collapsedImgRef.current.src = canvas.toDataURL();
    }
  }, [colormapTheme, shallow, deep, bandColorsKey, bandBoundaries, blendBands, terrain, expanded]);

  if (!terrain) return null;

  const rampHeight = 200;

  // Build tick list: convert each band boundary from feet to metres,
  // compute its normalised position, and discard anything outside [0, 1].
  // Guard against a flat dataset (all points at the same depth).
  const activeBoundaries = Array.isArray(bandBoundaries) && bandBoundaries.length >= 3
    ? bandBoundaries
    : [];
  const depthSpan = terrain.maxDepth - terrain.minDepth;
  const ticks = depthSpan <= 0
    ? []
    : activeBoundaries.flatMap((boundaryFt) => {
        const boundaryM = boundaryFt * FT_TO_M;
        const pos = (boundaryM - terrain.minDepth) / depthSpan;
        if (pos < 0 || pos > 1) return [];
        return [{ label: formatDepth(boundaryM, { units }), pos }];
      });

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
            fontSize: "calc(15px * var(--bs-font-scale, 1))",
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
          <span style={{ marginLeft: "auto", fontSize: "calc(18px * var(--bs-font-scale, 1))", lineHeight: 1 }}>
            {expanded ? "▴" : "▾"}
          </span>
        </button>
      </ViewscreenTooltip>

      {expanded && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            padding: "6px 10px 10px",
            borderTop: "1px solid rgba(0,229,255,0.12)",
          }}
        >
          {/* Tick labels — absolutely positioned relative to ramp height */}
          <div
            data-testid="depth-scale-ticks"
            style={{
              position: "relative",
              width: 52,
              height: rampHeight,
              flexShrink: 0,
            }}
          >
            {ticks.map(({ label, pos }) => (
              <span
                key={label}
                data-testid="depth-tick"
                style={{
                  position: "absolute",
                  right: 0,
                  top: pos * rampHeight,
                  transform: "translateY(-50%)",
                  fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                  lineHeight: 1,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: "#00e5ff",
                  textShadow: "0 0 6px rgba(0,229,255,0.5)",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
            ))}
          </div>

          <ViewscreenTooltip label="Colour scale for seafloor depth" side="left">
            <img
              ref={expandedImgRef}
              alt="depth colormap"
              style={{
                width: 14,
                height: rampHeight,
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
