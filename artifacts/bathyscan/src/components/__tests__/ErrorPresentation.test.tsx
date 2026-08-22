import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

describe("error presentation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("keeps the complete diagnostic selectable and copies title, message, and detail", async () => {
    render(
      <ErrorMessage
        title="Upload failed"
        message="The server rejected this file."
        detail="Request ID: req-123"
      />,
    );

    const presentation = screen.getByText("The server rejected this file.").parentElement?.parentElement;
    expect(presentation).toHaveClass("select-text");
    fireEvent.click(screen.getByRole("button", { name: "Copy error text" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "Upload failed\nThe server rejected this file.\nRequest ID: req-123",
      ),
    );
    expect(screen.getByText("Copied!")).toBeInTheDocument();
  });

  it("falls back without removing the message when the modern clipboard rejects", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("denied"));
    const execCommand = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    render(<ErrorMessage message="Could not save the marker." />);

    fireEvent.click(screen.getByRole("button", { name: "Copy error text" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy failed" })).toBeInTheDocument());
    expect(screen.getByText("Could not save the marker.")).toBeInTheDocument();
    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});