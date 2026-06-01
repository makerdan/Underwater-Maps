import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false, refetch: noop }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetDatasets: () => ({ data: [] }),
  }),
);

import { HUD } from "@/components/HUD";
import { useCameraStore } from "@/lib/cameraStore";

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    terrain: null,
  }),
}));

vi.mock("@/hooks/useSurfaceTemperature", () => ({
  useSurfaceTemperature: () => ({ anchor: null, loading: false, error: false }),
}));

vi.mock("@/hooks/useTemperatureProfile", () => ({
  useTemperatureProfile: () => ({ profile: null, loading: false, error: false }),
}));

vi.mock("@/lib/gpsStore", () => ({
  useGpsStore: (sel: (s: { active: boolean; position: null }) => unknown) =>
    sel({ active: false, position: null }),
}));

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: (sel: (s: { overviewGrid: null }) => unknown) =>
    sel({ overviewGrid: null }),
}));

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) =>
    sel({ isOnline: true }),
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal();
  const storeState = {
    showCrosshairGps: true,
    showCameraPosition: true,
    showHeading: true,
    coordinateFormat: "decimal" as const,
    depthUnit: "metres" as const,
    units: "metric" as const,
    hudOpacity: 1,
  };
  const useSettingsStore = Object.assign(
    (sel: (s: typeof storeState) => unknown) => sel(storeState),
    {
      getState: () => storeState,
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );
  return { ...actual, useSettingsStore };
});

describe("HUD", () => {
  beforeEach(() => {
    useCameraStore.setState({
      crosshairGps: null,
      lastClickedGps: null,
      cameraLon: null,
      cameraLat: null,
      cameraDepth: null,
      heading: 0,
      speedIndex: 0,
    });
  });

  it("no longer renders the FLY / ORBIT mode badge", () => {
    render(<HUD />);
    expect(screen.queryByText(/● FLY/)).not.toBeInTheDocument();
    expect(screen.queryByText(/◎ ORBIT/)).not.toBeInTheDocument();
  });

  it("no longer renders the SPD speed indicator panel", () => {
    useCameraStore.setState({ speedIndex: 2 });
    const { container } = render(<HUD />);
    expect(container.textContent ?? "").not.toMatch(/\bSPD\b/);
    const dots = Array.from(container.querySelectorAll("span"))
      .map((s) => s.textContent ?? "")
      .filter((t) => t === "●" || t === "○");
    expect(dots.length).toBe(0);
  });

  it("renders the heading value", () => {
    useCameraStore.setState({ heading: 87 });
    render(<HUD />);
    expect(screen.getByText("087°")).toBeInTheDocument();
  });
});
