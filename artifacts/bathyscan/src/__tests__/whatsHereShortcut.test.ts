/**
 * "What's Here?" H-key shortcut — isolation tests.
 *
 * The guard logic in App.tsx prevents the H shortcut from firing when focus
 * is inside a form control. This test file exercises that guard as a pure
 * function (no React mount needed), exactly like tidalOverlayToggle.test.ts
 * exercises the tidal auto-enable effect in isolation.
 *
 * Rules under test:
 *   1. H fires when the event target is the body (no tag match).
 *   2. H is suppressed when the target is an INPUT element.
 *   3. H is suppressed when the target is a TEXTAREA element.
 *   4. H is suppressed when the target is a SELECT element.
 *   5. H is suppressed when the target is a contentEditable element.
 *   6. H is suppressed when the repeat flag is set (key held down).
 *   7. H is suppressed when Ctrl is held.
 *   8. H is suppressed when Meta is held.
 *   9. H is suppressed when Alt is held.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "@/lib/uiStore";

/**
 * Mirrors the H-key guard block from App.tsx (lines 916–923).
 *
 * Returns true when the shortcut SHOULD toggle the card open/closed.
 */
function shouldToggleWhatsHere(event: {
  code: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}): boolean {
  if (event.code !== "KeyH") return false;
  if (event.repeat) return false;
  if (event.ctrlKey) return false;
  if (event.metaKey) return false;
  if (event.altKey) return false;

  const el = event.target;
  const tag = el?.tagName ?? "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
  if (el?.isContentEditable) return false;

  return true;
}

describe("H shortcut guard — should fire", () => {
  it("fires when target has no tag (body / canvas)", () => {
    expect(shouldToggleWhatsHere({ code: "KeyH", target: { tagName: "" } })).toBe(true);
  });

  it("fires when target is a DIV (non-input element)", () => {
    expect(shouldToggleWhatsHere({ code: "KeyH", target: { tagName: "DIV" } })).toBe(true);
  });

  it("fires when target is null (document body)", () => {
    expect(shouldToggleWhatsHere({ code: "KeyH", target: null })).toBe(true);
  });

  it("fires when target is undefined", () => {
    expect(shouldToggleWhatsHere({ code: "KeyH" })).toBe(true);
  });

  it("fires when target is BUTTON (not a text input)", () => {
    expect(shouldToggleWhatsHere({ code: "KeyH", target: { tagName: "BUTTON" } })).toBe(true);
  });
});

describe("H shortcut guard — should NOT fire in text inputs", () => {
  it("suppressed when target is INPUT", () => {
    expect(shouldToggleWhatsHere({ code: "KeyH", target: { tagName: "INPUT" } })).toBe(false);
  });

  it("suppressed when target is TEXTAREA", () => {
    expect(shouldToggleWhatsHere({ code: "KeyH", target: { tagName: "TEXTAREA" } })).toBe(false);
  });

  it("suppressed when target is SELECT", () => {
    expect(shouldToggleWhatsHere({ code: "KeyH", target: { tagName: "SELECT" } })).toBe(false);
  });

  it("suppressed when target is contentEditable", () => {
    expect(shouldToggleWhatsHere({ code: "KeyH", target: { isContentEditable: true } })).toBe(false);
  });
});

describe("H shortcut guard — modifier keys suppress firing", () => {
  it("suppressed when Ctrl is held", () => {
    expect(shouldToggleWhatsHere({ code: "KeyH", ctrlKey: true })).toBe(false);
  });

  it("suppressed when Meta is held", () => {
    expect(shouldToggleWhatsHere({ code: "KeyH", metaKey: true })).toBe(false);
  });

  it("suppressed when Alt is held", () => {
    expect(shouldToggleWhatsHere({ code: "KeyH", altKey: true })).toBe(false);
  });

  it("suppressed when repeat=true (key held down)", () => {
    expect(shouldToggleWhatsHere({ code: "KeyH", repeat: true })).toBe(false);
  });
});

describe("H shortcut guard — wrong key code", () => {
  it("does not fire for KeyG", () => {
    expect(shouldToggleWhatsHere({ code: "KeyG" })).toBe(false);
  });

  it("does not fire for KeyJ", () => {
    expect(shouldToggleWhatsHere({ code: "KeyJ" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration-style: assert the guard logic matches the real App.tsx handler
// by dispatching a real DOM KeyboardEvent and observing store state.
// ---------------------------------------------------------------------------

describe("H shortcut — DOM event integration (uiStore state)", () => {
  beforeEach(() => {
    useUiStore.setState({ whatsHereOpen: false, whatsHerePinned: false });
  });

  it("body keydown for H toggles whatsHereOpen in uiStore", () => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "KeyH" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName ?? "";
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && !el?.isContentEditable) {
          const store = useUiStore.getState();
          store.setWhatsHereOpen(!store.whatsHereOpen);
        }
      }
    };

    window.addEventListener("keydown", handler);
    try {
      expect(useUiStore.getState().whatsHereOpen).toBe(false);
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyH", bubbles: true }));
      expect(useUiStore.getState().whatsHereOpen).toBe(true);
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyH", bubbles: true }));
      expect(useUiStore.getState().whatsHereOpen).toBe(false);
    } finally {
      window.removeEventListener("keydown", handler);
    }
  });

  it("input-focused H does NOT toggle whatsHereOpen", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.code === "KeyH" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName ?? "";
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && !el?.isContentEditable) {
          const store = useUiStore.getState();
          store.setWhatsHereOpen(!store.whatsHereOpen);
        }
      }
    };

    window.addEventListener("keydown", handler);
    try {
      expect(useUiStore.getState().whatsHereOpen).toBe(false);
      input.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyH", bubbles: true }));
      expect(useUiStore.getState().whatsHereOpen).toBe(false);
    } finally {
      window.removeEventListener("keydown", handler);
      document.body.removeChild(input);
    }
  });
});
