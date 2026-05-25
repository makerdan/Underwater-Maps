import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ControlsLegend } from "@/components/ControlsLegend";

describe("ControlsLegend", () => {
  it("renders the ? toggle button", () => {
    render(<ControlsLegend />);
    const btn = screen.getByTitle("Controls");
    expect(btn).toHaveTextContent("?");
  });

  it("does not show key bindings panel by default", () => {
    render(<ControlsLegend />);
    expect(screen.queryByText(/W A S D/)).not.toBeInTheDocument();
  });

  it("shows key bindings when ? is clicked, hides on second click", () => {
    render(<ControlsLegend />);
    const btn = screen.getByTitle("Controls");

    fireEvent.click(btn);
    expect(screen.getByText(/W A S D/)).toBeInTheDocument();
    expect(screen.getByText(/Move forward \/ strafe/)).toBeInTheDocument();
    expect(screen.getByText(/Toggle orbit \/ fly mode/)).toBeInTheDocument();

    fireEvent.click(btn);
    expect(screen.queryByText(/W A S D/)).not.toBeInTheDocument();
  });
});
