import { test, expect, type Page } from "@playwright/test";

/**
 * Bathymetric currents — focused interaction coverage (Task #248).
 *
 * The original spec stopped at "panel is visible and its toggles render".
 * This file additionally exercises the interactions most likely to regress
 * as the currents simulation evolves:
 *   - Manual ↔ NOAA source round-trip (UI reflects each source)
 *   - Tide-phase slider scrub updates the visible phase readout
 *   - Particles / Arrows / Streams toggles flip active state visibly
 *
 * /api/tidal is mocked so the NOAA branch resolves deterministically without
 * depending on live NOAA reachability from the test env. The CurrentsPanel
 * itself is plain DOM (no canvas dependency), so assertions are stable even
 * when headless WebGL isn't available — only the underlying CurrentsLayer
 * would need a live GL context, and it isn't asserted on here.
 *
 * NOTE (Task #249): The shared beforeEach intentionally does NOT visit "/".
 * Only the tests that genuinely need the HUD currents panel navigate to the
 * heavy 3D home route themselves (via openCurrentsHome). The settings-tab
 * test goes straight to /settings. Avoiding redundant goto("/") calls keeps
 * headless Chromium from piling up WebGL contexts during the full Playwright
 * run, which was the root cause of intermittent ERR_CONNECTION_REFUSED on
 * this and adjacent specs.
 */

async function appIsSignedIn(page: Page): Promise<boolean> {
  return page
    .locator("[data-testid='currents-panel']")
    .isVisible({ timeout: 15_000 })
    .catch(() => false);
}

async function openCurrentsHome(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
}

async function enableCurrents(page: Page): Promise<void> {
  const enableBtn = page.locator("[data-testid='currents-enable']");
  if (await enableBtn.isVisible().catch(() => false)) {
    await enableBtn.click();
  }
  await expect(page.locator("[data-testid='currents-disable']")).toBeVisible({
    timeout: 5_000,
  });
}

/** Read the "active" color the panel paints on selected source / layer
 *  toggle buttons. CurrentsPanel.toggleBtn(true) sets `color: #00e5ff`. */
const ACTIVE_COLOR_RGB = "rgb(0, 229, 255)";

function buildMockTidal() {
  return {
    available: true,
    tideHeight: 1.42,
    currentDirection: 87,
    currentSpeed: 0.93,
    stationName: "Mock Currents Station",
    stationId: "PCT0001",
    isPredicted: true,
    source: "estimated" as const,
    nextEvent: {
      type: "high" as const,
      time: new Date(Date.now() + 45 * 60_000).toISOString(),
      height: 1.6,
    },
    slack: {
      isSlack: false,
      phase: "flooding" as const,
      minutesToSlack: 38,
      minutesSinceSlack: 0,
      nextReversalAt: new Date(Date.now() + 38 * 60_000).toISOString(),
    },
  };
}

test.describe("Bathymetric currents — interaction coverage", () => {
  test.beforeEach(async ({ page }) => {
    // Make /api/tidal deterministic so the NOAA path always has something
    // to surface in `currents-noaa-readout`. The schedule endpoint is fine
    // to leave to the real handler — this spec doesn't touch slack ticks.
    // Intentionally no goto("/") here — see file header.
    await page.route(/\/api\/tidal(\?|$)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildMockTidal()),
      });
    });
  });

  test("source toggle round-trips Manual → NOAA → Manual and the UI tracks it", async ({
    page,
  }) => {
    await openCurrentsHome(page);
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Currents panel not visible — landing page shown (e2e auth bypass inactive)");
      return;
    }
    await enableCurrents(page);

    const manualBtn = page.locator("[data-testid='currents-source-manual']");
    const noaaBtn = page.locator("[data-testid='currents-source-noaa']");
    const manualDir = page.locator("[data-testid='currents-manual-dir']");
    const manualSpeed = page.locator("[data-testid='currents-manual-speed']");
    const noaaReadout = page.locator("[data-testid='currents-noaa-readout']");

    // Default state: Manual is active, manual inputs are rendered, NOAA
    // readout is not.
    await expect(manualBtn).toHaveCSS("color", ACTIVE_COLOR_RGB);
    await expect(manualDir).toBeVisible();
    await expect(manualSpeed).toBeVisible();
    await expect(noaaReadout).toHaveCount(0);

    // Manual → NOAA: manual inputs disappear, NOAA readout appears, NOAA
    // button takes the active color.
    await noaaBtn.click();
    await expect(noaaBtn).toHaveCSS("color", ACTIVE_COLOR_RGB);
    await expect(manualBtn).not.toHaveCSS("color", ACTIVE_COLOR_RGB);
    await expect(noaaReadout).toBeVisible({ timeout: 5_000 });
    await expect(manualDir).toHaveCount(0);
    await expect(manualSpeed).toHaveCount(0);

    // NOAA → Manual: manual inputs come back, NOAA readout goes away.
    await manualBtn.click();
    await expect(manualBtn).toHaveCSS("color", ACTIVE_COLOR_RGB);
    await expect(noaaBtn).not.toHaveCSS("color", ACTIVE_COLOR_RGB);
    await expect(manualDir).toBeVisible({ timeout: 5_000 });
    await expect(manualSpeed).toBeVisible();
    await expect(noaaReadout).toHaveCount(0);
  });

  test("tide-phase slider scrub updates the visible phase readout", async ({
    page,
  }) => {
    await openCurrentsHome(page);
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Currents panel not visible — landing page shown (e2e auth bypass inactive)");
      return;
    }
    await enableCurrents(page);

    const slider = page.locator("[data-testid='currents-tide-phase']");
    await expect(slider).toBeVisible();

    // The readout label "Tide Phase" sits next to a "<NN>%" sibling that
    // mirrors currentsTidePhase. Locate that percentage span by anchoring
    // off the "Tide Phase" label.
    const readout = page
      .locator("text=Tide Phase")
      .locator("xpath=following-sibling::span[1]");
    await expect(readout).toBeVisible();

    // Baseline: store default is 0 → "0%".
    await expect(readout).toHaveText(/^0%$/);

    // Scrub to ~50% (slider value range is 0..1000, mapped to 0..1).
    await slider.evaluate((el: HTMLInputElement) => {
      el.value = "500";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(readout).toHaveText(/^50%$/, { timeout: 5_000 });

    // Scrub to 100% (peak ebb / wrap point).
    await slider.evaluate((el: HTMLInputElement) => {
      el.value = "1000";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(readout).toHaveText(/^100%$/, { timeout: 5_000 });

    // Back to 0 for hygiene.
    await slider.evaluate((el: HTMLInputElement) => {
      el.value = "0";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(readout).toHaveText(/^0%$/, { timeout: 5_000 });
  });

  test("particles / arrows / streams toggles flip active state", async ({
    page,
  }) => {
    await openCurrentsHome(page);
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Currents panel not visible — landing page shown (e2e auth bypass inactive)");
      return;
    }
    await enableCurrents(page);

    const particles = page.locator("[data-testid='currents-toggle-particles']");
    const arrows = page.locator("[data-testid='currents-toggle-arrows']");
    const streams = page.locator("[data-testid='currents-toggle-streams']");

    // Store defaults: particles ON, arrows ON, streamlines OFF.
    await expect(particles).toHaveCSS("color", ACTIVE_COLOR_RGB);
    await expect(arrows).toHaveCSS("color", ACTIVE_COLOR_RGB);
    await expect(streams).not.toHaveCSS("color", ACTIVE_COLOR_RGB);

    // Each toggle must round-trip independently.
    await particles.click();
    await expect(particles).not.toHaveCSS("color", ACTIVE_COLOR_RGB);
    await particles.click();
    await expect(particles).toHaveCSS("color", ACTIVE_COLOR_RGB);

    await arrows.click();
    await expect(arrows).not.toHaveCSS("color", ACTIVE_COLOR_RGB);
    await arrows.click();
    await expect(arrows).toHaveCSS("color", ACTIVE_COLOR_RGB);

    await streams.click();
    await expect(streams).toHaveCSS("color", ACTIVE_COLOR_RGB);
    await streams.click();
    await expect(streams).not.toHaveCSS("color", ACTIVE_COLOR_RGB);
  });

  // Smoke coverage retained from the original spec so the panel-presence
  // contract is still asserted alongside the deeper interaction tests.
  test("HUD currents panel mounts with all expected controls", async ({
    page,
  }) => {
    await openCurrentsHome(page);
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Currents panel not visible — landing page shown (e2e auth bypass inactive)");
      return;
    }
    await enableCurrents(page);

    await expect(page.locator("[data-testid='currents-source-manual']")).toBeVisible();
    await expect(page.locator("[data-testid='currents-source-noaa']")).toBeVisible();
    await expect(page.locator("[data-testid='currents-tide-phase']")).toBeVisible();
    await expect(page.locator("[data-testid='currents-toggle-particles']")).toBeVisible();
    await expect(page.locator("[data-testid='currents-toggle-arrows']")).toBeVisible();
    await expect(page.locator("[data-testid='currents-toggle-streams']")).toBeVisible();
    await expect(page.locator("[data-testid='currents-legend']")).toBeVisible();
  });

  test("settings page has a Currents tab that opens the currents section", async ({
    page,
  }) => {
    // Goes straight to /settings — no home-route warmup needed (task #249).
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const tab = page.locator('button:has-text("CURRENTS")').first();
    const tabVisible = await tab.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!tabVisible) {
      test.skip(true, "Settings tabs not visible — landing page shown (e2e auth bypass inactive)");
      return;
    }
    await tab.click();
    await expect(page.locator("text=◈ BATHYMETRIC CURRENTS")).toBeVisible({
      timeout: 3_000,
    });
  });
});
