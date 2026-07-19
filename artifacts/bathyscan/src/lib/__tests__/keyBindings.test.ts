import { describe, it, expect } from "vitest";
import {
  DEFAULT_KEY_BINDINGS,
  SHORTCUT_ACTIONS,
  ARROW_KEY_ALIASES,
  MOVEMENT_ARROW_SYMBOLS,
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

describe("arrow key aliases", () => {
  it("ARROW_KEY_ALIASES maps each arrow code to the correct movement action", () => {
    expect(ARROW_KEY_ALIASES["ArrowUp"]).toBe("moveForward");
    expect(ARROW_KEY_ALIASES["ArrowDown"]).toBe("moveBackward");
    expect(ARROW_KEY_ALIASES["ArrowLeft"]).toBe("strafeLeft");
    expect(ARROW_KEY_ALIASES["ArrowRight"]).toBe("strafeRight");
  });

  it("ARROW_KEY_ALIASES contains exactly the four directional codes", () => {
    const codes = Object.keys(ARROW_KEY_ALIASES);
    expect(codes).toHaveLength(4);
    expect(codes).toContain("ArrowUp");
    expect(codes).toContain("ArrowDown");
    expect(codes).toContain("ArrowLeft");
    expect(codes).toContain("ArrowRight");
  });

  it("MOVEMENT_ARROW_SYMBOLS provides the correct Unicode arrow for each movement action", () => {
    expect(MOVEMENT_ARROW_SYMBOLS["moveForward"]).toBe("↑");
    expect(MOVEMENT_ARROW_SYMBOLS["moveBackward"]).toBe("↓");
    expect(MOVEMENT_ARROW_SYMBOLS["strafeLeft"]).toBe("←");
    expect(MOVEMENT_ARROW_SYMBOLS["strafeRight"]).toBe("→");
  });

  it("MOVEMENT_ARROW_SYMBOLS does not cover non-movement actions", () => {
    expect(MOVEMENT_ARROW_SYMBOLS["ascend"]).toBeUndefined();
    expect(MOVEMENT_ARROW_SYMBOLS["descend"]).toBeUndefined();
    expect(MOVEMENT_ARROW_SYMBOLS["speedUp"]).toBeUndefined();
    expect(MOVEMENT_ARROW_SYMBOLS["dropGpsPin"]).toBeUndefined();
    expect(MOVEMENT_ARROW_SYMBOLS["openSettings"]).toBeUndefined();
  });

  it("arrow codes are not present in DEFAULT_KEY_BINDINGS (aliases are fixed, not remappable)", () => {
    const defaultCodes = Object.values(DEFAULT_KEY_BINDINGS);
    for (const arrowCode of Object.keys(ARROW_KEY_ALIASES)) {
      expect(defaultCodes).not.toContain(arrowCode);
    }
  });

  it("each arrow alias maps to an action whose default WASD binding is distinct from the arrow code", () => {
    for (const [arrowCode, actionId] of Object.entries(ARROW_KEY_ALIASES)) {
      const defaultCode = DEFAULT_KEY_BINDINGS[actionId];
      expect(arrowCode).not.toBe(defaultCode);
    }
  });
});
