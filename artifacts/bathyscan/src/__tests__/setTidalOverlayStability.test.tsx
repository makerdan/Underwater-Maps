/**
 * Confirms that `setTidalOverlay` from AppProvider is referentially stable
 * across re-renders caused by unrelated state changes.
 *
 * Before the fix, `setTidalOverlay` was a plain function created inside the
 * render body of AppProvider, giving it a new reference on every render.
 * Because the useEffects in App.tsx list `setTidalOverlay` in their dep
 * arrays, any re-render of AppProvider (e.g. when `terrain` or `tidalOverlay`
 * changes) would spuriously re-fire those effects.
 *
 * After the fix (useCallback with []), the reference is stable for the
 * lifetime of the AppProvider instance.
 */
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { AppProvider, useAppState } from "@/lib/context";

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(AppProvider, null, children);

describe("AppProvider — setTidalOverlay stability", () => {
  it("setTidalOverlay reference is the same before and after an unrelated setDatasetId call", () => {
    const { result } = renderHook(() => {
      const { setTidalOverlay, setDatasetId } = useAppState();
      return { setTidalOverlay, setDatasetId };
    }, { wrapper });

    const ref1 = result.current.setTidalOverlay;

    act(() => {
      result.current.setDatasetId("some-dataset");
    });

    const ref2 = result.current.setTidalOverlay;
    expect(ref2).toBe(ref1);
  });

  it("setTidalOverlay reference is the same after calling setTidalOverlay itself (triggering re-render)", () => {
    const { result } = renderHook(() => {
      const { setTidalOverlay, tidalOverlay } = useAppState();
      return { setTidalOverlay, tidalOverlay };
    }, { wrapper });

    const ref1 = result.current.setTidalOverlay;
    expect(result.current.tidalOverlay).toBe(false);

    act(() => {
      result.current.setTidalOverlay(true);
    });

    expect(result.current.tidalOverlay).toBe(true);
    const ref2 = result.current.setTidalOverlay;
    expect(ref2).toBe(ref1);
  });

  it("setRealisticMode reference is stable across unrelated re-renders", () => {
    const { result } = renderHook(() => {
      const { setRealisticMode, setDatasetId } = useAppState();
      return { setRealisticMode, setDatasetId };
    }, { wrapper });

    const ref1 = result.current.setRealisticMode;

    act(() => {
      result.current.setDatasetId("another-dataset");
    });

    expect(result.current.setRealisticMode).toBe(ref1);
  });
});
