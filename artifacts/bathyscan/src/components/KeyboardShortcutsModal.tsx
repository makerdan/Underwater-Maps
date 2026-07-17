import React, { useEffect } from "react";
import { useSettingsStore } from "@/lib/settingsStore";
import { getKeyboardShortcuts } from "@/lib/keyboardShortcuts";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

export const KeyboardShortcutsModal: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const crosshairMenuKey = useSettingsStore((s) => s.keyBindings.crosshairMenu);
  const crosshairMenuGamepadButton = useSettingsStore((s) => s.crosshairMenuGamepadButton);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  if (!open) return null;

  const bindings = getKeyboardShortcuts(crosshairMenuKey, crosshairMenuGamepadButton);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      data-testid="keyboard-shortcuts-modal"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(2,8,18,0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: FONT,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "rgba(2,8,18,0.98)",
          border: "1px solid rgba(0,229,255,0.35)",
          borderRadius: 8,
          color: "#cbd5e1",
          maxWidth: 520,
          width: "100%",
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 24px rgba(0,229,255,0.15)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 16px",
            borderBottom: "1px solid rgba(0,229,255,0.18)",
          }}
        >
          <span
            style={{
              fontSize: 16.5,
              letterSpacing: "0.2em",
              color: "#00e5ff",
              fontWeight: 700,
              textShadow: "0 0 6px rgba(0,229,255,0.5)",
            }}
          >
            KEYBOARD SHORTCUTS
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            style={{
              background: "transparent",
              border: "1px solid rgba(0,229,255,0.25)",
              borderRadius: 3,
              color: "#cbd5e1",
              fontSize: 18,
              padding: "2px 8px",
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            ESC
          </button>
        </div>
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          {bindings.map(({ key, action }) => (
            <div key={key} style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span
                style={{
                  flexShrink: 0,
                  minWidth: 140,
                  background: "rgba(0,229,255,0.10)",
                  border: "1px solid rgba(0,229,255,0.30)",
                  borderRadius: 3,
                  padding: "3px 8px",
                  color: "#00e5ff",
                  fontSize: 16.5,
                  textAlign: "center",
                  letterSpacing: "0.08em",
                  fontWeight: 600,
                }}
              >
                {key}
              </span>
              <span style={{ fontSize: 18, color: "#cbd5e1" }}>{action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
