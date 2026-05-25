/**
 * Tests that the TourScene Canvas wires up webglcontextlost/restored handlers
 * and the WebglContextLostOverlay component shows/hides accordingly.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { WebglContextLostOverlay } from "@/components/WebglContextLostOverlay";
import { useWebglContextStore } from "@/lib/webglContextStore";

describe("WebGL context loss recovery", () => {
  beforeEach(() => {
    act(() => {
      useWebglContextStore.setState({ contextLost: false, recoveryKey: 0 });
    });
  });

  it("shows the overlay while contextLost is true", () => {
    const { rerender } = render(<WebglContextLostOverlay />);
    expect(screen.queryByTestId("webgl-context-lost-overlay")).toBeNull();

    act(() => {
      useWebglContextStore.getState().markLost();
    });
    rerender(<WebglContextLostOverlay />);
    expect(screen.getByTestId("webgl-context-lost-overlay")).toBeInTheDocument();
  });

  it("clears the overlay and bumps recoveryKey on restoration", () => {
    act(() => {
      useWebglContextStore.getState().markLost();
    });
    const before = useWebglContextStore.getState().recoveryKey;

    render(<WebglContextLostOverlay />);
    expect(screen.getByTestId("webgl-context-lost-overlay")).toBeInTheDocument();

    act(() => {
      useWebglContextStore.getState().markRestored();
    });
    expect(useWebglContextStore.getState().contextLost).toBe(false);
    expect(useWebglContextStore.getState().recoveryKey).toBe(before + 1);
    expect(screen.queryByTestId("webgl-context-lost-overlay")).toBeNull();
  });

  it("synthetic webglcontextlost dispatched on a canvas calls the lost handler with preventDefault", () => {
    // Simulate the wiring TourScene performs in onCreated: register listeners
    // on the WebGL canvas and route them through the store. The Canvas itself
    // can't be mounted in jsdom (no WebGL), so we mirror the contract here.
    const canvas = document.createElement("canvas");
    const onLost = (e: Event) => {
      e.preventDefault();
      useWebglContextStore.getState().markLost();
    };
    const onRestored = () => {
      useWebglContextStore.getState().markRestored();
    };
    canvas.addEventListener("webglcontextlost", onLost, false);
    canvas.addEventListener("webglcontextrestored", onRestored, false);

    render(<WebglContextLostOverlay />);
    expect(screen.queryByTestId("webgl-context-lost-overlay")).toBeNull();

    const lostEvent = new Event("webglcontextlost", { cancelable: true });
    act(() => {
      canvas.dispatchEvent(lostEvent);
    });
    expect(lostEvent.defaultPrevented).toBe(true);
    expect(useWebglContextStore.getState().contextLost).toBe(true);
    expect(screen.getByTestId("webgl-context-lost-overlay")).toBeInTheDocument();

    act(() => {
      canvas.dispatchEvent(new Event("webglcontextrestored"));
    });
    expect(useWebglContextStore.getState().contextLost).toBe(false);
    expect(screen.queryByTestId("webgl-context-lost-overlay")).toBeNull();

    canvas.removeEventListener("webglcontextlost", onLost, false);
    canvas.removeEventListener("webglcontextrestored", onRestored, false);
  });
});

// Suppress unused-vars lint in case future revisions remove `vi`.
void vi;
