/**
 * SidebarSection — shared collapsible shell for the regrouped left sidebar.
 *
 * Provides one uniform chrome (border, header typography, chevron position,
 * internal padding) for the long blocks that group several child panels.
 * Persists its open/closed state via `panelCollapseStore` so the layout
 * survives reloads. Subsection separators between children are subtle
 * dividers — children should render without their own outer card borders
 * or themed collapsible headers (use their `embedded` prop).
 */
import React from "react";
import { usePanelCollapseStore, type PanelId } from "@/lib/panelCollapseStore";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";

const SHELL: React.CSSProperties = {
  background: "rgba(2,8,18,0.94)",
  border: "1px solid rgba(0,229,255,0.22)",
  borderRadius: 6,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  color: "#cbd5e1",
  fontSize: 12,
  minWidth: 230,
  maxWidth: 260,
  backdropFilter: "blur(6px)",
  pointerEvents: "auto",
};

const HEADER_TITLE: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: "#00e5ff",
  textShadow: "0 0 6px rgba(0,229,255,0.5)",
  fontWeight: 700,
};

interface SidebarSectionProps {
  id: Extract<PanelId, "mapData" | "conditions">;
  title: string;
  children: React.ReactNode;
  testId?: string;
}

export const SidebarSection: React.FC<SidebarSectionProps> = ({
  id,
  title,
  children,
  testId,
}) => {
  const collapsed = usePanelCollapseStore((s) => s.collapsed[id]);
  const toggle = usePanelCollapseStore((s) => s.toggle);

  // Wrap top-level children with a divider between them. Empty children
  // (e.g. a conditional panel that returned null) are dropped so we don't
  // render an empty divider row.
  const items = React.Children.toArray(children).filter(Boolean);

  return (
    <div data-testid={testId ?? `sidebar-section-${id}`} style={SHELL}>
      <ViewscreenTooltip
        label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        side="right"
      >
        <button
          type="button"
          onClick={() => toggle(id)}
          aria-expanded={!collapsed}
          aria-controls={`sidebar-section-body-${id}`}
          className="w-full flex items-center justify-between"
          style={{
            padding: "8px 12px",
            background: "none",
            border: "none",
            borderBottom: collapsed ? "none" : "1px solid rgba(0,229,255,0.12)",
            borderRadius: 0,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={HEADER_TITLE}>{title}</span>
          <span style={{ color: "#cbd5e1", fontSize: 22, lineHeight: 1 }}>
            {collapsed ? "▸" : "▾"}
          </span>
        </button>
      </ViewscreenTooltip>

      {!collapsed && (
        <div
          id={`sidebar-section-body-${id}`}
          style={{ padding: "4px 0" }}
        >
          {items.map((child, i) => (
            <div
              key={i}
              style={{
                padding: "8px 12px",
                borderTop:
                  i === 0 ? "none" : "1px dashed rgba(0,229,255,0.10)",
              }}
            >
              {child}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
