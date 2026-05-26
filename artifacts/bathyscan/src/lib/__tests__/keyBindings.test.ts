import { describe, it, expect } from "vitest";
import {
  DEFAULT_KEY_BINDINGS,
  SHORTCUT_ACTIONS,
  findBindingConflicts,
  getBoundKey,
  resolveKeyBindings,
} from "../keyBindings";

describe("keyBindings", () => {
  it("defaults cover every registered action with a non-empty code", () => {
    for (const action of SHORTCUT_ACTIONS) {
      expect(DEFAULT_KEY_BINDINGS[action.id]).toBe(action.defaultCode);
      expect(DEFAULT_KEY_BINDINGS[action.id]).toMatch(/\S/);
    }
  });

  it("resolveKeyBindings fills missing entries from defaults", () => {
    const partial = { moveForward: "KeyI" } as Record<string, string>;
    const resolved = resolveKeyBindings(partial);
    expect(resolved.moveForward).toBe("KeyI");
    expect(resolved.moveBackward).toBe(DEFAULT_KEY_BINDINGS.moveBackward);
    expect(resolved.openSettings).toBe(DEFAULT_KEY_BINDINGS.openSettings);
  });

  it("getBoundKey returns the user-bound code", () => {
    const bindings = { ...DEFAULT_KEY_BINDINGS, openSettings: "Semicolon" };
    expect(getBoundKey(bindings, "openSettings")).toBe("Semicolon");
    expect(getBoundKey(bindings, "moveForward")).toBe("KeyW");
  });

  it("findBindingConflicts groups actions that share a code", () => {
    const bindings = {
      ...DEFAULT_KEY_BINDINGS,
      moveForward: "KeyW",
      ascend: "KeyW", // conflict with moveForward
    };
    const byCode = findBindingConflicts(bindings);
    const sharing = byCode.get("KeyW") ?? [];
    expect(sharing).toContain("moveForward");
    expect(sharing).toContain("ascend");
    expect(sharing.length).toBeGreaterThanOrEqual(2);
    // unique bindings appear too, but with a single action in the list
    expect(byCode.get("KeyS")).toEqual(["moveBackward"]);
  });

  it("defaults have no code shared by more than one action", () => {
    const byCode = findBindingConflicts(DEFAULT_KEY_BINDINGS);
    for (const [, ids] of byCode) {
      expect(ids.length).toBe(1);
    }
  });
});
