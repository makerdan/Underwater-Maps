import React from "react";
import { useAppState } from "@/lib/context";

export const DepthLegend = () => {
  const { terrain } = useAppState();
  if (!terrain) return null;

  const markers = [0, 0.25, 0.5, 0.75, 1].map(pct => {
    const val = terrain.minDepth + pct * (terrain.maxDepth - terrain.minDepth);
    return Math.round(val);
  });

  return (
    <div className="absolute right-6 top-1/2 -translate-y-1/2 flex items-stretch h-64 z-10 pointer-events-none">
      <div className="flex flex-col justify-between items-end mr-3 text-xs font-mono text-muted-foreground h-full py-1">
        {markers.map((val, i) => (
          <span key={i}>{val}m</span>
        ))}
      </div>
      <div 
        className="w-4 rounded-sm border border-border"
        style={{
          background: "linear-gradient(to bottom, #2D6A9F 0%, #4B1E80 50%, #050a14 100%)"
        }}
      />
    </div>
  );
};