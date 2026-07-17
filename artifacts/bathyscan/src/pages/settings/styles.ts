export const FONT = "'JetBrains Mono', 'Fira Code', monospace";

export const S = {
  page: {
    minHeight: "100dvh",
    background: "var(--bs-s-page-bg, #040810)",
    color: "var(--bs-s-page-fg, #e2e8f0)",
    fontFamily: FONT,
    display: "flex",
    flexDirection: "column",
  } as React.CSSProperties,

  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "10px 20px",
    borderBottom: "1px solid var(--bs-s-border, rgba(0,229,255,0.12))",
    background: "var(--bs-s-topbar-bg, rgba(4,8,16,0.9))",
    backdropFilter: "blur(8px)",
    position: "sticky" as const,
    top: 0,
    zIndex: 10,
    flexShrink: 0,
  } as React.CSSProperties,

  layout: {
    display: "flex",
    flex: 1,
    maxWidth: 960,
    margin: "0 auto",
    width: "100%",
    gap: 0,
  } as React.CSSProperties,

  sidebar: {
    width: 180,
    flexShrink: 0,
    borderRight: "1px solid var(--bs-s-border, rgba(0,229,255,0.1))",
    padding: "20px 0 25vh 0",
  } as React.CSSProperties,

  content: {
    flex: 1,
    padding: "24px 28px",
    overflowY: "auto" as const,
    maxHeight: "calc(100dvh - 41px)",
  } as React.CSSProperties,

  navItem: (active: boolean): React.CSSProperties => ({
    display: "block",
    width: "100%",
    textAlign: "left",
    background: active ? "var(--bs-s-nav-active-bg, rgba(0,229,255,0.08))" : "none",
    border: "none",
    borderLeft: active
      ? "2px solid var(--bs-s-accent, #00e5ff)"
      : "2px solid transparent",
    padding: "8px 16px",
    fontSize: 9,
    letterSpacing: "0.2em",
    color: active
      ? "var(--bs-s-accent, #00e5ff)"
      : "var(--bs-s-sublabel-fg, #94a3b8)",
    cursor: "pointer",
    fontFamily: FONT,
    transition: "color 0.1s, background 0.1s",
  }),

  sectionTitle: {
    fontSize: 9,
    letterSpacing: "0.25em",
    color: "var(--bs-s-accent, #00e5ff)",
    fontWeight: 700,
    textShadow: "var(--bs-s-accent-shadow, 0 0 6px rgba(0,229,255,0.4))",
    marginBottom: 16,
    marginTop: 0,
  } as React.CSSProperties,

  card: {
    background: "var(--bs-s-card-bg, rgba(0,10,20,0.7))",
    border: "1px solid var(--bs-s-card-border, rgba(0,229,255,0.12))",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 16,
  } as React.CSSProperties,

  cardHeader: {
    padding: "10px 16px",
    borderBottom: "1px solid var(--bs-s-card-border, rgba(0,229,255,0.08))",
    fontSize: 8,
    letterSpacing: "0.2em",
    color: "var(--bs-s-card-header-fg, #cbd5e1)",
    fontWeight: 700,
  } as React.CSSProperties,

  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    borderBottom: "1px solid var(--bs-s-row-border, rgba(0,229,255,0.05))",
    fontSize: 11,
    gap: 12,
  } as React.CSSProperties,

  label: {
    color: "var(--bs-s-label-fg, #ffffff)",
    flexShrink: 0,
  } as React.CSSProperties,

  sublabel: {
    fontSize: 9,
    color: "var(--bs-s-sublabel-fg, #94a3b8)",
    marginTop: 2,
    letterSpacing: "0.05em",
  } as React.CSSProperties,

  select: {
    background: "var(--bs-s-select-bg, rgba(0,10,20,0.8))",
    border: "1px solid var(--bs-s-card-border, rgba(0,229,255,0.2))",
    borderRadius: 4,
    color: "var(--bs-s-page-fg, #e2e8f0)",
    fontSize: 10,
    padding: "4px 8px",
    fontFamily: FONT,
    cursor: "pointer",
    outline: "none",
  } as React.CSSProperties,

  slider: {
    accentColor: "var(--bs-s-accent, #00e5ff)",
    cursor: "pointer",
    width: 120,
  } as React.CSSProperties,

  toggle: (on: boolean): React.CSSProperties => ({
    position: "relative",
    display: "inline-block",
    width: 36,
    height: 20,
    background: on
      ? "var(--bs-s-toggle-on-bg, rgba(0,229,255,0.3))"
      : "var(--bs-s-toggle-off-bg, rgba(30,58,95,0.4))",
    border: on
      ? "1px solid var(--bs-s-toggle-on-border, rgba(0,229,255,0.5))"
      : "1px solid var(--bs-s-toggle-off-border, rgba(0,229,255,0.15))",
    borderRadius: 10,
    cursor: "pointer",
    flexShrink: 0,
    transition: "background 0.15s, border-color 0.15s",
  }),

  toggleKnob: (on: boolean): React.CSSProperties => ({
    position: "absolute",
    top: 2,
    left: on ? 17 : 2,
    width: 14,
    height: 14,
    background: on
      ? "var(--bs-s-toggle-knob-on, #00e5ff)"
      : "var(--bs-s-toggle-knob-off, #94a3b8)",
    borderRadius: "50%",
    transition: "left 0.15s, background 0.15s",
    boxShadow: on ? "0 0 6px rgba(0,229,255,0.6)" : "none",
  }),

  dangerCard: {
    background: "var(--bs-s-danger-card-bg, rgba(239,68,68,0.04))",
    border: "1px solid rgba(239,68,68,0.2)",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 16,
  } as React.CSSProperties,

  dangerHeader: {
    padding: "10px 16px",
    borderBottom: "1px solid rgba(239,68,68,0.12)",
    fontSize: 8,
    letterSpacing: "0.2em",
    color: "var(--bs-s-danger-fg, #f87171)",
    fontWeight: 700,
  } as React.CSSProperties,

  dangerBtn: {
    background: "var(--bs-s-danger-btn-bg, rgba(239,68,68,0.08))",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: 4,
    color: "var(--bs-s-danger-fg, #f87171)",
    fontSize: 9,
    letterSpacing: "0.15em",
    padding: "6px 14px",
    cursor: "pointer",
    fontFamily: FONT,
    transition: "background 0.1s",
  } as React.CSSProperties,
};
