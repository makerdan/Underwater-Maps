import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { LoadingDial } from "@/components/LoadingDial";
import { useActiveLoadStore } from "@/lib/activeLoadStore";

beforeEach(() => {
  useActiveLoadStore.setState({ active: null, history: {} });
});

describe("LoadingDial", () => {
  it("renders a progressbar with the correct percentage from an override", () => {
    render(<LoadingDial progress={0.42} label="X" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-label", expect.stringContaining("42"));
  });

  it("computes stroke-dashoffset proportional to (1 - progress)", () => {
    const { container } = render(<LoadingDial progress={0.25} />);
    const arc = container.querySelector("[data-testid='loading-dial-arc']")!;
    const offset = parseFloat(arc.getAttribute("stroke-dashoffset")!);
    const dash = parseFloat(arc.getAttribute("stroke-dasharray")!);
    expect(offset / dash).toBeCloseTo(0.75, 2);
  });

  it("does not show an ETA before the >500ms threshold has elapsed", () => {
    useActiveLoadStore.setState({
      active: {
        datasetId: "ds",
        bucket: "ds",
        bytesLoaded: 100,
        bytesTotal: 1000,
        startedAt: Date.now() - 50,
        tick: 0,
      },
      history: {},
    });
    render(<LoadingDial datasetId="ds" />);
    expect(screen.queryByTestId("loading-dial-eta")).toBeNull();
  });

  it("shows an ETA hint once enough signal has accumulated", () => {
    useActiveLoadStore.setState({
      active: {
        datasetId: "ds",
        bucket: "ds",
        bytesLoaded: 100,
        bytesTotal: 1000,
        startedAt: Date.now() - 1000,
        tick: 0,
      },
      history: {},
    });
    render(<LoadingDial datasetId="ds" />);
    const eta = screen.getByTestId("loading-dial-eta");
    expect(eta.textContent).toMatch(/~\d+s/);
  });

  it("renders 0% when datasetId does not match the active load", () => {
    useActiveLoadStore.setState({
      active: {
        datasetId: "other",
        bucket: "other",
        bytesLoaded: 500,
        bytesTotal: 1000,
        startedAt: Date.now() - 500,
        tick: 0,
      },
      history: {},
    });
    render(<LoadingDial datasetId="ds" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("snaps the dial to 100% when the load completes", () => {
    useActiveLoadStore.setState({
      active: {
        datasetId: "ds",
        bucket: "ds",
        bytesLoaded: 0,
        bytesTotal: null,
        startedAt: Date.now() - 200,
        tick: 0,
      },
      history: {},
    });
    const { rerender } = render(<LoadingDial datasetId="ds" />);
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBeLessThan(100);
    act(() => {
      useActiveLoadStore.getState().complete("ds");
    });
    rerender(<LoadingDial progress={1} datasetId="ds" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});
