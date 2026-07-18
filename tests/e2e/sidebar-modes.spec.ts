import { test, expect } from "./fixtures";

/**
 * Sidebar panel modes — regression hardening.
 *
 * Covers mode switching, state preservation across mode changes,
 * the M keyboard shortcut, sidebar collapse interaction, panel
 * visibility rules, and session restore after reload.
 *
 * These tests rely on localStorage injection (via addInitScript) to
 * set the starting store state before navigation, following the same
 * pattern used in conditions-overlays.spec.ts. The auth-bypass flag
 * ensures all Clerk-gated routes are accessible.
 */

/** Patch one or more fields into the persisted bathyscan settings blob. */
function injectSettings(
  page: Parameters<typeof test.beforeEach>[0]["page"],
  patch: Record<string, unknown>,
): void {
  page.addInitScript((p) => {
    const guard = "__sidebarModeInjected";
    if (sessionStorage.getItem(guard)) return;
    sessionStorage.setItem(guard, "1");
    try {
      const raw = localStorage.getItem("bathyscan:settings");
      const blob = raw
        ? (JSON.parse(raw) as { state?: Record<string, unknown> })
        : {};
      blob.state = { ...(blob.state ?? {}), ...p };
      localStorage.setItem("bathyscan:settings", JSON.stringify(blob));
    } catch {}
  }, patch);
}

/** Patch one or more collapse keys into panelCollapseStore. */
function injectPanelCollapse(
  page: Parameters<typeof test.beforeEach>[0]["page"],
  collapsed: Record<string, boolean>,
): void {
  page.addInitScript((c) => {
    const guard = "__panelCollapseInjected";
    if (sessionStorage.getItem(guard)) return;
    sessionStorage.setItem(guard, "1");
    try {
      const raw = localStorage.getItem("bathyscan:panel-collapse");
      const blob = raw
        ? (JSON.parse(raw) as { state?: { collapsed?: Record<string, boolean> } })
        : {};
      blob.state = blob.state ?? {};
      blob.state.collapsed = { ...(blob.state.collapsed ?? {}), ...c };
      localStorage.setItem(
        "bathyscan:panel-collapse",
        JSON.stringify(blob),
      );
    } catch {}
  }, collapsed);
}

/** Read sidebarMode from the store via the page's Zustand state. */
async function getSidebarMode(page: Parameters<typeof test.beforeEach>[0]["page"]): Promise<string> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("bathyscan:settings");
    if (!raw) return "explore";
    const blob = JSON.parse(raw) as { state?: { sidebarMode?: string } };
    return blob.state?.sidebarMode ?? "explore";
  });
}

// ── Baseline state for every test ────────────────────────────────────────────
// hasSeenOnboarding=true prevents the tour from rendering over the app.
// sidePaneCollapsed=false ensures the sidebar is open.
// sidebarMode='explore' sets a known starting mode.
const BASE = {
  hasSeenOnboarding: true,
  sidePaneCollapsed: false,
  sidebarMode: "explore",
  llmDisclosureAcknowledged: true,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function waitForSidebarTabs(page: Parameters<typeof test.beforeEach>[0]["page"]) {
  await expect(
    page.locator('[data-testid="sidebar-mode-tabs"]'),
  ).toBeVisible({ timeout: 12_000 });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("overlay toggle state is preserved across mode switches", async ({ page }) => {
  injectSettings(page, {
    ...BASE,
    windOverlayActive: true,
  });

  await page.goto("/");
  await waitForSidebarTabs(page);

  const exploreTab = page.locator('[data-testid="sidebar-mode-tab-explore"]');
  const planTab = page.locator('[data-testid="sidebar-mode-tab-plan"]');

  await expect(exploreTab).toHaveAttribute("aria-pressed", "true");

  // Switch to Plan mode
  await planTab.click();
  await expect(planTab).toHaveAttribute("aria-pressed", "true");

  // Switch back to Explore
  await exploreTab.click();
  await expect(exploreTab).toHaveAttribute("aria-pressed", "true");

  // windOverlayActive must still be true in the persisted settings
  const windActive = await page.evaluate(() => {
    const raw = localStorage.getItem("bathyscan:settings");
    const blob = JSON.parse(raw ?? "{}") as { state?: { windOverlayActive?: boolean } };
    return blob.state?.windOverlayActive;
  });
  expect(windActive).toBe(true);
});

test("panel collapse state is preserved across mode switches", async ({ page }) => {
  injectSettings(page, BASE);
  // Mark the 'conditions' panel as collapsed
  injectPanelCollapse(page, { conditions: true });

  await page.goto("/");
  await waitForSidebarTabs(page);

  const planTab = page.locator('[data-testid="sidebar-mode-tab-plan"]');
  const exploreTab = page.locator('[data-testid="sidebar-mode-tab-explore"]');

  // Switch to Plan and back
  await planTab.click();
  await expect(planTab).toHaveAttribute("aria-pressed", "true");
  await exploreTab.click();
  await expect(exploreTab).toHaveAttribute("aria-pressed", "true");

  // The persisted collapse state for 'conditions' must still be true
  const stillCollapsed = await page.evaluate(() => {
    const raw = localStorage.getItem("bathyscan:panel-collapse");
    const blob = JSON.parse(raw ?? "{}") as {
      state?: { collapsed?: { conditions?: boolean } };
    };
    return blob.state?.collapsed?.conditions;
  });
  expect(stillCollapsed).toBe(true);
});

test("M key cycles through all four modes in order", async ({ page, context }) => {
  // Cycling passes through Live mode, which starts a GPS watch — grant the
  // permission and mock a position so the transition is side-effect free.
  await context.grantPermissions(["geolocation"]).catch(() => {});
  await context.setGeolocation({ latitude: 11.3733, longitude: 142.1951, accuracy: 8 });

  injectSettings(page, BASE);
  await page.goto("/");
  await waitForSidebarTabs(page);

  // Click the canvas area to ensure the keydown listener is active
  await page.locator("body").click();

  const exploreTab = page.locator('[data-testid="sidebar-mode-tab-explore"]');
  const planTab = page.locator('[data-testid="sidebar-mode-tab-plan"]');
  const analyzeTab = page.locator('[data-testid="sidebar-mode-tab-analyze"]');
  const liveTab = page.locator('[data-testid="sidebar-mode-tab-live"]');

  // Starting in explore mode
  await expect(exploreTab).toHaveAttribute("aria-pressed", "true");

  // M → plan
  await page.keyboard.press("m");
  await expect(planTab).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });

  // M → analyze
  await page.keyboard.press("m");
  await expect(analyzeTab).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });

  // M → live
  await page.keyboard.press("m");
  await expect(liveTab).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });

  // M → explore (wraps)
  await page.keyboard.press("m");
  await expect(exploreTab).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
});

test("M key does not fire when cursor is in the AI assistant text input", async ({ page }) => {
  injectSettings(page, BASE);
  await page.goto("/");
  await waitForSidebarTabs(page);

  // Start in explore, advance to plan via M so we have a known state
  await page.locator("body").click();
  await page.keyboard.press("m");

  const planTab = page.locator('[data-testid="sidebar-mode-tab-plan"]');
  await expect(planTab).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });

  // Open the AI query panel (trigger is always in the DOM)
  const queryTrigger = page.locator('[data-testid="query-panel-trigger"]');
  await expect(queryTrigger).toBeVisible({ timeout: 8_000 });
  await queryTrigger.click();

  // The query input should now be present
  const queryInput = page.locator('[data-testid="query-input"]');
  await expect(queryInput).toBeVisible({ timeout: 8_000 });

  // Focus the input and press M — this should be suppressed
  await queryInput.focus();
  await page.keyboard.press("m");

  // Mode should still be plan (not advanced to analyze)
  await expect(planTab).toHaveAttribute("aria-pressed", "true");
});

test("collapsing the sidebar hides mode tabs and panel content; expanding shows them", async ({ page }) => {
  injectSettings(page, BASE);
  await page.goto("/");
  await waitForSidebarTabs(page);

  const modeTabs = page.locator('[data-testid="sidebar-mode-tabs"]');
  await expect(modeTabs).toBeVisible();

  // Collapse the sidebar via the "Hide" button
  const hideBtn = page.getByRole("button", { name: "Hide side pane" });
  await expect(hideBtn).toBeVisible({ timeout: 8_000 });
  await hideBtn.click();

  // Mode tabs must not be visible when pane is collapsed
  await expect(modeTabs).not.toBeVisible({ timeout: 5_000 });

  // The "show" button must appear
  const showBtn = page.getByRole("button", { name: "Show side pane" });
  await expect(showBtn).toBeVisible({ timeout: 5_000 });

  // Expand the sidebar
  await showBtn.click();

  // Mode tabs must be visible again
  await expect(modeTabs).toBeVisible({ timeout: 5_000 });
});

test("sidebar-section-habitat is only visible in Analyze mode", async ({ page }) => {
  injectSettings(page, { ...BASE, sidebarMode: "explore" });
  await page.goto("/");
  await waitForSidebarTabs(page);

  const habitatSection = page.locator('[data-testid="sidebar-section-habitat"]');
  const planTab = page.locator('[data-testid="sidebar-mode-tab-plan"]');
  const analyzeTab = page.locator('[data-testid="sidebar-mode-tab-analyze"]');

  // In Explore mode: habitat section must not be visible (parent div is display:none)
  await expect(habitatSection).not.toBeVisible();

  // Switch to Plan mode: habitat section still not visible
  await planTab.click();
  await expect(planTab).toHaveAttribute("aria-pressed", "true");
  await expect(habitatSection).not.toBeVisible();

  // Switch to Analyze mode: analyze pane is visible (habitat section or empty state)
  await analyzeTab.click();
  await expect(analyzeTab).toHaveAttribute("aria-pressed", "true");
  // The analyze pane is now displayed. habitat section will be visible if terrain
  // is loaded, otherwise the empty state shows. Either way, the analyze-mode
  // container is no longer hidden — verified by the mode tab aria-pressed.
  // Habitat section itself is visible only when terrain is present:
  const hasHabitat = await habitatSection.isVisible();
  const hasEmptyState = await page.locator('[data-testid="analyze-empty-state"]').isVisible();
  expect(hasHabitat || hasEmptyState).toBe(true);
});

test("sidebar-section-mapData is only visible in Explore mode", async ({ page }) => {
  injectSettings(page, { ...BASE, sidebarMode: "explore" });
  await page.goto("/");
  await waitForSidebarTabs(page);

  const mapDataSection = page.locator('[data-testid="sidebar-section-mapData"]');
  const planTab = page.locator('[data-testid="sidebar-mode-tab-plan"]');
  const analyzeTab = page.locator('[data-testid="sidebar-mode-tab-analyze"]');
  const exploreTab = page.locator('[data-testid="sidebar-mode-tab-explore"]');

  // In Explore mode: mapData section must be visible (or its empty state covers it)
  // The section is always in the DOM in explore mode.
  const mapDataOrEmptyVisible =
    (await mapDataSection.isVisible()) ||
    (await page.locator('[data-testid="explore-empty-state"]').isVisible());
  expect(mapDataOrEmptyVisible).toBe(true);

  // Switch to Plan mode: mapData must NOT be visible (explore div is display:none)
  await planTab.click();
  await expect(planTab).toHaveAttribute("aria-pressed", "true");
  await expect(mapDataSection).not.toBeVisible();

  // Switch to Analyze mode: mapData must NOT be visible
  await analyzeTab.click();
  await expect(analyzeTab).toHaveAttribute("aria-pressed", "true");
  await expect(mapDataSection).not.toBeVisible();

  // Switch back to Explore: mapData visible again
  await exploreTab.click();
  await expect(exploreTab).toHaveAttribute("aria-pressed", "true");
  // mapData section or the explore empty state must be visible
  const visibleAfterReturn =
    (await mapDataSection.isVisible()) ||
    (await page.locator('[data-testid="explore-empty-state"]').isVisible());
  expect(visibleAfterReturn).toBe(true);
});

test("page reload restores the previously active sidebar mode", async ({ page }) => {
  injectSettings(page, { ...BASE, sidebarMode: "explore" });
  await page.goto("/");
  await waitForSidebarTabs(page);

  const planTab = page.locator('[data-testid="sidebar-mode-tab-plan"]');
  const analyzeTab = page.locator('[data-testid="sidebar-mode-tab-analyze"]');

  // Switch to Plan mode
  await planTab.click();
  await expect(planTab).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });

  // Reload — settingsStore persist should restore 'plan'
  await page.reload();
  await waitForSidebarTabs(page);
  await expect(planTab).toHaveAttribute("aria-pressed", "true", { timeout: 8_000 });

  // Switch to Analyze, reload, confirm
  await analyzeTab.click();
  await expect(analyzeTab).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
  await page.reload();
  await waitForSidebarTabs(page);
  await expect(analyzeTab).toHaveAttribute("aria-pressed", "true", { timeout: 8_000 });

  // Switch back to Explore, reload, confirm
  const exploreTab = page.locator('[data-testid="sidebar-mode-tab-explore"]');
  await exploreTab.click();
  await expect(exploreTab).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
  await page.reload();
  await waitForSidebarTabs(page);
  await expect(exploreTab).toHaveAttribute("aria-pressed", "true", { timeout: 8_000 });
});
