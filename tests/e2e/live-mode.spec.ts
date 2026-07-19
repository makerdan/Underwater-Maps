import { test, expect } from "./fixtures";

/**
 * Live sidebar mode — E2E regression tests.
 *
 * Covers:
 * - The Live tab renders alongside Explore/Plan/Analyze.
 * - Tapping Live shows the Live panel (GPS status, depth card, trail
 *   indicator, Follow Me + Dive-to-GPS buttons) and hides other mode panels.
 * - Entering Live starts trail recording; the indicator shows RECORDING.
 * - Leaving Live stops recording (indicator visibility gates on the mode).
 * - Live mode is persisted and restored after reload.
 *
 * Geolocation is granted and mocked (Mariana Trench area — within default
 * dataset bounds), following the pattern in gps-trail.spec.ts.
 */

const MOCK_LAT = 11.3733;
const MOCK_LON = 142.1951;

/** Patch one or more fields into the persisted bathyscan settings blob. */
function injectSettings(
  page: Parameters<typeof test.beforeEach>[0]["page"],
  patch: Record<string, unknown>,
): Promise<void> {
  // NOTE: the returned promise MUST be awaited before page.goto(). An
  // unawaited addInitScript races the first navigation — the script can miss
  // the initial document entirely, leaving the one-shot guard unset, and then
  // run for the FIRST time on a later reload, clobbering state the test
  // mutated (e.g. resetting sidebarMode back to its seeded value).
  return page.addInitScript((p) => {
    // localStorage guard (NOT sessionStorage): Chromium occasionally drops
    // sessionStorage across a reload when the renderer process is swapped,
    // which would let this init script re-run and clobber state the test
    // mutated. localStorage is still fresh per test context, so the guard
    // remains one-shot per test.
    const guard = "__liveModeInjected";
    if (localStorage.getItem(guard)) return;
    localStorage.setItem(guard, "1");
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

const BASE = {
  hasSeenOnboarding: true, hasSeenToolbarRelocationHint: true,
  sidePaneCollapsed: false,
  sidebarMode: "explore",
  llmDisclosureAcknowledged: true,
  // Fast sampling so trail points accrue within test timeouts.
  gpsRecordingInterval: 1000,
};

async function waitForSidebarTabs(page: Parameters<typeof test.beforeEach>[0]["page"]) {
  await expect(
    page.locator('[data-testid="sidebar-mode-tabs"]'),
  ).toBeVisible({ timeout: 12_000 });
  // Wait for the initial GET /api/settings to settle so that server hydration
  // cannot arrive after a tab click and silently revert the mode.
  await page.evaluate(() => window.__bathyTest!.waitForSettingsReady());
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]).catch(() => {});
  await context.setGeolocation({ latitude: MOCK_LAT, longitude: MOCK_LON, accuracy: 8 });
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
    } catch {}
  });
});

test("Live tab is rendered as the fourth sidebar mode tab", async ({ page }) => {
  await injectSettings(page, BASE);
  await page.goto("/");
  await waitForSidebarTabs(page);

  const liveTab = page.locator('[data-testid="sidebar-mode-tab-live"]');
  await expect(liveTab).toBeVisible();
  await expect(liveTab).toHaveAttribute("aria-pressed", "false");
});

test("tapping Live shows the Live panel and hides other mode panels", async ({ page }) => {
  await injectSettings(page, BASE);
  await page.goto("/");
  await waitForSidebarTabs(page);

  const liveTab = page.locator('[data-testid="sidebar-mode-tab-live"]');
  await liveTab.click();
  await expect(liveTab).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });

  // Live panel content is visible
  await expect(page.locator('[data-testid="live-panel"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="live-gps-status"]')).toBeVisible();
  await expect(page.locator('[data-testid="live-depth-card"]')).toBeVisible();
  await expect(page.locator('[data-testid="live-trail-indicator"]')).toBeVisible();
  await expect(page.locator('[data-testid="live-follow-toggle"]')).toBeVisible();
  await expect(page.locator('[data-testid="live-dive-to-gps"]')).toBeVisible();

  // Other mode panels are hidden (display:none gating)
  await expect(page.locator('[data-testid="sidebar-section-mapData"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="sidebar-section-conditions"]')).not.toBeVisible();
});

test("entering Live starts trail recording and GPS acquisition", async ({ page }) => {
  await injectSettings(page, BASE);
  await page.goto("/");
  await waitForSidebarTabs(page);

  await page.locator('[data-testid="sidebar-mode-tab-live"]').click();

  // Trail recording indicator flips to RECORDING
  await expect(
    page.locator('[data-testid="live-trail-status-text"]'),
  ).toHaveText("RECORDING", { timeout: 8_000 });

  // GPS status should not be OFF — the watch was started (ACQUIRING…,
  // ACTIVE, or ERROR depending on how fast the mocked fix lands).
  await expect(
    page.locator('[data-testid="live-gps-status-text"]'),
  ).not.toHaveText("OFF", { timeout: 8_000 });
});

test("leaving Live pauses the trail; re-entering resumes without losing points", async ({ page }) => {
  await injectSettings(page, BASE);
  await page.goto("/");
  await waitForSidebarTabs(page);

  const liveTab = page.locator('[data-testid="sidebar-mode-tab-live"]');
  const exploreTab = page.locator('[data-testid="sidebar-mode-tab-explore"]');
  const pointCount = page.locator('[data-testid="live-trail-point-count"]');

  await liveTab.click();
  await expect(
    page.locator('[data-testid="live-trail-status-text"]'),
  ).toHaveText("RECORDING", { timeout: 8_000 });

  // Wait until at least one trail point has been sampled.
  await expect(pointCount).not.toHaveText("0 pts", { timeout: 15_000 });
  const beforeText = await pointCount.textContent();
  const before = parseInt(beforeText ?? "0", 10);
  expect(before).toBeGreaterThan(0);

  // Leave Live mode — recording pauses, panel hides.
  await exploreTab.click();
  await expect(exploreTab).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
  await expect(page.locator('[data-testid="live-panel"]')).not.toBeVisible();

  // Re-enter Live: recording resumes and previously recorded points survive.
  await liveTab.click();
  await expect(liveTab).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
  await expect(
    page.locator('[data-testid="live-trail-status-text"]'),
  ).toHaveText("RECORDING", { timeout: 8_000 });

  const afterText = await pointCount.textContent();
  const after = parseInt(afterText ?? "0", 10);
  expect(after).toBeGreaterThanOrEqual(before);
});

test("interval control changes the sampling interval from the Live panel", async ({ page }) => {
  await injectSettings(page, BASE);
  await page.goto("/");
  await waitForSidebarTabs(page);

  await page.locator('[data-testid="sidebar-mode-tab-live"]').click();
  await expect(page.locator('[data-testid="live-interval-control"]')).toBeVisible({
    timeout: 5_000,
  });

  // Injected settings selected 1000 ms, which is not one of the presets —
  // pick 5 s and verify the selection sticks (aria-pressed + persisted store).
  const fiveSec = page.locator('[data-testid="live-interval-5000"]');
  await fiveSec.click();
  await expect(fiveSec).toHaveAttribute("aria-pressed", "true");

  const persisted = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem("bathyscan:settings");
      if (!raw) return null;
      const blob = JSON.parse(raw) as { state?: { gpsRecordingInterval?: number } };
      return blob.state?.gpsRecordingInterval ?? null;
    } catch {
      return null;
    }
  });
  expect(persisted).toBe(5000);

  // Recording stays active across the retime.
  await expect(
    page.locator('[data-testid="live-trail-status-text"]'),
  ).toHaveText("RECORDING", { timeout: 8_000 });
});

test("page reload restores Live mode", async ({ page }) => {
  await injectSettings(page, BASE);
  await page.goto("/");
  await waitForSidebarTabs(page);

  const liveTab = page.locator('[data-testid="sidebar-mode-tab-live"]');
  await liveTab.click();
  await expect(liveTab).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });

  // Ensure the debounced PUT for sidebarMode='live' has landed on the server
  // before reloading.  Without this the 300 ms debounce may not have fired,
  // the server still holds the resetSettings value ('explore'), and the
  // subsequent GET after reload reverts the mode.
  await page.evaluate(() => window.__bathyTest!.waitForServerSettingsSync());
  await page.reload();
  await waitForSidebarTabs(page);
  await expect(liveTab).toHaveAttribute("aria-pressed", "true", { timeout: 8_000 });
  await expect(page.locator('[data-testid="live-panel"]')).toBeVisible({ timeout: 5_000 });
});
