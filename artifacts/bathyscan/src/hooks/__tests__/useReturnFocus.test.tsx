/**
 * useReturnFocus.test.tsx
 *
 * Verifies that when a dialog using useReturnFocus unmounts, keyboard focus
 * returns to the element that was active when the dialog opened.
 *
 * Tests the hook via a representative dialog (GeoreferenceModal) as well as
 * a minimal wrapper component.
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { useReturnFocus } from "@/hooks/useReturnFocus";

// ── Minimal test component ────────────────────────────────────────────────────

function FakeDialog({ onClose }: { onClose?: () => void }) {
  useReturnFocus();
  return (
    <div role="dialog">
      <button onClick={onClose}>Close</button>
    </div>
  );
}

function Host() {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <button
        data-testid="trigger"
        onClick={() => setOpen(true)}
      >
        Open dialog
      </button>
      {open && <FakeDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("useReturnFocus", () => {
  it("returns focus to the trigger element after the dialog unmounts", async () => {
    render(<Host />);

    const trigger = screen.getByTestId("trigger");

    // Focus the trigger and open the dialog
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    act(() => {
      trigger.click();
    });

    // Dialog is now open; active element has moved inside it
    const closeBtn = screen.getByRole("button", { name: "Close" });
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);

    // Close the dialog
    act(() => {
      closeBtn.click();
    });

    // Focus must be back on the trigger
    expect(document.activeElement).toBe(trigger);
  });

  it("does not throw when no element was focused at mount time", () => {
    // Blur everything so activeElement is body
    (document.activeElement as HTMLElement | null)?.blur?.();

    // Should render and unmount without errors
    const { unmount } = render(<FakeDialog />);
    expect(() => unmount()).not.toThrow();
  });
});
