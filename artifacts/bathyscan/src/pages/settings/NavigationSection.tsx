import React from "react";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "@/lib/settingsStore";
import { AdvancedDisclosure } from "@/components/AdvancedDisclosure";
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_GROUPS,
  DEFAULT_KEY_BINDINGS,
  findBindingConflicts,
  type ShortcutActionId,
} from "@/lib/keyBindings";
import { S } from "./styles";
import { SectionTitle } from "./components/SectionTitle";
import { SectionActionsRow } from "./components/SyncContext";
import { SliderRow, ToggleRow, SelectRow } from "./components/RowWidgets";
import { KeyBindingCapture, CrosshairMenuGamepadCapture } from "./components/KeyBindingCapture";
import { FIXED_SHORTCUTS } from "./constants";
import { FONT } from "./styles";

export function NavigationSection() {
  const s = useSettingsStore(useShallow((s) => s));
  const keyBindings = useSettingsStore((s) => s.keyBindings);
  const resetAllKeyBindings = useSettingsStore((s) => s.resetAllKeyBindings);

  const conflictByAction = React.useMemo(() => {
    const byCode = findBindingConflicts(keyBindings);
    const out = new Map<ShortcutActionId, string[]>();
    for (const action of SHORTCUT_ACTIONS) {
      const code = keyBindings[action.id] ?? action.defaultCode;
      const sharing = (byCode.get(code) ?? []).filter((id) => id !== action.id);
      out.set(
        action.id,
        sharing.map((id) => SHORTCUT_ACTIONS.find((a) => a.id === id)?.label ?? id),
      );
    }
    return out;
  }, [keyBindings]);

  const allDefault = React.useMemo(
    () =>
      SHORTCUT_ACTIONS.every(
        (a) => (keyBindings[a.id] ?? a.defaultCode) === DEFAULT_KEY_BINDINGS[a.id],
      ),
    [keyBindings],
  );

  return (
    <>
      <SectionTitle helpId="keyboard-shortcuts" helpLabel="Navigation">◈ NAVIGATION</SectionTitle>
      <SectionActionsRow sections={["camera", "shortcuts"]} />
      <div style={S.card}>
        <div style={S.cardHeader}>BASICS</div>
        <div style={S.row}>
          <div>
            <div style={S.label}>Default Speed Tier</div>
            <div style={S.sublabel}>0 = slowest, 4 = fastest</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="range" min={0} max={4} step={1} value={s.defaultSpeedTier}
              onChange={(e) => s.setDefaultSpeedTier(Number(e.target.value))}
              style={S.slider}
            />
            <span style={{ color: "#00e5ff", fontSize: "calc(10px * var(--bs-font-scale, 1))", minWidth: 24, textAlign: "center" }}>
              {s.defaultSpeedTier}
            </span>
          </div>
        </div>
        <SliderRow
          label="Mouse Sensitivity"
          value={s.mouseSensitivity}
          min={0.1} max={3.0} step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={s.setMouseSensitivity}
          sublabel="Multiplier applied to look rotation"
        />
        <ToggleRow
          label="Invert Mouse Y"
          value={s.invertMouseY}
          onChange={s.setInvertMouseY}
          sublabel="Flip vertical look direction"
        />
        <SliderRow
          label="Mouse Wheel Zoom Sensitivity"
          value={s.mouseZoomSensitivity}
          min={0.1} max={3.0} step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={s.setMouseZoomSensitivity}
          sublabel="How fast the wheel zooms (mouse notches)"
        />
        <SliderRow
          label="Touchpad Zoom Sensitivity"
          value={s.touchpadZoomSensitivity}
          min={0.1} max={3.0} step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={s.setTouchpadZoomSensitivity}
          sublabel="How fast two-finger scroll zooms the camera"
        />
        <SliderRow
          label="Mobile Pinch Zoom Sensitivity"
          value={s.pinchZoomSensitivity}
          min={0.1} max={3.0} step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={s.setPinchZoomSensitivity}
          sublabel="How fast pinch gestures zoom on touch devices"
        />
      </div>
      <AdvancedDisclosure testId="camera-advanced">
        <div style={S.card}>
          <div style={S.cardHeader}>CAMERA ADVANCED</div>
          <SliderRow
            label="Field of View"
            value={s.fieldOfView}
            min={30} max={90} step={1}
            format={(v) => `${v}°`}
            onChange={s.setFieldOfView}
            sublabel="Perspective FOV in degrees"
          />
          <SliderRow
            label="Render Distance"
            value={s.renderDistance}
            min={100} max={2000} step={50}
            format={(v) => `${v} m`}
            onChange={s.setRenderDistance}
            sublabel="Camera far clip plane"
          />
          <SelectRow
            label="Camera Spawn"
            value={s.cameraSpawnBehaviour}
            onChange={s.setCameraSpawnBehaviour}
            options={[
              { value: "last", label: "Resume last session" },
              { value: "home", label: "Home position" },
              { value: "deepest", label: "Deepest point" },
              { value: "center", label: "Geographic center" },
            ]}
            sublabel="Where to place the camera on the next visit"
          />
        </div>
        <div style={S.card}>
          <div
            style={{
              ...S.cardHeader,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>TOUCH CONTROLS</span>
            <span style={{ fontSize: "calc(8px * var(--bs-font-scale, 1))", color: "#64748b", letterSpacing: "0.1em" }}>
              MOBILE / TOUCH ONLY
            </span>
          </div>
          <SelectRow
            label="On-Screen Joystick"
            value={s.joystickMode}
            onChange={s.setJoystickMode}
            options={[
              { value: "auto", label: "Auto (touch only)" },
              { value: "always", label: "Always on" },
              { value: "off", label: "Off" },
            ]}
            sublabel="Virtual joystick visibility on touch devices"
          />
          <ToggleRow
            label="Show Joystick in Orbit Mode"
            value={s.showJoystickInOrbit}
            onChange={s.setShowJoystickInOrbit}
            sublabel="Keep joystick visible during two-finger orbit gestures on touch"
          />
        </div>
      </AdvancedDisclosure>

      {/* Keyboard Shortcuts */}
      <div style={{ ...S.card, marginTop: 16 }}>
        <div style={S.cardHeader}>KEYBOARD SHORTCUTS</div>
      </div>

      {SHORTCUT_GROUPS.map((group) => {
        const actions = SHORTCUT_ACTIONS.filter((a) => a.group === group.id);
        if (actions.length === 0) return null;
        return (
          <div key={group.id} style={S.card}>
            <div style={S.cardHeader}>{group.title}</div>
            {actions.map((a) => (
              <KeyBindingCapture
                key={a.id}
                action={a.id}
                conflictWith={conflictByAction.get(a.id) ?? []}
              />
            ))}
          </div>
        );
      })}

      <div style={S.card}>
        <div style={S.cardHeader}>GAMEPAD</div>
        <CrosshairMenuGamepadCapture />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0 16px" }}>
        <button
          type="button"
          data-testid="reset-all-bindings-btn"
          onClick={() => resetAllKeyBindings()}
          disabled={allDefault}
          style={{
            background: "none",
            border: "1px solid rgba(0,229,255,0.2)",
            borderRadius: 3,
            color: allDefault ? "#64748b" : "#67e8f9",
            fontSize: "calc(9px * var(--bs-font-scale, 1))",
            letterSpacing: "0.15em",
            padding: "4px 12px",
            cursor: allDefault ? "default" : "pointer",
            fontFamily: FONT,
            opacity: allDefault ? 0.5 : 1,
          }}
        >
          RESET ALL KEY BINDINGS
        </button>
      </div>

      <div style={S.card}>
        <div style={S.cardHeader}>FIXED CONTROLS</div>
        <div style={{ padding: "8px 16px" }}>
          {FIXED_SHORTCUTS.map((sh) => (
            <div
              key={sh.keys}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 0",
                borderBottom: "1px solid rgba(0,229,255,0.05)",
                fontSize: "calc(11px * var(--bs-font-scale, 1))",
              }}
            >
              <span style={{ color: "#e2e8f0" }}>{sh.desc}</span>
              <kbd
                style={{
                  background: "rgba(0,229,255,0.08)",
                  border: "1px solid rgba(0,229,255,0.25)",
                  borderRadius: 3,
                  padding: "2px 8px",
                  fontFamily: FONT,
                  fontSize: "calc(10px * var(--bs-font-scale, 1))",
                  color: "#67e8f9",
                }}
              >
                {sh.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
