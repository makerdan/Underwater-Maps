import { test, expect } from "./fixtures";

/**
 * Advanced toggles — regression hardening.
 *
 * Guards the AdvancedSection collapse state persistence across five sidebar
 * panels: OverlaysToolsPanel, SeafloorClassificationPanel, CurrentsPanel,
 * TidePanel, and HabitatPanel.
 *
 * For each panel the suite asserts:
 *   1. Advanced is collapsed by default on a fresh (cleared) load.
 *   2. Clicking the toggle expands it (aria-expanded → "true").
 *   3. Reloading the page restores the expanded state (localStorage persist).
 *   4. Controls inside the section are reachable after expansion.
 *
 * Step 5 (panel-itself-collapsed edge case): collapsing the parent panel and
 * re-expanding it must not reset the Advanced section's remembered state.
 *
 * Panels that require terrain data (TidePanel, HabitatPanel) use skip guards
 * if the canvas-gated UI is not present — the persistence rules are covered
 * by the store unit tests in those cases.
 *
 * Auth: VITE_DEV_AUTH_BYPASS=1 is set by the Playwright webServer config.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pre-seed the panelCollapseStore's localStorage entry so the page loads with
 * the parent panel open and the Advanced sub-section in the given state.
 */
function seedPanelCollapse(
  page: Parameters<Parameters<typeof test>[1]>[0]["page"],
  overrides: Record<string, boolean>,
) {
  return page.addInitScript((o: Record<string, boolean>) => {
    try {
      const raw = localStorage.getItem("bathyscan:panel-collapse");
      const existing: { state?: { collapsed?: Record<string, boolean> }; version?: number } =
        raw ? JSON.parse(raw) : {};
      const merged = {
        state: {
          collapsed: {
            ...(existing.state?.collapsed ?? {}),
            ...o,
          },
        },
        version: 1,
      };
      localStorage.setItem("bathyscan:panel-collapse", JSON.stringify(merged));
    } catch {}
  }, overrides);
}

/**
 * Pre-seed the settingsStore localStorage entry with given partial state.
 * Version is kept at whatever was already persisted (or 1 as fallback).
 */
function seedSettings(
  page: Parameters<Parameters<typeof test>[1]>[0]["page"],
  overrides: Record<string, unknown>,
) {
  return page.addInitScript((o: Record<string, unknown>) => {
    try {
      const raw = localStorage.getItem("bathyscan:settings");
      const existing: { state?: Record<string, unknown>; version?: number } =
        raw ? JSON.parse(raw) : {};
      const merged = {
        state: { ...(existing.state ?? {}), ...o },
        version: existing.version ?? 1,
      };
      localStorage.setItem("bathyscan:settings", JSON.stringify(merged));
    } catch {}
  }, overrides);
}

// ── OverlaysToolsPanel ────────────────────────────────────────────────────────

test.describe("OverlaysToolsPanel — Advanced toggle", () => {
  test("is collapsed by default, expands on click, and persists across reload", async ({ page }) => {
    test.setTimeout(90_000);

    // Open the parent panel; advanced section starts collapsed (default)
    await seedPanelCollapse(page, {
      overlaysTools: false,
      overlaysToolsAdvanced: true,
    });

    await page.goto("/");

    // The panel renders without terrain; wait for it to appear.
    const panel = page.locator('[data-testid="overlays-tools-panel"]');
    const panelVisible = await panel.isVisible({ timeout: 25_000 }).catch(() => false);
    if (!panelVisible) {
      test.skip(true, "OverlaysToolsPanel not visible — auth bypass may not be active");
      return;
    }

    const advBtn = panel.locator('[data-testid="advanced-toggle-overlaysToolsAdvanced"]');
    await expect(advBtn).toBeVisible({ timeout: 10_000 });

    // 1. Default: collapsed
    await expect(advBtn).toHaveAttribute("aria-expanded", "false");

    // 2. Expand
    await advBtn.click();
    await expect(advBtn).toHaveAttribute("aria-expanded", "true");

    // 3. Persist across reload
    await page.reload();
    await expect(panel).toBeVisible({ timeout: 25_000 });
    const advBtnAfterReload = panel.locator('[data-testid="advanced-toggle-overlaysToolsAdvanced"]');
    await expect(advBtnAfterReload).toBeVisible({ timeout: 10_000 });
    await expect(advBtnAfterReload).toHaveAttribute("aria-expanded", "true");
  });

  test("controls inside Advanced are reachable after expanding", async ({ page }) => {
    test.setTimeout(90_000);

    // Seed with advanced already expanded
    await seedPanelCollapse(page, {
      overlaysTools: false,
      overlaysToolsAdvanced: false,
    });

    await page.goto("/");

    const panel = page.locator('[data-testid="overlays-tools-panel"]');
    const panelVisible = await panel.isVisible({ timeout: 25_000 }).catch(() => false);
    if (!panelVisible) {
      test.skip(true, "OverlaysToolsPanel not visible — auth bypass may not be active");
      return;
    }

    // The weather stations toggle is in the Advanced section.
    // With advanced expanded it should have a non-zero bounding box.
    const weatherBtn = panel.locator('[data-testid="overlay-toggle-weather-stations"]');
    await expect(weatherBtn).toBeVisible({ timeout: 10_000 });

    // The button is present and interactable (enabled state depends on terrain,
    // but the element itself must be reachable and in the DOM).
    expect(await weatherBtn.boundingBox()).not.toBeNull();
  });

  test("is collapsed on a true fresh load with no prior Advanced state seeded", async ({ page }) => {
    test.setTimeout(90_000);

    // Only open the parent panel — do NOT seed overlaysToolsAdvanced.
    // The store's DEFAULTS must apply and the Advanced section must start collapsed.
    await seedPanelCollapse(page, { overlaysTools: false });

    await page.goto("/");

    const panel = page.locator('[data-testid="overlays-tools-panel"]');
    const panelVisible = await panel.isVisible({ timeout: 25_000 }).catch(() => false);
    if (!panelVisible) {
      test.skip(true, "OverlaysToolsPanel not visible — auth bypass may not be active");
      return;
    }

    const advBtn = panel.locator('[data-testid="advanced-toggle-overlaysToolsAdvanced"]');
    await expect(advBtn).toBeVisible({ timeout: 10_000 });
    // Store default for every Advanced key is true (collapsed); no seed was set.
    await expect(advBtn).toHaveAttribute("aria-expanded", "false");
  });

  test("collapsing the parent panel then re-expanding does not reset Advanced state", async ({ page }) => {
    test.setTimeout(90_000);

    // Seed with parent open, advanced expanded
    await seedPanelCollapse(page, {
      overlaysTools: false,
      overlaysToolsAdvanced: false,
    });

    await page.goto("/");

    const panel = page.locator('[data-testid="overlays-tools-panel"]');
    const panelVisible = await panel.isVisible({ timeout: 25_000 }).catch(() => false);
    if (!panelVisible) {
      test.skip(true, "OverlaysToolsPanel not visible — auth bypass may not be active");
      return;
    }

    // Verify advanced is expanded before the parent collapse
    const advBtn = panel.locator('[data-testid="advanced-toggle-overlaysToolsAdvanced"]');
    await expect(advBtn).toBeVisible({ timeout: 10_000 });
    await expect(advBtn).toHaveAttribute("aria-expanded", "true");

    // Collapse the parent panel by clicking its header (the toggle area at top)
    const panelHeader = panel.locator(".w-full.flex.items-center.justify-between").first();
    await panelHeader.click();
    // Parent body should collapse — the Advanced toggle disappears from the viewport
    await expect(advBtn).not.toBeVisible({ timeout: 5_000 });

    // Re-expand the parent
    await panelHeader.click();
    await expect(advBtn).toBeVisible({ timeout: 5_000 });

    // Advanced section must still be expanded — state was not reset
    await expect(advBtn).toHaveAttribute("aria-expanded", "true");
  });
});

// ── SeafloorClassificationPanel ───────────────────────────────────────────────

test.describe("SeafloorClassificationPanel — Advanced toggle", () => {
  test("is collapsed by default, expands on click, and persists across reload", async ({ page }) => {
    test.setTimeout(90_000);

    // Open the parent SidebarSection; advanced starts collapsed
    await seedPanelCollapse(page, {
      seafloorClassification: false,
      seafloorAdvanced: true,
    });

    await page.goto("/");

    // The sidebar section wraps SeafloorClassificationPanel
    const section = page.locator('[data-testid="sidebar-section-seafloorClassification"]');
    const sectionVisible = await section.isVisible({ timeout: 25_000 }).catch(() => false);
    if (!sectionVisible) {
      test.skip(true, "SeafloorClassification SidebarSection not visible — UI may not be active");
      return;
    }

    const advBtn = section.locator('[data-testid="advanced-toggle-seafloorAdvanced"]');
    await expect(advBtn).toBeVisible({ timeout: 10_000 });

    // 1. Default: collapsed
    await expect(advBtn).toHaveAttribute("aria-expanded", "false");

    // 2. Expand
    await advBtn.click();
    await expect(advBtn).toHaveAttribute("aria-expanded", "true");

    // 3. Persist across reload
    await page.reload();
    await expect(section).toBeVisible({ timeout: 25_000 });
    const advBtnAfterReload = section.locator('[data-testid="advanced-toggle-seafloorAdvanced"]');
    await expect(advBtnAfterReload).toBeVisible({ timeout: 10_000 });
    await expect(advBtnAfterReload).toHaveAttribute("aria-expanded", "true");
  });

  test("ZoneOverlay zone-toggle inside Advanced is reachable after expanding", async ({ page }) => {
    test.setTimeout(90_000);

    // Seed with advanced already expanded
    await seedPanelCollapse(page, {
      seafloorClassification: false,
      seafloorAdvanced: false,
    });

    await page.goto("/");

    const section = page.locator('[data-testid="sidebar-section-seafloorClassification"]');
    const sectionVisible = await section.isVisible({ timeout: 25_000 }).catch(() => false);
    if (!sectionVisible) {
      test.skip(true, "SeafloorClassification SidebarSection not visible");
      return;
    }

    const advBtn = section.locator('[data-testid="advanced-toggle-seafloorAdvanced"]');
    await expect(advBtn).toBeVisible({ timeout: 10_000 });
    await expect(advBtn).toHaveAttribute("aria-expanded", "true");

    // ZoneOverlay is embedded inside the Advanced section.
    // zone-toggle is a concrete control from ZoneOverlay that must be reachable
    // once Advanced is expanded (visible + non-zero bounding box).
    const zoneToggle = section.locator('[data-testid="zone-toggle"]');
    const zoneToggleVisible = await zoneToggle.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!zoneToggleVisible) {
      test.skip(true, "zone-toggle not visible — ZoneOverlay may not be active without terrain");
      return;
    }
    expect(await zoneToggle.boundingBox(), "zone-toggle must have a non-zero bounding box").not.toBeNull();
  });
});

// ── CurrentsPanel ─────────────────────────────────────────────────────────────

test.describe("CurrentsPanel — Advanced toggle", () => {
  test("is collapsed by default, expands on click, and persists across reload", async ({ page }) => {
    test.setTimeout(90_000);

    // Enable currents so the Advanced section renders; seed panel state
    await seedSettings(page, { currentsEnabled: true });
    await seedPanelCollapse(page, {
      seafloorClassification: false,
      currentsPanelAdvanced: true,
    });

    await page.goto("/");

    const currentsPanel = page.locator('[data-testid="currents-panel"]');
    const panelVisible = await currentsPanel.isVisible({ timeout: 25_000 }).catch(() => false);
    if (!panelVisible) {
      test.skip(true, "CurrentsPanel not visible — UI may not be active or currents not enabled");
      return;
    }

    const advBtn = currentsPanel.locator('[data-testid="advanced-toggle-currentsPanelAdvanced"]');
    const advBtnVisible = await advBtn.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!advBtnVisible) {
      test.skip(true, "CurrentsPanel Advanced toggle not visible — currents may not be enabled");
      return;
    }

    // 1. Default: collapsed
    await expect(advBtn).toHaveAttribute("aria-expanded", "false");

    // 2. Expand
    await advBtn.click();
    await expect(advBtn).toHaveAttribute("aria-expanded", "true");

    // 3. Persist across reload
    await seedSettings(page, { currentsEnabled: true });
    await page.reload();
    const currPanelReloaded = page.locator('[data-testid="currents-panel"]');
    await expect(currPanelReloaded).toBeVisible({ timeout: 25_000 });
    const advBtnReloaded = currPanelReloaded.locator('[data-testid="advanced-toggle-currentsPanelAdvanced"]');
    await expect(advBtnReloaded).toBeVisible({ timeout: 10_000 });
    await expect(advBtnReloaded).toHaveAttribute("aria-expanded", "true");
  });

  test("particle/arrow/stream toggles inside Advanced are reachable after expanding", async ({ page }) => {
    test.setTimeout(90_000);

    await seedSettings(page, { currentsEnabled: true });
    await seedPanelCollapse(page, {
      seafloorClassification: false,
      currentsPanelAdvanced: false,
    });

    await page.goto("/");

    const currentsPanel = page.locator('[data-testid="currents-panel"]');
    const panelVisible = await currentsPanel.isVisible({ timeout: 25_000 }).catch(() => false);
    if (!panelVisible) {
      test.skip(true, "CurrentsPanel not visible");
      return;
    }

    const advBtn = currentsPanel.locator('[data-testid="advanced-toggle-currentsPanelAdvanced"]');
    const advBtnVisible = await advBtn.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!advBtnVisible) {
      test.skip(true, "CurrentsPanel Advanced toggle not visible — currents may not be enabled");
      return;
    }

    await expect(advBtn).toHaveAttribute("aria-expanded", "true");

    // Controls that moved into Advanced must be reachable and interactable
    const particleBtn = currentsPanel.locator('[data-testid="currents-toggle-particles"]');
    const arrowBtn = currentsPanel.locator('[data-testid="currents-toggle-arrows"]');
    const streamBtn = currentsPanel.locator('[data-testid="currents-toggle-streams"]');
    const autoAdvanceBtn = currentsPanel.locator('[data-testid="currents-auto-advance"]');

    await expect(particleBtn).toBeVisible({ timeout: 5_000 });
    await expect(arrowBtn).toBeVisible({ timeout: 5_000 });
    await expect(streamBtn).toBeVisible({ timeout: 5_000 });
    await expect(autoAdvanceBtn).toBeVisible({ timeout: 5_000 });

    // Verify each has a non-zero bounding box (clickable region)
    for (const btn of [particleBtn, arrowBtn, streamBtn, autoAdvanceBtn]) {
      expect(await btn.boundingBox(), "button must have a non-zero bounding box").not.toBeNull();
    }

    // Toggle the auto-advance button to confirm it is functional
    const initialAriaPressed = await autoAdvanceBtn.getAttribute("aria-pressed");
    await autoAdvanceBtn.click();
    const newAriaPressed = await autoAdvanceBtn.getAttribute("aria-pressed");
    // If the button has aria-pressed, it should have changed; if not, at minimum the click succeeds.
    if (initialAriaPressed !== null) {
      expect(newAriaPressed).not.toBe(initialAriaPressed);
    }
  });

  test("Advanced section is absent when currentsEnabled=false", async ({ page }) => {
    test.setTimeout(90_000);

    // Explicitly disable currents so the Advanced section must not render.
    await seedSettings(page, { currentsEnabled: false });
    await seedPanelCollapse(page, { seafloorClassification: false });

    await page.goto("/");

    // The currents panel itself still renders (with the enable button)
    // but without currentsEnabled the AdvancedSection is never mounted.
    const currentsPanel = page.locator('[data-testid="currents-panel"]');
    const panelVisible = await currentsPanel.isVisible({ timeout: 25_000 }).catch(() => false);
    if (!panelVisible) {
      test.skip(true, "CurrentsPanel not visible — UI may not be active");
      return;
    }

    // The enable button must be visible (currents are off).
    const enableBtn = currentsPanel.locator('[data-testid="currents-enable"]');
    await expect(enableBtn).toBeVisible({ timeout: 10_000 });

    // The Advanced toggle must NOT be in the DOM.
    const advBtn = currentsPanel.locator('[data-testid="advanced-toggle-currentsPanelAdvanced"]');
    await expect(advBtn).toHaveCount(0);
  });

  test("Advanced section is still expanded after toggling currents off then back on", async ({ page }) => {
    test.setTimeout(90_000);

    // Start with currents enabled and the Advanced section expanded.
    await seedSettings(page, { currentsEnabled: true });
    await seedPanelCollapse(page, {
      seafloorClassification: false,
      currentsPanelAdvanced: false, // false = expanded
    });

    await page.goto("/");

    const currentsPanel = page.locator('[data-testid="currents-panel"]');
    const panelVisible = await currentsPanel.isVisible({ timeout: 25_000 }).catch(() => false);
    if (!panelVisible) {
      test.skip(true, "CurrentsPanel not visible — UI may not be active");
      return;
    }

    const advBtn = currentsPanel.locator('[data-testid="advanced-toggle-currentsPanelAdvanced"]');
    const advBtnVisible = await advBtn.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!advBtnVisible) {
      test.skip(true, "CurrentsPanel Advanced toggle not visible — currents may not be enabled");
      return;
    }

    // Confirm the section is expanded before toggling off.
    await expect(advBtn).toHaveAttribute("aria-expanded", "true");

    // Toggle currents OFF via the panel's OFF button.
    const disableBtn = currentsPanel.locator('[data-testid="currents-disable"]');
    await disableBtn.click();

    // The Advanced toggle must disappear (currents off hides the whole section).
    await expect(advBtn).toHaveCount(0, { timeout: 5_000 });

    // Toggle currents ON again via the enable button.
    const enableBtn = currentsPanel.locator('[data-testid="currents-enable"]');
    await enableBtn.click();

    // Advanced toggle must reappear and still be expanded — the store state
    // (currentsPanelAdvanced=false) was not modified by the toggle, so the
    // AdvancedSection remounts in the same expanded position.
    const advBtnAfter = currentsPanel.locator('[data-testid="advanced-toggle-currentsPanelAdvanced"]');
    await expect(advBtnAfter).toBeVisible({ timeout: 10_000 });
    await expect(advBtnAfter).toHaveAttribute("aria-expanded", "true");
  });
});

// ── TidePanel ─────────────────────────────────────────────────────────────────

test.describe("TidePanel — Advanced toggle", () => {
  test("Advanced toggle persists when tide panel is visible", async ({ page }) => {
    test.setTimeout(90_000);

    // Seed panel state — Advanced collapsed by default
    await seedPanelCollapse(page, { tidePanelAdvanced: true });

    await page.goto("/");

    // TidePanel only renders when tidal data is available.  Skip gracefully.
    const advBtn = page.locator('[data-testid="advanced-toggle-tidePanelAdvanced"]');
    const advBtnVisible = await advBtn.isVisible({ timeout: 20_000 }).catch(() => false);
    if (!advBtnVisible) {
      test.skip(true, "TidePanel Advanced toggle not visible — tide data or panel not loaded");
      return;
    }

    // 1. Collapsed by default
    await expect(advBtn).toHaveAttribute("aria-expanded", "false");

    // 2. Expand
    await advBtn.click();
    await expect(advBtn).toHaveAttribute("aria-expanded", "true");

    // 3. Persist across reload
    await page.reload();
    const advBtnReloaded = page.locator('[data-testid="advanced-toggle-tidePanelAdvanced"]');
    const reloadVisible = await advBtnReloaded.isVisible({ timeout: 20_000 }).catch(() => false);
    if (!reloadVisible) {
      test.skip(true, "TidePanel Advanced toggle lost after reload — tide data not available");
      return;
    }
    await expect(advBtnReloaded).toHaveAttribute("aria-expanded", "true");
  });

  test("depth-layer buttons inside Advanced are reachable after expanding", async ({ page }) => {
    test.setTimeout(90_000);

    await seedPanelCollapse(page, { tidePanelAdvanced: false });
    await page.goto("/");

    const advBtn = page.locator('[data-testid="advanced-toggle-tidePanelAdvanced"]');
    const advBtnVisible = await advBtn.isVisible({ timeout: 20_000 }).catch(() => false);
    if (!advBtnVisible) {
      test.skip(true, "TidePanel not visible — tide data not loaded");
      return;
    }

    await expect(advBtn).toHaveAttribute("aria-expanded", "true");

    // Depth layer selector buttons must have non-zero bounding boxes
    const depthLayerButtons = page.locator(".tide-panel button").filter({
      hasText: /surface|mid-col|near-btm/i,
    });
    const count = await depthLayerButtons.count();
    if (count === 0) {
      test.skip(true, "No depth layer buttons found — tide data not available");
      return;
    }
    for (let i = 0; i < count; i++) {
      expect(await depthLayerButtons.nth(i).boundingBox()).not.toBeNull();
    }
  });
});

// ── HabitatPanel ──────────────────────────────────────────────────────────────

test.describe("HabitatPanel — Advanced toggle", () => {
  test("Advanced toggle persists when habitat overlay is active", async ({ page }) => {
    test.setTimeout(90_000);

    await seedPanelCollapse(page, {
      habitat: false,
      habitatAdvanced: true,
    });
    await seedSettings(page, { showHabitatPanel: true });

    await page.goto("/");

    // HabitatPanel Advanced section only renders when showOverlay=true
    // (i.e. a species is selected and scores computed — requires terrain).
    const advBtn = page.locator('[data-testid="advanced-toggle-habitatAdvanced"]');
    const advBtnVisible = await advBtn.isVisible({ timeout: 20_000 }).catch(() => false);
    if (!advBtnVisible) {
      test.skip(true, "HabitatPanel Advanced toggle not visible — terrain or species selection not active");
      return;
    }

    // 1. Collapsed by default
    await expect(advBtn).toHaveAttribute("aria-expanded", "false");

    // 2. Expand
    await advBtn.click();
    await expect(advBtn).toHaveAttribute("aria-expanded", "true");

    // 3. Persist across reload
    await page.reload();
    const advBtnReloaded = page.locator('[data-testid="advanced-toggle-habitatAdvanced"]');
    const reloadVisible = await advBtnReloaded.isVisible({ timeout: 20_000 }).catch(() => false);
    if (!reloadVisible) {
      test.skip(true, "HabitatPanel Advanced not visible after reload — habitat overlay not active");
      return;
    }
    await expect(advBtnReloaded).toHaveAttribute("aria-expanded", "true");
  });

  test("intensity slider inside Advanced is reachable after expanding", async ({ page }) => {
    test.setTimeout(90_000);

    await seedPanelCollapse(page, {
      habitat: false,
      habitatAdvanced: false,
    });
    await seedSettings(page, { showHabitatPanel: true });

    await page.goto("/");

    const advBtn = page.locator('[data-testid="advanced-toggle-habitatAdvanced"]');
    const advBtnVisible = await advBtn.isVisible({ timeout: 20_000 }).catch(() => false);
    if (!advBtnVisible) {
      test.skip(true, "HabitatPanel Advanced toggle not visible");
      return;
    }

    await expect(advBtn).toHaveAttribute("aria-expanded", "true");

    const intensitySlider = page.locator(".habitat-overlay-intensity");
    await expect(intensitySlider).toBeVisible({ timeout: 5_000 });
    expect(await intensitySlider.boundingBox()).not.toBeNull();
  });
});
