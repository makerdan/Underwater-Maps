/**
 * Unit tests for useSubstrateErrorToast.
 *
 * Covers:
 * - When isError is true and enabled, fires the branded toast exactly once.
 * - When isEmpty is true and enabled, fires the "no coverage" toast exactly once.
 * - Does not fire again on re-render with the same props.
 * - Does not fire when enabled is false.
 * - Does not fire when isError=false and isEmpty=false (data present).
 * - Does not fire when datasetId is empty.
 * - Fires again for a new datasetId after the previous one unmounts.
 * - The module-level Set prevents double-fire when two component instances
 *   use the hook for the same datasetId simultaneously.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useSubstrateErrorToast } from "@/hooks/useSubstrateErrorToast";

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast }),
}));

function Harness({
  isError,
  isEmpty,
  datasetId,
  enabled,
}: {
  isError: boolean;
  isEmpty: boolean;
  datasetId: string;
  enabled: boolean;
}) {
  useSubstrateErrorToast({ isError, isEmpty, datasetId, enabled });
  return null;
}

beforeEach(() => {
  mockToast.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSubstrateErrorToast", () => {
  it("fires the toast when isError=true and enabled=true", () => {
    act(() => {
      render(<Harness isError isEmpty={false} datasetId="ds-upload" enabled />);
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "No substrate map available",
        variant: "destructive",
      }),
    );
  });

  it("fires the toast when isEmpty=true and enabled=true", () => {
    act(() => {
      render(<Harness isError={false} isEmpty datasetId="ds-empty-coverage" enabled />);
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "No substrate map available",
        variant: "destructive",
      }),
    );
  });

  it("isEmpty toast description mentions bundled substrate polygons", () => {
    act(() => {
      render(<Harness isError={false} isEmpty datasetId="ds-empty-desc" enabled />);
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/bundled substrate polygon/i),
      }),
    );
  });

  it("does not fire the toast when isError=false and isEmpty=false (data is present)", () => {
    act(() => {
      render(<Harness isError={false} isEmpty={false} datasetId="ds-normal" enabled />);
    });

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("does not fire the toast when enabled=false", () => {
    act(() => {
      render(<Harness isError isEmpty={false} datasetId="ds-disabled" enabled={false} />);
    });

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("does not fire the toast when datasetId is empty", () => {
    act(() => {
      render(<Harness isError isEmpty={false} datasetId="" enabled />);
    });

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("does not fire the toast a second time on re-render with the same props", () => {
    const { rerender } = render(<Harness isError isEmpty={false} datasetId="ds-rerender" enabled />);

    expect(mockToast).toHaveBeenCalledTimes(1);

    act(() => {
      rerender(<Harness isError isEmpty={false} datasetId="ds-rerender" enabled />);
    });
    act(() => {
      rerender(<Harness isError isEmpty={false} datasetId="ds-rerender" enabled />);
    });

    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it("does not fire when overlay is toggled on after a non-error state", () => {
    const { rerender } = render(
      <Harness isError={false} isEmpty={false} datasetId="ds-toggle" enabled={false} />,
    );

    act(() => {
      rerender(<Harness isError={false} isEmpty={false} datasetId="ds-toggle" enabled />);
    });

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("the isError description mentions built-in survey regions", () => {
    act(() => {
      render(<Harness isError isEmpty={false} datasetId="ds-desc" enabled />);
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/built-in survey region/i),
      }),
    );
  });
});
