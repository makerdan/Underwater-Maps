import React from "react";
import { useAppState, SPEEDS } from "@/lib/context";
import { useCameraStore } from "@/lib/cameraStore";

export const HUD = () => {
  const { mode, terrain, speedIndex } = useAppState();
  const crosshairGps = useCameraStore((s) => s.crosshairGps);
  const lastClickedGps = useCameraStore((s) => s.lastClickedGps);

  const speed = SPEEDS[speedIndex] ?? 0.15;

  const lonStr = crosshairGps ? crosshairGps.lon.toFixed(4) : "—";
  const latStr = crosshairGps ? crosshairGps.lat.toFixed(4) : "—";
  const depthStr = crosshairGps
    ? `▼ ${Math.round(crosshairGps.depth).toLocaleString()} M`
    : "▼ — M";

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
          {lastClickedGps && (
            <div className="text-[10px] text-cyan-600 mt-1">
              PIN {lastClickedGps.lon.toFixed(4)}, {lastClickedGps.lat.toFixed(4)}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">SPD</div>
            <div className="font-bold">{speed.toFixed(2)} u/s</div>
          </div>
          <div
            className={`px-3 py-1 text-xs font-bold rounded-sm border ${
              mode === "fly"
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-muted-foreground bg-muted"
            }`}
          >
            {mode === "fly" ? "FLY" : "ORBIT"}
          </div>
        </div>
      </div>

      {/* ── Centre reticle (fly mode only) ── */}
      {mode === "fly" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
          <div className="w-8 h-[1px] bg-primary" />
          <div className="w-[1px] h-8 bg-primary absolute" />
          <div className="w-16 h-16 rounded-full border border-primary/50 absolute" />
        </div>
      )}

      {/* ── Bottom bar ── */}
      <div className="flex justify-between items-end">
        <div className="text-2xl font-bold text-primary drop-shadow-md">
          {depthStr}
        </div>
        <div className="text-[10px] text-muted-foreground flex flex-col items-end gap-1">
          <span>CLICK: POINTER LOCK &nbsp; ESC: RELEASE</span>
          <span>WASD: FLY &nbsp; SPACE/SHIFT: UP/DOWN &nbsp; SCROLL: SPEED</span>
          <span>TAB: ORBIT MODE &nbsp; G / RIGHT-CLICK: PIN GPS</span>
        </div>
      </div>
    </div>
  );
};
