import { beforeEach, describe, expect, it } from "vitest";
import {
  usePanelCollapseStore,
  type PanelId,
} from "@/lib/panelCollapseStore";

const PANEL_IDS: PanelId[] = [
  "datasets",
  "zoneOverlay",
  "habitat",
  "cameraCoords",
  "keyboardShortcuts",
  "tide",
  "overlaysTools",
  "mapData",
  "conditions",
];

const DEFAULTS: Record<PanelId, boolean> = {
  datasets: false,
  zoneOverlay: false,
  habitat: false,
  cameraCoords: false,
  keyboardShortcuts: true,
  tide: false,
  overlaysTools: false,
  mapData: false,
  conditions: false,
};

async function flush() {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function simulateReload() {
  // Snapshot the persisted blob, then reset in-memory state. Because the
  // persist middleware writes through on setState, we restore the snapshot
  // before re-hydrating so rehydrate() reads the user's saved layout.
  const snapshot = localStorage.getItem("bathyscan:panel-collapse");
  usePanelCollapseStore.setState({ collapsed: { ...DEFAULTS } });
  if (snapshot !== null) {
    localStorage.setItem("bathyscan:panel-collapse", snapshot);
  } else {
    localStorage.removeItem("bathyscan:panel-collapse");
  }
  await usePanelCollapseStore.persist.rehydrate();
}

describe("panelCollapseStore persistence", () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    usePanelCollapseStore.setState({ collapsed: { ...DEFAULTS } });
  });

  it("persists a collapsed state for every section across a reload", async () => {
    const { setCollapsed } = usePanelCollapseStore.getState();
    for (const id of PANEL_IDS) setCollapsed(id, true);
    await flush();

    await simulateReload();

    const after = usePanelCollapseStore.getState().collapsed;
    for (const id of PANEL_IDS) {
      expect(after[id]).toBe(true);
    }
  });

  it("persists an expanded state for every section across a reload", async () => {
    const { setCollapsed } = usePanelCollapseStore.getState();
    for (const id of PANEL_IDS) setCollapsed(id, false);
    await flush();

    await simulateReload();

    const after = usePanelCollapseStore.getState().collapsed;
    for (const id of PANEL_IDS) {
      expect(after[id]).toBe(false);
    }
  });

  it("persists a mixed pattern of collapsed/expanded sections across a reload", async () => {
    const pattern: Record<PanelId, boolean> = {
      datasets: true,
      zoneOverlay: false,
      habitat: true,
      cameraCoords: false,
      keyboardShortcuts: false,
      tide: true,
      overlaysTools: true,
      mapData: false,
      conditions: true,
    };
    const { setCollapsed } = usePanelCollapseStore.getState();
    for (const id of PANEL_IDS) setCollapsed(id, pattern[id]);
    await flush();

    await simulateReload();

    expect(usePanelCollapseStore.getState().collapsed).toEqual(pattern);
  });

  it("toggle round-trips through localStorage on reload", async () => {
    const { toggle } = usePanelCollapseStore.getState();
    toggle("datasets");
    toggle("keyboardShortcuts");
    await flush();

    await simulateReload();

    const after = usePanelCollapseStore.getState().collapsed;
    expect(after.datasets).toBe(true);
    expect(after.keyboardShortcuts).toBe(false);
  });

  it("writes to the 'bathyscan:panel-collapse' localStorage key", async () => {
    usePanelCollapseStore.getState().setCollapsed("tide", true);
    await flush();

    const raw = localStorage.getItem("bathyscan:panel-collapse");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.collapsed.tide).toBe(true);
  });
});
