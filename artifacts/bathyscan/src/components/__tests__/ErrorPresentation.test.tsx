import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { SceneChunkFallback } from "@/lib/dynamicSceneLoader";
import { ClerkLoadFailedFallback } from "@/App";

/**
 * Keep this list in sync when adding a bespoke user-visible failure surface.
 *
 * Shared ErrorMessage callers inherit the component contract below. The other
 * entries are deliberately explicit because a bespoke JSX fallback can look
 * correct while silently losing either selection or its copy action.
 *
 * This is not an inventory of every string containing "error": console-only
 * diagnostics, transient connection status, and intentional select-none
 * controls are outside the user-facing failure contract.
 */
const USER_VISIBLE_FAILURE_SURFACES = [
  {
    name: "shared ErrorMessage contract",
    file: "components/ui/ErrorMessage.tsx",
    marker: "Selectable error content with one consistent",
    copyMarker: "<CopyButton",
    selectableMarker: "select-text",
  },
  {
    name: "offline banner",
    file: "App.tsx",
    marker: 'data-testid="offline-banner"',
    copyMarker: '<CopyButton text="You\'re offline"',
    selectableMarker: "select-text",
  },
  {
    name: "service unavailable banner",
    file: "App.tsx",
    marker: 'data-testid="service-unavailable-banner"',
    copyMarker: "text=\"Service unavailable\"",
    selectableMarker: "select-text",
  },
  {
    name: "session expired banner",
    file: "App.tsx",
    marker: "Session expired — please reload to continue",
    copyMarker: "text=\"Session expired — please reload to continue\"",
    selectableMarker: "select-text",
  },
  {
    name: "development API failure banner",
    file: "components/DevApiDownBanner.tsx",
    marker: 'data-testid="dev-api-down-banner"',
    copyMarker: "<CopyButton",
    selectableMarker: "select-text",
  },
  {
    name: "error boundary fallback",
    file: "components/ErrorBoundary.tsx",
    marker: "Something went wrong loading",
    copyMarker: "<CopyButton",
    selectableMarker: "userSelect: \"text\"",
  },
  {
    name: "offline read-only banner",
    file: "components/OfflineReadOnlyBanner.tsx",
    marker: "read-only",
    copyMarker: "<CopyButton",
    selectableMarker: "select-text",
  },
  {
    name: "land terrain status failure",
    file: "components/LandTerrainStatusBanner.tsx",
    marker: 'data-testid="land-terrain-status-banner"',
    copyMarker: "<CopyButton",
    selectableMarker: "userSelect: error ? \"text\" : \"none\"",
  },
  {
    name: "3D map chunk fallback",
    file: "lib/dynamicSceneLoader.tsx",
    marker: 'data-testid="scene-chunk-fallback"',
    copyMarker: "<CopyButton",
    selectableMarker: "select-text",
  },
  {
    name: "authentication-load failure fallback",
    file: "App.tsx",
    marker: "Authentication service failed to load.",
    copyMarker: "<CopyButton",
    selectableMarker: "select-text",
  },
] as const;

const BATHYSCAN_SRC = resolve(import.meta.dirname, "../..");

function readSurfaceSource(file: string, marker: string): string {
  const source = readFileSync(resolve(BATHYSCAN_SRC, file), "utf8");
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Could not find inventory marker "${marker}" in ${file}`);
  }

  // These entries point to one surface per file. Check the complete file so
  // multiline JSX and inline-style fallbacks cannot evade the contract.
  return source;
}

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

  it("renders a copy action for the 3D map chunk fallback", async () => {
    render(<SceneChunkFallback />);

    expect(screen.getByTestId("scene-chunk-fallback")).toHaveClass("select-text");
    fireEvent.click(screen.getByRole("button", { name: "Copy error text" }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "The 3D map could not be loaded.\n" +
          "The app was updated while this page was open. Reload once to get the current map assets.",
      ),
    );
  });

  it("renders a copy action for the authentication-load failure fallback", async () => {
    render(<ClerkLoadFailedFallback />);

    expect(screen.getByRole("alert")).toHaveClass("select-text");
    fireEvent.click(screen.getByRole("button", { name: "Copy error text" }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "Authentication service failed to load.\n" +
          "This may be a temporary network issue. Try reloading the page.",
      ),
    );
  });

  it("shows the copy failure state when a fallback cannot write to the clipboard", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });
    render(<ClerkLoadFailedFallback />);

    fireEvent.click(screen.getByRole("button", { name: "Copy error text" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy failed" })).toBeInTheDocument(),
    );
    expect(screen.getByText("Authentication service failed to load.")).toBeInTheDocument();
  });

  it.each(USER_VISIBLE_FAILURE_SURFACES)(
    "keeps the $name surface selectable and copyable",
    ({ file, marker, copyMarker, selectableMarker }) => {
      const surface = readSurfaceSource(file, marker);
      expect(surface, `${file} is missing its copy affordance`).toContain(copyMarker);
      expect(surface, `${file} is missing selectable error text`).toContain(selectableMarker);
    },
  );
});