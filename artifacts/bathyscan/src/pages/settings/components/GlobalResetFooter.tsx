import React, { useState } from "react";
import { useSettingsStore } from "@/lib/settingsStore";
import { FONT } from "../styles";

export function GlobalResetFooter() {
  const [confirm, setConfirm] = useState(false);
  const resetAll = useSettingsStore((s) => s.resetAll);

  return (
    <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid rgba(239,68,68,0.15)" }}>
      <div style={{ fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#cbd5e1", letterSpacing: "0.15em", marginBottom: 8 }}>
        GLOBAL RESET
      </div>
      <div style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#94a3b8", marginBottom: 12 }}>
        Restore every setting on this page to its default value. Your saved
        dataset home positions and marker data are not affected.
      </div>
      {!confirm ? (
        <button
          onClick={() => setConfirm(true)}
          data-testid="reset-all-btn"
          style={{
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 4,
            color: "#f87171",
            fontSize: "calc(9px * var(--bs-font-scale, 1))",
            letterSpacing: "0.15em",
            padding: "6px 14px",
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          RESET ALL SETTINGS
        </button>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#f87171" }}>Reset every setting?</span>
          <button
            onClick={() => { resetAll(); setConfirm(false); }}
            data-testid="confirm-reset-all-btn"
            style={{
              background: "rgba(239,68,68,0.15)",
              border: "1px solid rgba(239,68,68,0.4)",
              borderRadius: 4,
              color: "#f87171",
              fontSize: "calc(9px * var(--bs-font-scale, 1))",
              letterSpacing: "0.15em",
              padding: "6px 14px",
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            YES, RESET EVERYTHING
          </button>
          <button
            onClick={() => setConfirm(false)}
            style={{
              background: "none",
              border: "1px solid rgba(100,116,139,0.3)",
              borderRadius: 4,
              color: "#cbd5e1",
              fontSize: "calc(9px * var(--bs-font-scale, 1))",
              letterSpacing: "0.15em",
              padding: "6px 14px",
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            CANCEL
          </button>
        </div>
      )}
    </div>
  );
}
