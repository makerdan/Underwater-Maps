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
    expect(screen.getByText(/Orbit around point under cursor/)).toBeInTheDocument();
    expect(screen.queryByText(/Toggle orbit \/ fly mode/)).not.toBeInTheDocument();

    fireEvent.click(btn);
    expect(screen.queryByText(/W A S D/)).not.toBeInTheDocument();
  });

  it("lists H, M, /, and , shortcuts in the legend", () => {
    renderWithProvider();
    const btn = screen.getByRole("button", { name: /toggle controls help/i });
    fireEvent.click(btn);

    // H — What's Here panel
    expect(screen.getByText("H")).toBeInTheDocument();
    expect(screen.getByText(/What's Here panel/i)).toBeInTheDocument();

    // M — cycle sidebar mode
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByText(/cycle sidebar mode/i)).toBeInTheDocument();

    // / — AI query panel
    expect(screen.getByText("/")).toBeInTheDocument();
    expect(screen.getByText(/AI query panel/i)).toBeInTheDocument();

    // , — Settings
    expect(screen.getByText(",")).toBeInTheDocument();
    expect(screen.getByText(/Open Settings/i)).toBeInTheDocument();
  });
});
