/**
 * Settings → Shortcuts: keyboard rebinding capture flow.
 *
 * Verifies that clicking the capture button arms a one-shot key listener,
 * the next keydown writes the new code into the settings store, and the
 * captured label is reflected back in the button text (the same value the
 * HUD hint reads).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({
    user: { primaryEmailAddress: { emailAddress: "test@example.com" }, username: "test" },
    isSignedIn: true,
  }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", vi.fn()],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false, refetch: noop }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetSettings: () => ({ data: null }),
  }),
);

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: (sel: (s: { activeGrid: null }) => unknown) => sel({ activeGrid: null }),
}));

vi.mock("idb-keyval", () => ({
  keys: () => Promise.resolve([]),
  clear: () => Promise.resolve(),
  get: () => Promise.resolve(null),
  del: () => Promise.resolve(),
}));

import { Settings } from "@/pages/Settings";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { formatKeyCode, formatGamepadButton } from "@/lib/keyLabel";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
  });
});

function openShortcutsSection() {
  render(<Settings />);
  fireEvent.click(screen.getByText("SHORTCUTS"));
}

describe("Settings — crosshair menu key capture", () => {
  it("button label reflects the current binding", () => {
    openShortcutsSection();
    const btn = screen.getByTestId("shortcut-crosshair-menu-key");
    // Default is KeyQ → formatted as "Q" → upper-cased "Q"
    expect(btn).toHaveTextContent("Q");
    expect(useSettingsStore.getState().keyBindings.crosshairMenu).toBe("KeyQ");
  });

  it("clicking the capture button arms it and the next keydown writes the new key", () => {
    openShortcutsSection();
    const btn = screen.getByTestId("shortcut-crosshair-menu-key");

    fireEvent.click(btn);
    expect(btn).toHaveTextContent(/PRESS ANY KEY/i);

    // Bare modifier presses are ignored — the button stays armed.
    fireEvent.keyDown(window, { code: "ShiftLeft" });
    expect(btn).toHaveTextContent(/PRESS ANY KEY/i);
    expect(useSettingsStore.getState().keyBindings.crosshairMenu).toBe("KeyQ");

    // First real key resolves the capture.
    fireEvent.keyDown(window, { code: "KeyT" });

    expect(useSettingsStore.getState().keyBindings.crosshairMenu).toBe("KeyT");
    expect(btn).toHaveTextContent("T");
    expect(btn).not.toHaveTextContent(/PRESS ANY KEY/i);
  });

  it("Escape during capture cancels without changing the binding", () => {
    openShortcutsSection();
    const btn = screen.getByTestId("shortcut-crosshair-menu-key");

    fireEvent.click(btn);
    expect(btn).toHaveTextContent(/PRESS ANY KEY/i);

    fireEvent.keyDown(window, { code: "Escape" });

    expect(useSettingsStore.getState().keyBindings.crosshairMenu).toBe("KeyQ");
    expect(btn).toHaveTextContent("Q");
  });

  it("RESET button restores the default KeyQ binding", () => {
    useSettingsStore.getState().setKeyBinding("crosshairMenu", "KeyM");
    openShortcutsSection();
    const btn = screen.getByTestId("shortcut-crosshair-menu-key");
    expect(btn).toHaveTextContent("M");

    // The reset button sits next to the capture button inside the row.
    const resetBtn = btn.parentElement!.querySelector("button:nth-of-type(2)") as HTMLButtonElement;
    fireEvent.click(resetBtn);

    expect(useSettingsStore.getState().keyBindings.crosshairMenu).toBe("KeyQ");
    expect(btn).toHaveTextContent("Q");
  });

  it("captured value matches the formatKeyCode helper used by the HUD hint", () => {
    openShortcutsSection();
    const btn = screen.getByTestId("shortcut-crosshair-menu-key");
    fireEvent.click(btn);
    fireEvent.keyDown(window, { code: "Slash" });

    const stored = useSettingsStore.getState().keyBindings.crosshairMenu;
    expect(stored).toBe("Slash");
    // The HUD hint renders `formatKeyCode(keyBindings.crosshairMenu).toUpperCase()`.
    expect(btn.textContent).toContain(formatKeyCode(stored).toUpperCase());
  });
});

describe("Settings — crosshair menu gamepad capture", () => {
  it("DISABLE clears the binding and the button label switches to 'Off'", () => {
    openShortcutsSection();
    const btn = screen.getByTestId("shortcut-crosshair-menu-gamepad");
    // Default is Y/Triangle (button 3)
    expect(btn).toHaveTextContent(formatGamepadButton(3).toUpperCase());
    expect(useSettingsStore.getState().crosshairMenuGamepadButton).toBe(3);

    // Buttons: [capture, DISABLE, RESET] — DISABLE is index 1
    const disableBtn = btn.parentElement!.querySelector("button:nth-of-type(2)") as HTMLButtonElement;
    fireEvent.click(disableBtn);

    expect(useSettingsStore.getState().crosshairMenuGamepadButton).toBeNull();
    expect(btn).toHaveTextContent("OFF");
  });

  it("RESET restores the default gamepad button after DISABLE", () => {
    openShortcutsSection();
    const btn = screen.getByTestId("shortcut-crosshair-menu-gamepad");
    const row = btn.parentElement!;
    const disableBtn = row.querySelector("button:nth-of-type(2)") as HTMLButtonElement;
    const resetBtn = row.querySelector("button:nth-of-type(3)") as HTMLButtonElement;

    fireEvent.click(disableBtn);
    expect(useSettingsStore.getState().crosshairMenuGamepadButton).toBeNull();

    fireEvent.click(resetBtn);
    expect(useSettingsStore.getState().crosshairMenuGamepadButton).toBe(3);
    expect(btn).toHaveTextContent(formatGamepadButton(3).toUpperCase());
  });
});
