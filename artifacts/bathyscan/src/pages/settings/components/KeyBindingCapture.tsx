import React, { useEffect, useState } from "react";
import { useSettingsStore, DEFAULT_CROSSHAIR_MENU_GAMEPAD_BUTTON } from "@/lib/settingsStore";
import {
  SHORTCUT_ACTIONS,
  MOVEMENT_ARROW_SYMBOLS,
  type ShortcutActionId,
} from "@/lib/keyBindings";
import { formatKeyCode, formatGamepadButton } from "@/lib/keyLabel";
import { FONT, S } from "../styles";

export function KeyBindingCapture({
  action,
  conflictWith,
}: {
  action: ShortcutActionId;
  conflictWith: string[];
}) {
  const def = SHORTCUT_ACTIONS.find((a) => a.id === action);
  // `""` is canonically "unset" — fall back to the default (|| not ??) so
  // display agrees with conflict detection and allDefault.
  const code = useSettingsStore((s) => s.keyBindings[action] || def?.defaultCode || "");
  const setKeyBinding = useSettingsStore((s) => s.setKeyBinding);
  const resetKeyBinding = useSettingsStore((s) => s.resetKeyBinding);
  const [capturing, setCapturing] = useState(false);
  const isDefault = code === def?.defaultCode;
  const conflict = conflictWith.length > 0;
  const arrowSymbol = MOVEMENT_ARROW_SYMBOLS[action];

  useEffect(() => {
    if (!def) {
      console.warn(`[KeyBindingCapture] Unknown shortcut action id: ${action}`);
    }
  }, [def, action]);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setCapturing(false);
        return;
      }
      // Modifier keys (Shift/Ctrl/Alt/Meta) are valid bindings — `descend`
      // even defaults to ShiftLeft — so they are captured like any other key.
      setKeyBinding(action, e.code);
      setCapturing(false);
    };
    // If the window loses focus mid-capture, cancel: otherwise the next key
    // pressed after returning would be silently consumed and bound.
    const onBlur = () => setCapturing(false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [capturing, action, setKeyBinding]);

  if (!def) {
    // Malformed or stale action id (e.g. persisted state from a newer build).
    // Render a safe fallback row instead of crashing the settings page.
    return (
      <div style={S.row} data-testid={`shortcut-unknown-${action}`}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={S.label}>Unknown action</div>
          <div style={S.sublabel}>
            “{action}” is not a recognised shortcut action.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.row}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={S.label}>{def.label}</div>
        <div style={S.sublabel}>{def.description}</div>
        {conflict && (
          <div
            data-testid={`shortcut-conflict-${action.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`}
            style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#fb923c", marginTop: 4, letterSpacing: "0.04em" }}
          >
            ⚠ Also bound to: {conflictWith.join(", ")}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {arrowSymbol && (
          <span
            data-testid={`shortcut-${action.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}-arrow-alias`}
            title={`Arrow key alias: ${arrowSymbol}`}
            style={{
              fontSize: "calc(11px * var(--bs-font-scale, 1))",
              color: "#64748b",
              letterSpacing: "0.04em",
              userSelect: "none",
            }}
          >
            also: {arrowSymbol}
          </span>
        )}
        <button
          type="button"
          data-testid={`shortcut-${action.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}-key`}
          onClick={() => setCapturing((v) => !v)}
          style={{
            background: capturing
              ? "rgba(251,146,60,0.12)"
              : conflict
                ? "rgba(251,146,60,0.06)"
                : "rgba(0,229,255,0.08)",
            border: `1px solid ${
              capturing
                ? "rgba(251,146,60,0.5)"
                : conflict
                  ? "rgba(251,146,60,0.45)"
                  : "rgba(0,229,255,0.25)"
            }`,
            borderRadius: 3,
            color: capturing ? "#fb923c" : conflict ? "#fb923c" : "#67e8f9",
            fontFamily: FONT,
            fontSize: "calc(10px * var(--bs-font-scale, 1))",
            padding: "4px 12px",
            minWidth: 110,
            cursor: "pointer",
            letterSpacing: "0.1em",
          }}
        >
          {capturing ? "PRESS A KEY (ESC CANCELS)" : formatKeyCode(code).toUpperCase()}
        </button>
        <button
          type="button"
          data-testid={`shortcut-${action.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}-reset`}
          onClick={() => {
            // Cancel any active capture first so the keydown listener is
            // removed before the reset value lands — otherwise the next key
            // pressed would overwrite the just-reset binding.
            setCapturing(false);
            resetKeyBinding(action);
          }}
          disabled={isDefault}
          style={{
            background: "none",
            border: "1px solid rgba(0,229,255,0.15)",
            borderRadius: 3,
            color: isDefault ? "#64748b" : "#cbd5e1",
            fontSize: "calc(9px * var(--bs-font-scale, 1))",
            letterSpacing: "0.15em",
            padding: "3px 8px",
            cursor: isDefault ? "default" : "pointer",
            fontFamily: FONT,
            opacity: isDefault ? 0.5 : 1,
          }}
        >
          RESET
        </button>
      </div>
    </div>
  );
}

export function CrosshairMenuGamepadCapture() {
  const value = useSettingsStore((s) => s.crosshairMenuGamepadButton);
  const setValue = useSettingsStore((s) => s.setCrosshairMenuGamepadButton);
  const [capturing, setCapturing] = useState(false);
  const [gamepadError, setGamepadError] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
      // No Gamepad API: bail out of capture immediately instead of leaving
      // the button stuck on "PRESS A BUTTON…" forever.
      setCapturing(false);
      setGamepadError("Gamepad not supported in this browser");
      return;
    }
    // The stored button index is only meaningful under the Standard Gamepad
    // mapping; require at least one connected standard-mapping controller
    // before entering capture mode.
    const connected = Array.from(navigator.getGamepads() ?? []).filter(
      (p): p is Gamepad => p != null,
    );
    if (!connected.some((p) => p.mapping === "standard")) {
      setCapturing(false);
      setGamepadError("Connect a standard gamepad controller");
      return;
    }
    let raf = 0;
    let snapshot: (boolean[] | null)[] | null = null;
    const poll = () => {
      const pads = navigator.getGamepads();
      // Non-standard pads map to null so their presses are never accepted.
      const current = pads.map((p) =>
        p && p.mapping === "standard" ? p.buttons.map((b) => !!b.pressed) : null,
      );
      if (!snapshot) {
        snapshot = current;
      } else {
        for (let p = 0; p < current.length; p++) {
          const cur = current[p];
          if (!cur) continue;
          const prev = snapshot[p] ?? [];
          for (let b = 0; b < cur.length; b++) {
            if (cur[b] && !prev[b]) {
              setValue(b);
              setCapturing(false);
              return;
            }
          }
        }
        snapshot = current;
      }
      raf = window.requestAnimationFrame(poll);
    };
    raf = window.requestAnimationFrame(poll);
    return () => window.cancelAnimationFrame(raf);
  }, [capturing, setValue]);

  return (
    <div style={S.row}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={S.label}>Gamepad button</div>
        <div style={S.sublabel}>
          Controller button that opens the same crosshair action menu. Uses
          the Standard Gamepad mapping; defaults to Y / Triangle.
        </div>
        {gamepadError && (
          <div
            data-testid="gamepad-capture-error"
            style={{
              fontSize: "calc(10px * var(--bs-font-scale, 1))",
              color: "#fb923c",
              marginTop: 4,
              letterSpacing: "0.04em",
            }}
          >
            ⚠ {gamepadError}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          data-testid="shortcut-crosshair-menu-gamepad"
          onClick={() => {
            setGamepadError(null);
            setCapturing((v) => !v);
          }}
          style={{
            background: capturing ? "rgba(251,146,60,0.12)" : "rgba(0,229,255,0.08)",
            border: `1px solid ${capturing ? "rgba(251,146,60,0.5)" : "rgba(0,229,255,0.25)"}`,
            borderRadius: 3,
            color: capturing ? "#fb923c" : "#67e8f9",
            fontFamily: FONT,
            fontSize: "calc(10px * var(--bs-font-scale, 1))",
            padding: "4px 12px",
            minWidth: 140,
            cursor: "pointer",
            letterSpacing: "0.08em",
          }}
        >
          {capturing ? "PRESS A BUTTON…" : formatGamepadButton(value).toUpperCase()}
        </button>
        <button
          type="button"
          onClick={() => {
            // Cancel active capture BEFORE writing, otherwise the polling
            // loop stays alive and the next button press re-applies a
            // binding over the just-cleared value.
            setCapturing(false);
            setGamepadError(null);
            setValue(null);
          }}
          style={{
            background: "none",
            border: "1px solid rgba(0,229,255,0.15)",
            borderRadius: 3,
            color: "#cbd5e1",
            fontSize: "calc(9px * var(--bs-font-scale, 1))",
            letterSpacing: "0.15em",
            padding: "3px 8px",
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          DISABLE
        </button>
        <button
          type="button"
          onClick={() => {
            // Same as DISABLE: cancel capture before writing the reset value.
            setCapturing(false);
            setGamepadError(null);
            setValue(DEFAULT_CROSSHAIR_MENU_GAMEPAD_BUTTON);
          }}
          style={{
            background: "none",
            border: "1px solid rgba(0,229,255,0.15)",
            borderRadius: 3,
            color: "#cbd5e1",
            fontSize: "calc(9px * var(--bs-font-scale, 1))",
            letterSpacing: "0.15em",
            padding: "3px 8px",
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          RESET
        </button>
      </div>
    </div>
  );
}
