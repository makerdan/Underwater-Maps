/**
 * AdvancedSection — reusable collapsible "Advanced" sub-section for sidebar panels.
 *
 * Renders a slim "Advanced ▸ / Advanced ▾" toggle row and an animated
 * collapse container.  Open/closed state is persisted per-panel via
 * `panelCollapseStore` so it survives page reload.
 *
 * Animation: max-height + opacity CSS transition (no external library).
 * Children are always mounted so their state is preserved; the container
 * is clipped and faded when collapsed.
 *
 * Usage:
 *   <AdvancedSection panelId="overlaysToolsAdvanced">
 *     ... rarely-needed controls ...
 *   </AdvancedSection>
 */
import React from "react";
import { usePanelCollapseStore, type PanelId } from "@/lib/panelCollapseStore";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

interface AdvancedSectionProps {
  panelId: PanelId;
  children: React.ReactNode;
}

export const AdvancedSection: React.FC<AdvancedSectionProps> = ({
  panelId,
  children,
}) => {
  const collapsed = usePanelCollapseStore((s) => s.collapsed[panelId]);
  const toggle = usePanelCollapseStore((s) => s.toggle);

  return (
    <div
      style={{
        borderTop: "1px solid rgba(0,229,255,0.08)",
        marginTop: 6,
      }}
    >
      <button
        type="button"
        data-testid={`advanced-toggle-${panelId}`}
        onClick={() => toggle(panelId)}
        aria-expanded={!collapsed}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 5,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "5px 0",
          fontFamily: FONT,
          fontSize: 9,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: collapsed ? "#64748b" : "#94a3b8",
          transition: "color 0.15s",
        }}
      >
        <span
          style={{
            fontSize: 10,
            display: "inline-block",
            transition: "transform 0.2s ease",
            transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
          }}
        >
          ▸
        </span>
        <span>Advanced</span>
      </button>

      {/* Always-mounted children clipped via max-height for smooth animation */}
      <div
        style={{
          maxHeight: collapsed ? 0 : 1200,
          overflow: "hidden",
          opacity: collapsed ? 0 : 1,
          transition: collapsed
            ? "max-height 0.2s ease, opacity 0.15s ease"
            : "max-height 0.25s ease, opacity 0.2s ease 0.05s",
        }}
      >
        <div style={{ paddingTop: 2 }}>
          {children}
        </div>
      </div>
    </div>
  );
};
