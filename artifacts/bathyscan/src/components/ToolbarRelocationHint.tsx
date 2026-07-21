/**
 * ToolbarRelocationHint — one-time dismissible notice shown where the old
 * top-right toolbar (Drive Boat / Tidal 3D Data / Drift) used to live.
 *
 * Points returning users to the toggles' new sidebar homes:
 *   - Tidal 3D  → Explore tab › Overlays & Tools
 *   - Drive Boat → Live tab
 *   - Drift      → Plan tab › Drift & Route
 *
 * Shown only to returning users (hasSeenOnboarding=true) who have not yet
 * dismissed it. Dismissal persists via settingsStore → server sync, so the
 * hint never reappears on any device.
 */
import React from "react";
import { useSettingsStore } from "@/lib/settingsStore";

export const ToolbarRelocationHint: React.FC = () => {
  const hasSeenOnboarding = useSettingsStore((s) => s.hasSeenOnboarding);
  const hasSeenHint = useSettingsStore((s) => s.hasSeenToolbarRelocationHint);
  const setHasSeenHint = useSettingsStore((s) => s.setHasSeenToolbarRelocationHint);

  if (!hasSeenOnboarding || hasSeenHint) return null;

  return (
    <div
      data-testid="toolbar-relocation-hint"
      className="absolute top-3 right-16 z-20"
      style={{
        maxWidth: 340,
        background: "rgba(2,8,18,0.94)",
        border: "1px solid rgba(0,229,255,0.35)",
        borderRadius: 6,
        padding: "10px 12px",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
        letterSpacing: "0.06em",
        color: "#cbd5e1",
        lineHeight: 1.55,
        backdropFilter: "blur(6px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
        pointerEvents: "auto",
      }}
    >
      <div style={{ color: "#00e5ff", fontWeight: 700, letterSpacing: "0.15em", marginBottom: 4, fontSize: "calc(12.5px * var(--bs-font-scale, 1))" }}>
        CONTROLS HAVE MOVED
      </div>
      <div>
        <span style={{ color: "#22d3ee" }}>Drive Boat</span>,{" "}
        <span style={{ color: "#00e5ff" }}>Tidal 3D</span> and{" "}
        <span style={{ color: "#fbbf24" }}>Drift</span> now live in the side
        panel — Live tab, Explore › Overlays &amp; Tools, and Plan › Drift &amp;
        Route.
      </div>
      <button
        data-testid="toolbar-relocation-hint-dismiss"
        onClick={() => setHasSeenHint(true)}
        style={{
          marginTop: 8,
          fontFamily: "inherit",
          fontSize: "calc(12.5px * var(--bs-font-scale, 1))",
          letterSpacing: "0.15em",
          padding: "4px 10px",
          borderRadius: 3,
          border: "1px solid rgba(0,229,255,0.35)",
          background: "rgba(0,229,255,0.08)",
          color: "#00e5ff",
          cursor: "pointer",
        }}
      >
        GOT IT
      </button>
    </div>
  );
};
