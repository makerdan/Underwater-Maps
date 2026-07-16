/**
 * panelCollapseStore — Advanced section key unit tests.
 *
 * Covers:
 *   - All five Advanced keys default to true (collapsed)
 *   - setCollapsed round-trip for Advanced keys
 *   - toggle flips an Advanced key and does not touch the parent key
 *   - Concurrent multi-panel states are independent
 *   - Resetting to DEFAULTS restores all Advanced keys to true
 *   - Parent panel toggle does not bleed into the Advanced sub-key
 */
import { describe, it, expect, beforeEach } from "vitest";
import { usePanelCollapseStore, DEFAULTS, type PanelId } from "@/lib/panelCollapseStore";

const ADVANCED_IDS: PanelId[] = [
  "overlaysToolsAdvanced",
  "tidePanelAdvanced",
  "currentsPanelAdvanced",
  "habitatAdvanced",
  "seafloorAdvanced",
];

function resetStore() {
  try { localStorage.clear(); } catch {}
  usePanelCollapseStore.setState({ collapsed: { ...DEFAULTS } });
}

describe("panelCollapseStore — Advanced section keys", () => {
  beforeEach(() => resetStore());

  it("all five Advanced section keys default to true (collapsed)", () => {
    const { collapsed } = usePanelCollapseStore.getState();
    for (const id of ADVANCED_IDS) {
      expect(collapsed[id], `${id} should default to collapsed`).toBe(true);
    }
  });

  it("DEFAULTS object has all five Advanced keys set to true", () => {
    for (const id of ADVANCED_IDS) {
      expect(DEFAULTS[id], `DEFAULTS.${id}`).toBe(true);
    }
  });

  it("setCollapsed can expand (false) a single Advanced key without touching others", () => {
    usePanelCollapseStore.getState().setCollapsed("overlaysToolsAdvanced", false);
    const { collapsed } = usePanelCollapseStore.getState();
    expect(collapsed.overlaysToolsAdvanced).toBe(false);
    for (const id of ADVANCED_IDS.filter((id) => id !== "overlaysToolsAdvanced")) {
      expect(collapsed[id], `${id} must remain collapsed`).toBe(true);
    }
  });

  it("setCollapsed round-trip: false → true restores the collapsed state", () => {
    const { setCollapsed } = usePanelCollapseStore.getState();
    setCollapsed("seafloorAdvanced", false);
    expect(usePanelCollapseStore.getState().collapsed.seafloorAdvanced).toBe(false);
    setCollapsed("seafloorAdvanced", true);
    expect(usePanelCollapseStore.getState().collapsed.seafloorAdvanced).toBe(true);
  });

  it("toggle flips an Advanced key from collapsed to expanded", () => {
    usePanelCollapseStore.getState().toggle("currentsPanelAdvanced");
    expect(usePanelCollapseStore.getState().collapsed.currentsPanelAdvanced).toBe(false);
  });

  it("toggle is idempotent over two calls (true → false → true)", () => {
    const { toggle } = usePanelCollapseStore.getState();
    toggle("habitatAdvanced");
    expect(usePanelCollapseStore.getState().collapsed.habitatAdvanced).toBe(false);
    toggle("habitatAdvanced");
    expect(usePanelCollapseStore.getState().collapsed.habitatAdvanced).toBe(true);
  });

  it("toggling an Advanced key does not change its parent panel key", () => {
    const parentBefore = usePanelCollapseStore.getState().collapsed.overlaysTools;
    usePanelCollapseStore.getState().toggle("overlaysToolsAdvanced");
    const parentAfter = usePanelCollapseStore.getState().collapsed.overlaysTools;
    expect(parentAfter).toBe(parentBefore);
  });

  it("toggling a parent panel key does not change the Advanced sub-key", () => {
    const advBefore = usePanelCollapseStore.getState().collapsed.tidePanelAdvanced;
    usePanelCollapseStore.getState().toggle("tide");
    const advAfter = usePanelCollapseStore.getState().collapsed.tidePanelAdvanced;
    expect(advAfter).toBe(advBefore);
  });

  it("multiple Advanced keys can be expanded simultaneously and are independent", () => {
    const { setCollapsed } = usePanelCollapseStore.getState();
    setCollapsed("overlaysToolsAdvanced", false);
    setCollapsed("tidePanelAdvanced", false);
    setCollapsed("habitatAdvanced", false);
    const { collapsed } = usePanelCollapseStore.getState();
    expect(collapsed.overlaysToolsAdvanced).toBe(false);
    expect(collapsed.tidePanelAdvanced).toBe(false);
    expect(collapsed.habitatAdvanced).toBe(false);
    expect(collapsed.currentsPanelAdvanced).toBe(true);
    expect(collapsed.seafloorAdvanced).toBe(true);
  });

  it("setState with DEFAULTS restores all Advanced keys to their initial collapsed=true values", () => {
    const { setCollapsed } = usePanelCollapseStore.getState();
    for (const id of ADVANCED_IDS) {
      setCollapsed(id, false);
    }
    usePanelCollapseStore.setState({ collapsed: { ...DEFAULTS } });
    const { collapsed } = usePanelCollapseStore.getState();
    for (const id of ADVANCED_IDS) {
      expect(collapsed[id], `${id} should be restored to true`).toBe(true);
    }
  });

  it("expanding all Advanced keys does not alter any parent panel key", () => {
    const parentsBefore = {
      overlaysTools: usePanelCollapseStore.getState().collapsed.overlaysTools,
      tide: usePanelCollapseStore.getState().collapsed.tide,
      habitat: usePanelCollapseStore.getState().collapsed.habitat,
      seafloorClassification: usePanelCollapseStore.getState().collapsed.seafloorClassification,
    };
    const { setCollapsed } = usePanelCollapseStore.getState();
    for (const id of ADVANCED_IDS) {
      setCollapsed(id, false);
    }
    const { collapsed } = usePanelCollapseStore.getState();
    expect(collapsed.overlaysTools).toBe(parentsBefore.overlaysTools);
    expect(collapsed.tide).toBe(parentsBefore.tide);
    expect(collapsed.habitat).toBe(parentsBefore.habitat);
    expect(collapsed.seafloorClassification).toBe(parentsBefore.seafloorClassification);
  });
});
