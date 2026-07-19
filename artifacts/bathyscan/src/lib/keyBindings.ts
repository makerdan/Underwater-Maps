/**
 * keyBindings — registry of remappable keyboard actions.
 *
 * Each `ShortcutActionDef` describes a single user-facing action that can
 * be triggered by a keyboard key. The default code is a `KeyboardEvent.code`
 * value (e.g. "KeyW", "Space", "Slash") so layout differences don't break
 * physical-position bindings.
 *
 * The Settings page lists every action here and lets the user remap it to
 * any other key. The store persists user choices as a `Record<ActionId, code>`.
 */

export type ShortcutActionId =
  | "moveForward"
  | "moveBackward"
  | "strafeLeft"
  | "strafeRight"
  | "ascend"
  | "descend"
  | "speedUp"
  | "speedDown"
  | "dropGpsPin"
  | "crosshairMenu"
  | "toggleOverview"
  | "openQuery"
  | "openSettings";

export type ShortcutGroupId = "movement" | "speed" | "actions" | "ui";

export interface ShortcutGroupDef {
  id: ShortcutGroupId;
  title: string;
}

export const SHORTCUT_GROUPS: ShortcutGroupDef[] = [
  { id: "movement", title: "MOVEMENT" },
  { id: "speed", title: "SPEED" },
  { id: "actions", title: "ACTIONS" },
  { id: "ui", title: "INTERFACE" },
];

export interface ShortcutActionDef {
  id: ShortcutActionId;
  label: string;
  description: string;
  defaultCode: string;
  group: ShortcutGroupId;
}

export const SHORTCUT_ACTIONS: ShortcutActionDef[] = [
  { id: "moveForward",    label: "Move forward",        description: "Fly the camera forward",                 defaultCode: "KeyW",      group: "movement" },
  { id: "moveBackward",   label: "Move backward",       description: "Fly the camera backward",                defaultCode: "KeyS",      group: "movement" },
  { id: "strafeLeft",     label: "Strafe left",         description: "Slide the camera left",                  defaultCode: "KeyA",      group: "movement" },
  { id: "strafeRight",    label: "Strafe right",        description: "Slide the camera right",                 defaultCode: "KeyD",      group: "movement" },
  { id: "ascend",         label: "Ascend",              description: "Move the camera straight up",            defaultCode: "Space",     group: "movement" },
  { id: "descend",        label: "Descend",             description: "Move the camera straight down",          defaultCode: "ShiftLeft", group: "movement" },

  { id: "speedUp",        label: "Increase speed tier", description: "Speed up the fly camera",                defaultCode: "Equal",     group: "speed" },
  { id: "speedDown",      label: "Decrease speed tier", description: "Slow down the fly camera",               defaultCode: "Minus",     group: "speed" },

  { id: "dropGpsPin",     label: "Drop GPS pin",        description: "Drop a marker at the crosshair",         defaultCode: "KeyG",      group: "actions" },
  { id: "crosshairMenu",  label: "Crosshair action menu", description: "Open the terrain action menu at the crosshair", defaultCode: "KeyQ", group: "actions" },

  { id: "toggleOverview", label: "Toggle overview map", description: "Show or hide the overview map",          defaultCode: "KeyO",      group: "ui" },
  { id: "openQuery",      label: "Open query panel",    description: "Focus the natural-language query panel", defaultCode: "Slash",     group: "ui" },
  { id: "openSettings",   label: "Open settings",       description: "Navigate to the Settings page",          defaultCode: "Comma",     group: "ui" },
];

export const DEFAULT_KEY_BINDINGS: Record<ShortcutActionId, string> =
  SHORTCUT_ACTIONS.reduce(
    (acc, a) => {
      acc[a.id] = a.defaultCode;
      return acc;
    },
    {} as Record<ShortcutActionId, string>,
  );

export const SHORTCUT_ACTIONS_BY_ID: Record<ShortcutActionId, ShortcutActionDef> =
  SHORTCUT_ACTIONS.reduce(
    (acc, a) => {
      acc[a.id] = a;
      return acc;
    },
    {} as Record<ShortcutActionId, ShortcutActionDef>,
  );

/**
 * Returns a map of `KeyboardEvent.code` → list of action ids currently bound
 * to that code. Any entry with more than one action id is a conflict.
 */
export function findBindingConflicts(
  bindings: Record<string, string>,
): Map<string, ShortcutActionId[]> {
  const byCode = new Map<string, ShortcutActionId[]>();
  for (const action of SHORTCUT_ACTIONS) {
    const code = bindings[action.id] ?? action.defaultCode;
    if (!code) continue;
    const list = byCode.get(code) ?? [];
    list.push(action.id);
    byCode.set(code, list);
  }
  return byCode;
}

/**
 * Merge a partial user-saved bindings map with the defaults so every
 * action always has a resolved code (even for actions added after the
 * user's last save).
 */
export function resolveKeyBindings(
  partial: Partial<Record<ShortcutActionId, string>> | undefined,
): Record<ShortcutActionId, string> {
  return { ...DEFAULT_KEY_BINDINGS, ...(partial ?? {}) };
}

/**
 * Resolve a single action id to its current key code, falling back to the
 * action's default if the bindings map is missing an entry.
 */
export function getBoundKey(
  bindings: Record<string, string> | undefined,
  action: ShortcutActionId,
): string {
  return bindings?.[action] ?? DEFAULT_KEY_BINDINGS[action];
}

/**
 * Fixed arrow-key aliases for the four movement actions.
 * ArrowUp = forward, ArrowDown = backward, ArrowLeft = strafe-left,
 * ArrowRight = strafe-right. These are NOT user-remappable; they are
 * always active in addition to the user's configured WASD bindings.
 */
export const ARROW_KEY_ALIASES: Record<string, ShortcutActionId> = {
  ArrowUp: "moveForward",
  ArrowDown: "moveBackward",
  ArrowLeft: "strafeLeft",
  ArrowRight: "strafeRight",
};

/**
 * Arrow-key symbol to display as a fixed secondary hint next to the
 * four movement actions in the Settings keyboard-shortcut panel.
 */
export const MOVEMENT_ARROW_SYMBOLS: Partial<Record<ShortcutActionId, string>> = {
  moveForward: "↑",
  moveBackward: "↓",
  strafeLeft: "←",
  strafeRight: "→",
};
