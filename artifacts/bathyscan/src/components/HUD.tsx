import React, { useMemo } from "react";
import { useAppState } from "@/lib/context";
import { worldXZToLonLat, worldYToMetres } from "@/lib/terrain";

export const HUD = () => {
  const { mode, terrain, speed, cameraPos } = useAppState();

  const [lonStr, latStr, currentDepthStr] = useMemo(() => {
    if (!terrain) return ["0.0000", "0.0000", "N/A"];

    const { lon, lat } = worldXZToLonLat(cameraPos[0], cameraPos[2], terrain);
    const depthM = worldYToMetres(cameraPos[1], terrain);

    return [
      lon.toFixed(4),
      lat.toFixed(4),
      `▼ ${Math.round(depthM).toLocaleString()} M`,
    ];
  }, [terrain, cameraPos]);

  return (
    <div className="w-full h-full flex flex-col justify-between p-6 uppercase tracking-wider font-mono text-sm pointer-events-none">
      {/* ── Top bar ── */}
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <div className="font-bold text-primary flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            {terrain ? terrain.name : "NO DATA"}
          </div>
          <div className="text-muted-foreground text-xs">
            LON: <span className="text-foreground">{lonStr}</span>
            <br />
            LAT: <span className="text-foreground">{latStr}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">SPD</div>
            <div className="font-bold">{speed.toFixed(3)} u/s</div>
          </div>
          <div
            className={`px-3 py-1 text-xs font-bold rounded-sm border ${
              mode === "FLY"
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-muted-foreground bg-muted"
            }`}
          >
            {mode}
          </div>
        </div>
      </div>

      {/* ── Centre reticle (FLY mode only) ── */}
      {mode === "FLY" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
          <div className="w-8 h-[1px] bg-primary" />
          <div className="w-[1px] h-8 bg-primary absolute" />
          <div className="w-16 h-16 rounded-full border border-primary/50 absolute" />
        </div>
      )}

      {/* ── Bottom bar ── */}
      <div className="flex justify-between items-end">
        <div className="text-2xl font-bold text-primary drop-shadow-md">
          {currentDepthStr}
        </div>
        <div className="text-[10px] text-muted-foreground flex gap-4">
          <span>SPACE: TOGGLE MODE</span>
          <span>WASD/OE: FLY</span>
          <span>SCROLL: SPEED</span>
          <span>HOLD MOUSE: LOOK</span>
        </div>
      </div>
    </div>
  );
};
