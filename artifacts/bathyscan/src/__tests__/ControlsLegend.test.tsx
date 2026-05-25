import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ControlsLegend } from "@/components/ControlsLegend";

function renderWithProvider() {
  return render(
    <TooltipProvider>
      <ControlsLegend />
    </TooltipProvider>,
  );
}

describe("ControlsLegend", () => {
  it("renders the ? toggle button", () => {
    renderWithProvider();
    const btn = screen.getByRole("button", { name: /toggle controls help/i });
    expect(btn).toHaveTextContent("?");
  });

  it("does not show key bindings panel by default", () => {
    renderWithProvider();
    expect(screen.queryByText(/W A S D/)).not.toBeInTheDocument();
  });

  it("shows key bindings when ? is clicked, hides on second click", () => {
    renderWithProvider();
    const btn = screen.getByRole("button", { name: /toggle controls help/i });

    fireEvent.click(btn);
    expect(screen.getByText(/W A S D/)).toBeInTheDocument();
    expect(screen.getByText(/Move forward \/ strafe/)).toBeInTheDocument();
    expect(screen.getByText(/Toggle orbit \/ fly mode/)).toBeInTheDocument();

    fireEvent.click(btn);
    expect(screen.queryByText(/W A S D/)).not.toBeInTheDocument();
  });
});
