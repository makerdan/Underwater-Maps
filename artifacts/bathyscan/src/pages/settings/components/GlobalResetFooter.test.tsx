import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { GlobalResetFooter } from "./GlobalResetFooter";
import { DEFAULT_SETTINGS, useSettingsStore } from "@/lib/settingsStore";

beforeEach(() => {
  vi.useFakeTimers();
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
    mouseSensitivity: 1,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GlobalResetFooter", () => {
  it("confirms a reset and shows the reset flash", () => {
    useSettingsStore.getState().setMouseSensitivity(2.5);
    render(<GlobalResetFooter />);

    fireEvent.click(screen.getByTestId("reset-all-btn"));
    expect(screen.getByRole("group", { name: "Confirm reset" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-reset-all-btn"));

    expect(useSettingsStore.getState().mouseSensitivity).toBe(DEFAULT_SETTINGS.mouseSensitivity);
    expect(screen.getByTestId("reset-flash")).toHaveTextContent("✓ Settings reset");
    expect(screen.getByTestId("undo-reset-btn")).toBeInTheDocument();
  });

  it("cancels confirmation when Escape is pressed", () => {
    render(<GlobalResetFooter />);

    fireEvent.click(screen.getByTestId("reset-all-btn"));
    expect(screen.getByRole("group", { name: "Confirm reset" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("group", { name: "Confirm reset" })).not.toBeInTheDocument();
    expect(screen.getByTestId("reset-all-btn")).toBeInTheDocument();
  });

  it("undoes the reset using the pre-reset settings snapshot", () => {
    useSettingsStore.getState().setMouseSensitivity(2.5);
    render(<GlobalResetFooter />);

    fireEvent.click(screen.getByTestId("reset-all-btn"));
    fireEvent.click(screen.getByTestId("confirm-reset-all-btn"));
    expect(useSettingsStore.getState().mouseSensitivity).toBe(1);

    fireEvent.click(screen.getByTestId("undo-reset-btn"));

    expect(useSettingsStore.getState().mouseSensitivity).toBe(2.5);
    expect(screen.queryByTestId("reset-flash")).not.toBeInTheDocument();
  });

  it("hides the reset flash after two seconds", () => {
    render(<GlobalResetFooter />);
    fireEvent.click(screen.getByTestId("reset-all-btn"));
    fireEvent.click(screen.getByTestId("confirm-reset-all-btn"));

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByTestId("reset-flash")).not.toBeInTheDocument();
    expect(screen.getByTestId("reset-all-btn")).toBeInTheDocument();
  });
});