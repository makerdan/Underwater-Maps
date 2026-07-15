/**
 * SidebarSection — shared collapsible shell for the regrouped left sidebar.
 *
 * Provides one uniform chrome (border, header typography, chevron position,
 * internal padding) for the long blocks that group several child panels.
 * Persists its open/closed state via `panelCollapseStore` so the layout
 * survives reloads. Subsection separators between children are subtle
 * dividers — children should render without their own outer card borders
 * or themed collapsible headers (use their `embedded` prop).
 *
 * Multiple sections can also be visually merged into one continuous panel
 * by wrapping them in `<SidebarSectionGroup>`. In that mode each section
 * drops its own outer border/background/radius so the group provides one
 * shared shell, and the seam between sibling sections uses the same subtle
 * divider style used between subsections inside a single section.
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

// Divider used between sibling sections inside a group — matches the
// subtle dashed treatment used between subsections inside a single section.
const SEAM_BORDER = "1px dashed rgba(0,229,255,0.10)";

interface GroupContextValue {
  /** True when this section is rendered inside a SidebarSectionGroup. */
  grouped: boolean;
  /** True when this section is not the first child in the group. */
  hasSeamAbove: boolean;
}

const GroupContext = React.createContext<GroupContextValue>({
  grouped: false,
  hasSeamAbove: false,
});

interface SidebarSectionProps {
  id: Extract<PanelId, "mapData" | "conditions" | "forecast" | "seafloorClassification" | "habitat">;
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
  const { grouped, hasSeamAbove } = React.useContext(GroupContext);

  // Wrap top-level children with a divider between them. Empty children
  // (e.g. a conditional panel that returned null) are dropped so we don't
  // render an empty divider row.
  const items = React.Children.toArray(children).filter(Boolean);

  // When grouped, the outer SHELL chrome is provided by the group, so this
  // section becomes a borderless segment. Only the seam between siblings
  // (a single subtle dashed line) separates them.
  const shellStyle: React.CSSProperties = grouped
    ? {
        fontFamily: SHELL.fontFamily,
        color: SHELL.color,
        fontSize: SHELL.fontSize,
        pointerEvents: "auto",
        borderTop: hasSeamAbove ? SEAM_BORDER : "none",
      }
    : SHELL;

  return (
    <div
      data-testid={testId ?? `sidebar-section-${id}`}
      className="sidebar-section"
      style={shellStyle}
    >
      <ViewscreenTooltip
        label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        side="right"
      >
        <button
          type="button"
          onClick={() => toggle(id)}
          aria-expanded={!collapsed}
          aria-controls={`sidebar-section-body-${id}`}
          className="sidebar-section-header w-full flex items-center justify-between"
          style={{
            background: "none",
            border: "none",
            borderBottom: collapsed ? "none" : "1px solid rgba(0,229,255,0.12)",
            borderRadius: 0,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span className="sidebar-section-title" style={HEADER_TITLE}>
            {title}
          </span>
          <span
            className="sidebar-section-chevron"
            style={{ color: "#cbd5e1", fontSize: 22, lineHeight: 1 }}
          >
            {collapsed ? "▸" : "▾"}
          </span>
        </button>
      </ViewscreenTooltip>

      {!collapsed && (
        <div
          id={`sidebar-section-body-${id}`}
          className="sidebar-section-body"
        >
          {items.map((child, i) => (
            <div
              key={i}
              className="sidebar-section-item"
              style={{
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

interface SidebarSectionGroupProps {
  children: React.ReactNode;
  testId?: string;
}

/**
 * SidebarSectionGroup — wraps multiple `SidebarSection`s so they render
 * inside a single shared bordered shell instead of as separate stacked
 * cards. Each section keeps its own collapsible header and independent
 * toggle state; only the outer chrome is unified.
 */
export const SidebarSectionGroup: React.FC<SidebarSectionGroupProps> = ({
  children,
  testId,
}) => {
  const items = React.Children.toArray(children).filter(Boolean);
  const groupStyle: React.CSSProperties = {
    ...SHELL,
    // Hide any sub-pixel bleed from inner segments past the rounded corners.
    overflow: "hidden",
  };
  return (
    <div data-testid={testId ?? "sidebar-section-group"} style={groupStyle}>
      {items.map((child, i) => (
        <GroupContext.Provider
          key={i}
          value={{ grouped: true, hasSeamAbove: i > 0 }}
        >
          {child}
        </GroupContext.Provider>
      ))}
    </div>
  );
};
