import React, { useEffect, useRef } from "react";
import { useAppState } from "@/lib/context";
import { colormapCanvas } from "@/lib/colormap";
import { useSettingsStore } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import { formatDepth } from "@/lib/units";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";

export const DepthScaleBar: React.FC = () => {
  const { terrain } = useAppState();
  const imgRef = useRef<HTMLImageElement>(null);
  const colormapTheme = useSettingsStore((s) => s.colormapTheme);
  const units = useSettingsStore((s) => s.units);
  const shallow = usePaletteStore((s) => s.shallow);
  const deep = usePaletteStore((s) => s.deep);

  useEffect(() => {
    if (!imgRef.current) return;
    const canvas = colormapCanvas(20, 200, colormapTheme);
    imgRef.current.src = canvas.toDataURL();
  }, [colormapTheme, shallow, deep]);

  if (!terrain) return null;

  return (
    <div
      className="absolute right-4 top-1/2 -translate-y-1/2 flex items-stretch gap-2 pointer-events-none z-10"
      style={{ height: 200 }}
    >
      <div className="flex flex-col justify-between items-end py-0 text-[10px] font-mono leading-none"
        style={{ color: "#00e5ff", textShadow: "0 0 6px #00e5ff88" }}>
        <span>{formatDepth(terrain.minDepth, { units })}</span>
        <span>{formatDepth((terrain.minDepth + terrain.maxDepth) / 2, { units })}</span>
        <span>{formatDepth(terrain.maxDepth, { units })}</span>
      </div>
      <div className="flex flex-col justify-between items-center" style={{ pointerEvents: "auto" }}>
        <ViewscreenTooltip label="Colour scale for seafloor depth" side="left">
          <img
            ref={imgRef}
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
    </div>
  );
};
