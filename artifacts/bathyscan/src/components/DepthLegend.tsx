import React from "react";
import { useAppState } from "@/lib/context";
import { useSettingsStore } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import { colormapCssGradient, getColormapTRange } from "@/lib/colormap";
import { formatDepth } from "@/lib/units";

const FT_TO_M = 0.3048;

export const DepthLegend = () => {
  const { terrain } = useAppState();
  const units = useSettingsStore((s) => s.units);
  const colormapTheme = useSettingsStore((s) => s.colormapTheme);
  const bandBoundaries = usePaletteStore((s) => s.bandBoundaries);
  // Subscribe to palette edits so the ramp repaints live.
  usePaletteStore((s) => s.bandColors.join(","));
  usePaletteStore((s) => s.deep);

  if (!terrain) return null;

  const rampHeightPx = 256; // h-64 = 16rem = 256px

  const activeBoundaries = Array.isArray(bandBoundaries) && bandBoundaries.length === 11
    ? bandBoundaries
    : [];

  // Build tick list from band boundaries, filtered to the dataset's depth range.
  // Guard against a flat dataset (all points at the same depth).
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
    <div className="absolute right-6 top-1/2 -translate-y-1/2 flex items-stretch h-64 z-10 pointer-events-none">
      {/* Tick labels column */}
      <div
        data-testid="depth-legend-ticks"
        className="relative mr-3"
        style={{ width: 56, height: rampHeightPx }}
      >
        {ticks.map(({ label, pos }) => (
          <span
            key={label}
            className="absolute right-0 text-[18px] font-mono text-muted-foreground whitespace-nowrap"
            style={{
              top: pos * rampHeightPx,
              transform: "translateY(-50%)",
            }}
          >
            {label}
          </span>
        ))}
      </div>

      <div
        className="w-4 rounded-sm border border-border"
        style={{
          // Sample the active colormap over the dataset's slice of the
          // absolute depth scale so the ramp matches the terrain colours
          // and the grid-relative tick positions line up with the bands.
          background: colormapCssGradient(
            colormapTheme,
            "to bottom",
            24,
            getColormapTRange(colormapTheme, terrain.minDepth, terrain.maxDepth),
          ),
        }}
      />
    </div>
  );
};
