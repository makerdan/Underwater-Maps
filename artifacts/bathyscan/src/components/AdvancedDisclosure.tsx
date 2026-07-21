/**
 * AdvancedDisclosure — reusable collapsible "Advanced Settings" disclosure.
 *
 * Reads the global `showAdvancedEverywhere` flag for its default open state.
 * Users may still manually expand/collapse per instance after first render.
 */
import React, { useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/settingsStore";

interface Props {
  label?: string;
  children: React.ReactNode;
  testId?: string;
}

export const AdvancedDisclosure: React.FC<Props> = ({
  label = "Advanced Settings",
  children,
  testId,
}) => {
  const globalOpen = useSettingsStore((s) => s.showAdvancedEverywhere);
  const [open, setOpen] = useState(globalOpen);

  // When the global flag toggles, follow it (but allow per-instance override
  // for subsequent local toggles).
  useEffect(() => {
    setOpen(globalOpen);
  }, [globalOpen]);

  return (
    <div
      style={{
        marginTop: 4,
        marginBottom: 16,
        border: "1px dashed rgba(0,229,255,0.18)",
        borderRadius: 6,
        background: "rgba(0,229,255,0.02)",
      }}
      data-testid={testId}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          color: "#cbd5e1",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
          letterSpacing: "0.2em",
          padding: "8px 14px",
          cursor: "pointer",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            display: "inline-block",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
            color: "#00e5ff",
            fontSize: "calc(30px * var(--bs-font-scale, 1))",
            lineHeight: 1,
          }}
        >
          ▶
        </span>
        <span>{label.toUpperCase()}</span>
      </button>
      {open && <div style={{ padding: "0 2px 4px" }}>{children}</div>}
    </div>
  );
};
