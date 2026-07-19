import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { ContextMenu } from "@/components/ContextMenu";
import { useContextMenuStore } from "@/lib/contextMenuStore";

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

const ITEMS = [
  { label: "Action A", onClick: vi.fn() },
  { label: "Action B", onClick: vi.fn() },
];

function openMenu() {
  act(() => {
    useContextMenuStore.getState().show(100, 200, ITEMS);
  });
}

beforeEach(() => {
  useContextMenuStore.setState({ open: false, x: 0, y: 0, items: [] });
});

describe("ContextMenu — blur / visibility dismiss", () => {
  it("closes the menu when the window fires a blur event", () => {
    render(<ContextMenu />);
    openMenu();
    expect(useContextMenuStore.getState().open).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(useContextMenuStore.getState().open).toBe(false);
  });

  it("closes the menu when the document becomes hidden", () => {
    render(<ContextMenu />);
    openMenu();
    expect(useContextMenuStore.getState().open).toBe(true);

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(useContextMenuStore.getState().open).toBe(false);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  it("does NOT close the menu when visibilityState is still visible", () => {
    render(<ContextMenu />);
    openMenu();
    expect(useContextMenuStore.getState().open).toBe(true);

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(useContextMenuStore.getState().open).toBe(true);
  });
});

describe("ContextMenu — unmount cleans up store", () => {
  it("resets open to false when the component unmounts while the menu is open", () => {
    const { unmount } = render(<ContextMenu />);
    openMenu();
    expect(useContextMenuStore.getState().open).toBe(true);

    act(() => {
      unmount();
    });

    expect(useContextMenuStore.getState().open).toBe(false);
  });

  it("leaves open as false when the component unmounts while the menu is already closed", () => {
    const { unmount } = render(<ContextMenu />);
    expect(useContextMenuStore.getState().open).toBe(false);

    act(() => {
      unmount();
    });

    expect(useContextMenuStore.getState().open).toBe(false);
  });
});
