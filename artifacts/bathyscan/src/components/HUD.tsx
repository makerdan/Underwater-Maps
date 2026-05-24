import React, { useMemo } from "react";
import { useAppState } from "@/lib/context";

export const HUD = () => {
  const { mode, terrain, speed, cameraPos } = useAppState();

  const [lon, lat, currentDepthStr] = useMemo(() => {
    if (!terrain) return ["0.0000", "0.0000", "N/A"];
    const cx = Math.max(-1, Math.min(1, cameraPos[0]));
    const cz = Math.max(-1, Math.min(1, cameraPos[2]));
    const lonDelta = terrain.maxLon - terrain.minLon;
    const latDelta = terrain.maxLat - terrain.minLat;
    const lon = (terrain.centerLon + cx * (lonDelta / 2)).toFixed(4);
    const lat = (terrain.centerLat - cz * (latDelta / 2)).toFixed(4);
    
    // cameraPos[1] is normalized depth 0 to -0.8
    // Actual depth interpolation
    let actualDepth = terrain.minDepth;
    if (cameraPos[1] <= 0 && cameraPos[1] >= -0.8) {
       actualDepth = terrain.minDepth + (cameraPos[1] / -0.8) * (terrain.maxDepth - terrain.minDepth);
    } else if (cameraPos[1] < -0.8) {
       actualDepth = terrain.maxDepth;
    }

    const currentDepthStr = `▼ ${Math.round(actualDepth).toLocaleString()} m`;
    return [lon, lat, currentDepthStr];
  }, [terrain, cameraPos]);

  return (
    <div className="w-full h-full flex flex-col justify-between p-6 uppercase tracking-wider font-mono text-sm pointer-events-none">
      {/* Top Bar */}
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <div className="font-bold text-primary flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            {terrain ? terrain.name : "NO DATA"}
          </div>
          <div className="text-muted-foreground text-xs">
            LON: <span className="text-foreground">{lon}</span><br/>
            LAT: <span className="text-foreground">{lat}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">SPD</div>
            <div className="font-bold">{speed.toFixed(3)} u/s</div>
          </div>
          <div className={`px-3 py-1 text-xs font-bold rounded-sm border ${mode === 'FLY' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground bg-muted'}`}>
            {mode}
          </div>
        </div>
      </div>

      {/* Center Reticle (only in FLY mode) */}
      {mode === "FLY" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
          <div className="w-8 h-[1px] bg-primary" />
          <div className="w-[1px] h-8 bg-primary absolute" />
          <div className="w-16 h-16 rounded-full border border-primary/50 absolute" />
        </div>
      )}

      {/* Bottom Bar */}
      <div className="flex justify-between items-end">
        <div className="text-2xl font-bold text-primary drop-shadow-md">
          {currentDepthStr}
        </div>
        <div className="text-[10px] text-muted-foreground flex gap-4">
          <span>SPACE: TOGGLE MODE</span>
          <span>WASD/QE: FLY</span>
          <span>SCROLL: SPEED</span>
          <span>HOLD MOUSE: LOOK</span>
        </div>
      </div>
    </div>
  );
};