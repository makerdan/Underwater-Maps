/**
 * Settings → UNITS section — verifies the units control flips the
 * persisted store value when the user picks Imperial, and switches back
 * to Metric.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({
    user: { primaryEmailAddress: { emailAddress: "test@example.com" }, username: "test" },
    isSignedIn: true,
  }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", vi.fn()],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetSettings: () => ({ data: null }),
  usePutSettings: () => ({ mutate: vi.fn() }),
  useDeleteMarkersMine: () => ({ mutate: vi.fn(), isPending: false }),
  getGetSettingsQueryKey: () => ["/api/settings"],
  getGetMarkersQueryKey: () => ["/api/markers"],
}));

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: (sel: (s: { activeGrid: null }) => unknown) => sel({ activeGrid: null }),
}));

vi.mock("idb-keyval", () => ({
  keys: () => Promise.resolve([]),
  clear: () => Promise.resolve(),
  get: () => Promise.resolve(null),
  del: () => Promise.resolve(),
}));

import { Settings } from "@/pages/Settings";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
});

describe("Settings → UNITS section", () => {
  it("defaults to metric and switches the persisted store when imperial is picked", () => {
    render(<Settings />);
    fireEvent.click(screen.getByText("UNITS"));

    expect(useSettingsStore.getState().units).toBe("metric");

    const getUnitsSelect = () =>
      screen.getAllByRole("combobox")[0] as HTMLSelectElement;

    const select = getUnitsSelect();
    expect(select.value).toBe("metric");

    fireEvent.change(select, { target: { value: "imperial" } });
    expect(useSettingsStore.getState().units).toBe("imperial");
    expect(getUnitsSelect().value).toBe("imperial");

    fireEvent.change(getUnitsSelect(), { target: { value: "metric" } });
    expect(useSettingsStore.getState().units).toBe("metric");
    expect(getUnitsSelect().value).toBe("metric");
  });
});
