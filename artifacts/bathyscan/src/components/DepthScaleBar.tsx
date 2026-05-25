import React, { useEffect, useRef } from "react";
import { useAppState } from "@/lib/context";
import { colormapCanvas } from "@/lib/colormap";

export const DepthScaleBar: React.FC = () => {
  const { terrain } = useAppState();
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!imgRef.current) return;
    const canvas = colormapCanvas(20, 200);
    imgRef.current.src = canvas.toDataURL();
  }, []);

  if (!terrain) return null;

  return (
    <div
      className="absolute right-4 top-1/2 -translate-y-1/2 flex items-stretch gap-2 pointer-events-none z-10"
      style={{ height: 200 }}
    >
      <div className="flex flex-col justify-between items-end py-0 text-[10px] font-mono leading-none"
        style={{ color: "#00e5ff", textShadow: "0 0 6px #00e5ff88" }}>
        <span>{terrain.minDepth}m</span>
        <span>{Math.round((terrain.minDepth + terrain.maxDepth) / 2)}m</span>
        <span>{terrain.maxDepth}m</span>
      </div>
      <div className="flex flex-col justify-between items-center">
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
      </div>
    </div>
  );
};
