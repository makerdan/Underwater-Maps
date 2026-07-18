/**
 * useIntertidal.test.tsx — verifies the MHW/MHHW datum resolution order:
 * user override (settingsStore) → station datum (tidalStore) → null, and
 * that clearing an override falls back to the station value.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIntertidal } from "@/lib/useIntertidal";
import { useSettingsStore } from "@/lib/settingsStore";
import { useTidalStore } from "@/lib/tidalStore";

const STATION = {
  id: "9452210",
  name: "Juneau, AK",
  lat: 58.3,
  lon: -134.4,
  distanceMiles: 2.1,
};

beforeEach(() => {
  useTidalStore.setState({
    station: null,
    stationStatus: "idle",
    datums: null,
    datumsStatus: "idle",
  });
  useSettingsStore.setState({
    intertidalMhwOverrideFt: null,
    intertidalMhhwOverrideFt: null,
  });
});

describe("useIntertidal", () => {
  it("returns nulls when no station and no overrides", () => {
    const { result } = renderHook(() => useIntertidal());
    expect(result.current.mhwFt).toBeNull();
    expect(result.current.mhhwFt).toBeNull();
    expect(result.current.stationName).toBeNull();
  });

  it("uses station datums when no overrides are set", () => {
    useTidalStore.setState({
      station: STATION,
      stationStatus: "ready",
      datums: { stationId: STATION.id, mhwFt: 14.53, mhhwFt: 15.42 },
      datumsStatus: "ready",
    });
    const { result } = renderHook(() => useIntertidal());
    expect(result.current.mhwFt).toBe(14.53);
    expect(result.current.mhhwFt).toBe(15.42);
    expect(result.current.stationName).toBe("Juneau, AK");
    expect(result.current.mhwIsOverridden).toBe(false);
  });

  it("overrides win over station datums, and clearing falls back", () => {
    useTidalStore.setState({
      station: STATION,
      stationStatus: "ready",
      datums: { stationId: STATION.id, mhwFt: 14.53, mhhwFt: 15.42 },
      datumsStatus: "ready",
    });
    const { result } = renderHook(() => useIntertidal());

    act(() => {
      useSettingsStore.getState().setIntertidalMhwOverrideFt(12);
    });
    expect(result.current.mhwFt).toBe(12);
    expect(result.current.mhwIsOverridden).toBe(true);
    // Station value remains visible alongside the override.
    expect(result.current.stationMhwFt).toBe(14.53);
    // MHHW untouched.
    expect(result.current.mhhwFt).toBe(15.42);

    act(() => {
      useSettingsStore.getState().setIntertidalMhwOverrideFt(null);
    });
    expect(result.current.mhwFt).toBe(14.53);
    expect(result.current.mhwIsOverridden).toBe(false);
  });

  it("rejects non-finite override values", () => {
    act(() => {
      useSettingsStore.getState().setIntertidalMhwOverrideFt(Number.NaN);
    });
    expect(useSettingsStore.getState().intertidalMhwOverrideFt).toBeNull();
  });
});
