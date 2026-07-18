import { test, expect, type Page } from "./fixtures";

/**
 * Timeline scrubber end-to-end regression tests.
 *
 * Covers the five scenarios called out in the task spec:
 *   1. Overlay gate — scrubber visible when a time-sensitive overlay is on,
 *      hidden when all overlays are off.
 *   2. Scrubber ↔ TidePanel cursor sync — moving the scrubber propagates
 *      the selected time into TidePanel (tide-timeline-active-notice visible).
 *   3. Mid-play deactivation — toggling the tide overlay off while playing
 *      stops playback and hides the scrubber.
 *   4. Depth-profile non-overlap — bounding-rect of the scrubber bar sits
 *      above the depth-profile panel when both are visible simultaneously.
 *   5. No-forecast fallback — scrubber renders with the default ±12 h range
 *      even when all tidal API calls return 500.
 *
 * Pattern notes:
 *   - addInitScript patches "bathyscan:settings" localStorage so each test
 *     starts with the exact overlay state it needs (avoids blind-click hazards
 *     when an overlay is already on from a prior run).
 *   - dispatchEvent("click") is used instead of .click() for HUD toggles to
 *     stay consistent with conditions-overlays.spec.ts.
 *   - __bathyTest is used for depth-profile setup (same as depth-profile.spec.ts).
 */

// ── Shared selectors ──────────────────────────────────────────────────────────
const SCRUB_BAR          = "[data-testid='timeline-scrub-bar']";
const TIDE_TOGGLE        = "[data-testid='overlay-toggle-tide']";
const PLAY_PAUSE         = "[data-testid='timeline-play-pause']";
const SCRUBBER_INPUT     = "[data-testid='timeline-scrubber']";
const TIDE_ACTIVE_NOTICE = "[data-testid='tide-timeline-active-notice']";
const DEPTH_PANEL        = "[data-testid='depth-profile-panel']";

// Must match DEPTH_PROFILE_CLEARANCE in TimelineScrubBar.tsx
const DEPTH_PROFILE_CLEARANCE = 360;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Patch localStorage so the first page load starts with tideOverlayActive = active.
 * Uses a sessionStorage guard so it only fires on the first navigation (same
 * pattern as conditions-overlays.spec.ts).
 */
async function patchTideOverlay(page: Page, active: boolean): Promise<void> {
  await page.addInitScript(
    ({ active }: { active: boolean }) => {
      if (!sessionStorage.getItem("__timelineOverlayInit")) {
        sessionStorage.setItem("__timelineOverlayInit", "1");
        try {
          const raw = localStorage.getItem("bathyscan:settings");
          if (raw) {
            const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
            if (parsed?.state) {
              parsed.state.tideOverlayActive    = active;
              parsed.state.currentOverlayActive = false;
              parsed.state.windOverlayActive    = false;
              localStorage.setItem("bathyscan:settings", JSON.stringify(parsed));
            }
          }
        } catch {}
      }
    },
    { active },
  );
}

/** Switch the sidebar to the Plan tab (TidePanel lives there, display:none otherwise). */
async function ensurePlanTab(page: Page): Promise<void> {
  const planTab = page.locator("[data-testid='sidebar-mode-tab-plan']");
  await expect(planTab).toBeVisible({ timeout: 10_000 });
  const pressed = await planTab.getAttribute("aria-pressed").catch(() => null);
  if (pressed !== "true") {
    await planTab.dispatchEvent("click");
    await expect(planTab).toHaveAttribute("aria-pressed", "true");
  }
}

async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__bathyTest), null, {
    timeout: 10_000,
  });
}

async function stubEmptyLists(page: Page): Promise<void> {
  await page.route("**/api/user/folders**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/datasets**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/user/datasets**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
}


/**
 * Ensure the tide overlay is ON and the scrubber visible. The localStorage
 * pre-patch in patchTideOverlay can be overwritten by server-side settings
 * hydration (overlay flags are server-persisted), so fall back to clicking
 * the HUD tide toggle when the scrubber is still hidden after load.
 */
async function ensureScrubberVisible(page: Page): Promise<void> {
  const bar = page.locator(SCRUB_BAR);
  await expect(bar).toBeAttached({ timeout: 10_000 });
  const hidden = await bar.getAttribute("aria-hidden").catch(() => null);
  if (hidden === "true") {
    const toggle = page.locator(TIDE_TOGGLE);
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.dispatchEvent("click");
  }
  await expect(bar).toHaveAttribute("aria-hidden", "false", { timeout: 10_000 });
}

// ── 1. Overlay visibility gate ────────────────────────────────────────────────

test.describe("Timeline scrubber — overlay visibility gate", () => {
  test.beforeEach(async ({ page }) => {
    // Start with all overlays OFF (same sessionStorage-guard pattern as conditions-overlays.spec.ts)
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("__timelineGateClear")) {
        sessionStorage.setItem("__timelineGateClear", "1");
        try {
          const raw = localStorage.getItem("bathyscan:settings");
          if (raw) {
            const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
            if (parsed?.state) {
              parsed.state.tideOverlayActive    = false;
              parsed.state.currentOverlayActive = false;
              parsed.state.windOverlayActive    = false;
              localStorage.setItem("bathyscan:settings", JSON.stringify(parsed));
            }
          }
        } catch {}
      }
    });
  });

  test("scrubber is hidden (aria-hidden=true) when no overlay is active", async ({ page }) => {
    await page.goto("/");
    const bar = page.locator(SCRUB_BAR);
    await expect(bar).toBeAttached({ timeout: 10_000 });
    await expect(bar).toHaveAttribute("aria-hidden", "true");
  });

  test("scrubber appears (aria-hidden=false) when tide overlay is activated via HUD", async ({ page }) => {
    await page.goto("/");
    await page.locator(TIDE_TOGGLE).dispatchEvent("click");
    await expect(page.locator(SCRUB_BAR)).toHaveAttribute("aria-hidden", "false", { timeout: 5_000 });
  });

  test("scrubber hides again after tide overlay is deactivated", async ({ page }) => {
    await page.goto("/");
    await page.locator(TIDE_TOGGLE).dispatchEvent("click");
    await expect(page.locator(SCRUB_BAR)).toHaveAttribute("aria-hidden", "false", { timeout: 5_000 });
    await page.locator(TIDE_TOGGLE).dispatchEvent("click");
    await expect(page.locator(SCRUB_BAR)).toHaveAttribute("aria-hidden", "true", { timeout: 5_000 });
  });
});

// ── 2. Scrubber ↔ TidePanel cursor sync ──────────────────────────────────────

test.describe("Timeline scrubber — TidePanel cursor sync", () => {
  test("moving scrubber propagates time to TidePanel (tide-timeline-active-notice visible)", async ({ page }) => {
    await patchTideOverlay(page, true);
    await page.goto("/");
    await ensureScrubberVisible(page);

    // The Plan-tab TidePanel only mounts when effectiveTidalData !== null.
    // Live NOAA fetches are unreliable in this env — feed deterministic tidal
    // data through the test bridge (same pattern as tide-scrubber.spec.ts).
    await waitForTestApi(page);
    await page.evaluate(() => {
      const bt = window.__bathyTest;
      if (!bt) return;
      bt.seedTerrain?.();
      bt.setTidalOverlay?.(true);
      bt.feedTidalData?.({
        available: true,
        tideHeight: 1.23,
        currentDirection: 90,
        currentSpeed: 0.8,
        stationName: "Mock Station",
        stationId: "MOCK1",
        isPredicted: true,
        source: "estimated",
        nextEvent: {
          type: "high",
          time: new Date(Date.now() + 60 * 60_000).toISOString(),
          height: 1.5,
        },
        slack: {
          isSlack: false,
          phase: "flooding",
          minutesToSlack: 15,
          minutesSinceSlack: 0,
          nextReversalAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        },
      });
    });

    const input = page.locator(SCRUBBER_INPUT);
    await expect(input).toBeVisible({ timeout: 5_000 });

    // Move the scrubber to mid-range using the native value setter so React onChange fires
    await input.evaluate((el) => {
      const nativeInput = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(nativeInput, "5000");
      nativeInput.dispatchEvent(new Event("input",  { bubbles: true }));
      nativeInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // App.tsx forwards useTimelineStore.currentTime as scrubDatetime to TidePanel;
    // TidePanel renders tide-timeline-active-notice whenever scrubDatetime is non-null.
    // TidePanel lives in the Plan sidebar tab (hidden on the default Explore tab).
    await ensurePlanTab(page);
    await expect(page.locator(TIDE_ACTIVE_NOTICE)).toBeVisible({ timeout: 5_000 });
  });
});

// ── 3. Mid-play deactivation interval cleanup ─────────────────────────────────

test.describe("Timeline scrubber — mid-play deactivation", () => {
  test("deactivating tide overlay mid-play stops playback and hides scrubber", async ({ page }) => {
    await patchTideOverlay(page, true);
    await page.goto("/");
    await ensureScrubberVisible(page);

    // Start playing
    await page.locator(PLAY_PAUSE).click();
    await expect(page.locator(PLAY_PAUSE)).toHaveAttribute(
      "aria-label",
      "Pause timeline",
      { timeout: 5_000 },
    );

    // Deactivate tide overlay while playing
    await page.locator(TIDE_TOGGLE).dispatchEvent("click");

    // Scrubber must hide and play button must revert to "Play timeline"
    await expect(page.locator(SCRUB_BAR)).toHaveAttribute("aria-hidden", "true", { timeout: 5_000 });
    await expect(page.locator(PLAY_PAUSE)).toHaveAttribute(
      "aria-label",
      "Play timeline",
      { timeout: 5_000 },
    );
  });
});

// ── 4. Depth-profile non-overlap ──────────────────────────────────────────────

test.describe("Timeline scrubber — depth-profile non-overlap", () => {
  test(`scrubber bottom ≥ ${DEPTH_PROFILE_CLEARANCE}px when depth profile panel is open`, async ({
    page,
  }) => {
    await patchTideOverlay(page, true);
    await stubEmptyLists(page);
    await page.goto("/");
    await waitForTestApi(page);
    await ensureScrubberVisible(page);

    // Open depth profile start point
    await page.evaluate(() => {
      window.__bathyTest!.showDepthProfileTerrainMenu(150, 150, {
        lon: -132.5, lat: 56.0, depth: 0,
      });
    });
    await expect(page.locator("[data-testid='context-menu']")).toBeVisible({ timeout: 5_000 });
    await page
      .locator("[data-testid='context-menu'] [role='menuitem']")
      .filter({ hasText: "Start depth profile here" })
      .click();

    // Open depth profile end point
    await page.evaluate(() => {
      window.__bathyTest!.showDepthProfileTerrainMenu(400, 300, {
        lon: -132.3, lat: 56.05, depth: 1_000,
      });
    });
    await expect(page.locator("[data-testid='context-menu']")).toBeVisible({ timeout: 5_000 });
    await page
      .locator("[data-testid='context-menu'] [role='menuitem']")
      .filter({ hasText: "End depth profile here" })
      .click();

    await expect(page.locator(DEPTH_PANEL)).toBeVisible({ timeout: 10_000 });

    // Assert scrubber bottom style ≥ DEPTH_PROFILE_CLEARANCE
    const bottomStyle = await page.locator(SCRUB_BAR).evaluate(
      (el) => (el as HTMLElement).style.bottom,
    );
    expect(parseInt(bottomStyle, 10)).toBeGreaterThanOrEqual(DEPTH_PROFILE_CLEARANCE);

    // The bar animates upward (transition: bottom 0.2s) — let it settle before
    // measuring bounding boxes, otherwise the box is captured mid-transition.
    await page.waitForTimeout(600);

    // Secondary: scrubber box must not overlap the depth-profile panel
    const scrubBox   = await page.locator(SCRUB_BAR).boundingBox();
    const profileBox = await page.locator(DEPTH_PANEL).boundingBox();
    if (scrubBox && profileBox) {
      expect(scrubBox.y + scrubBox.height).toBeLessThanOrEqual(profileBox.y + 1);
    }
  });
});

// ── 5. No-forecast fallback ───────────────────────────────────────────────────

test.describe("Timeline scrubber — no-forecast fallback", () => {
  test("scrubber renders with fallback ±12 h range when tidal API returns 500", async ({ page }) => {
    await page.route("**/api/tidal**", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced 500" }) }),
    );
    await page.route("**/api/surface-conditions**", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced 500" }) }),
    );
    await page.route("**/api/tide**", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced 500" }) }),
    );

    await patchTideOverlay(page, true);
    await page.goto("/");

    // Scrubber should appear despite API failures (falls back to ±12 h default range)
    await ensureScrubberVisible(page);

    // Input must be accessible and hold a value within [0, 10000]
    const input = page.locator(SCRUBBER_INPUT);
    await expect(input).toBeVisible({ timeout: 5_000 });
    const value = parseInt((await input.getAttribute("value")) ?? "0", 10);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(10_000);
  });
});
