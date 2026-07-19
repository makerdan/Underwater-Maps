/**
 * DataUnavailable — unit tests verifying the compact "not available" notice
 * renders correctly with a custom message and data-testid.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataUnavailable } from "@/components/DataUnavailable";

describe("DataUnavailable", () => {
  it("renders the message text", () => {
    render(<DataUnavailable message="No water level data for this location" />);
    expect(screen.getByTestId("data-unavailable")).toHaveTextContent(
      "No water level data for this location",
    );
  });

  it("uses the custom data-testid when provided", () => {
    render(
      <DataUnavailable
        message="No currents data for this location"
        data-testid="currents-freshwater-unavailable"
      />,
    );
    expect(screen.getByTestId("currents-freshwater-unavailable")).toBeInTheDocument();
  });

  it("shows the hollow circle aria-hidden indicator", () => {
    const { container } = render(
      <DataUnavailable message="No temperature data for this location" />,
    );
    const indicator = container.querySelector("[aria-hidden]");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toBe("◌");
  });
});
