/**
 * WebglContextLostOverlay — shown while the WebGL context is lost.
 *
 * Two modes:
 *   - Transient loss: non-blocking banner while the browser attempts recovery.
 *     Hidden automatically once `webglcontextrestored` fires.
 *   - Permanent loss (> 3 failed recovery attempts): blocking prompt asking
 *     the user to reload the page, since further remounts won't help.
 */
import React from "react";
import { useWebglContextStore } from "@/lib/webglContextStore";

export const WebglContextLostOverlay: React.FC = () => {
  const contextLost = useWebglContextStore((s) => s.contextLost);
  const contextPermanentlyLost = useWebglContextStore(
    (s) => s.contextPermanentlyLost,
  );

  if (!contextLost) return null;

  if (contextPermanentlyLost) {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="webgl-fatal-title"
        data-testid="webgl-context-permanent-overlay"
        className="absolute inset-0 z-50 flex items-center justify-center bg-[#020818]/95"
      >
        <div className="bg-[#0f172a] border border-red-700 text-red-300 font-mono text-sm tracking-wide px-8 py-6 shadow-2xl max-w-sm text-center space-y-4">
          <p id="webgl-fatal-title" className="text-base font-bold uppercase tracking-widest text-red-400">
            Graphics context lost
          </p>
          <p className="text-xs text-red-200/80">
            The graphics context could not be restored after multiple attempts.
            Please reload the page to continue.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-5 py-2 bg-red-800 hover:bg-red-700 text-white font-mono text-xs uppercase tracking-widest border border-red-600"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }

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
