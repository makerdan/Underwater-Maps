/**
 * WebglContextLostOverlay — small non-blocking banner shown while the WebGL
 * context is lost. Visible during recovery; hidden automatically once the
 * `webglcontextrestored` event fires and re-uploads GPU resources.
 */
import React from "react";
import { useWebglContextStore } from "@/lib/webglContextStore";

export const WebglContextLostOverlay: React.FC = () => {
  const contextLost = useWebglContextStore((s) => s.contextLost);
  if (!contextLost) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="webgl-context-lost-overlay"
      className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
    >
      <div className="pointer-events-auto bg-[#020818]/90 border border-amber-700 text-amber-300 font-mono text-xs tracking-widest uppercase px-4 py-2 shadow-lg">
        ⚠ Graphics context lost — restoring…
      </div>
    </div>
  );
};
