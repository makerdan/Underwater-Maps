import { test, expect, type Page } from "./fixtures";

/**
 * Tide HUD scrubber end-to-end tests
 *
 * Task #142 added purple slack-window shading, "◐ N" day badges, and hover
 * tooltips to the TidePanel scrubber. This spec locks in the visible
 * behaviour so a future refactor cannot silently drop them.
 *
 * The /api/tidal/schedule response is mocked so the test is deterministic and
 * does not depend on live NOAA data being reachable from the test env.
 */

async function appIsSignedIn(page: Page): Promise<boolean> {
  return page
    .locator("canvas")
    .first()
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
}

/** Enable the Tidal overlay if it isn't already on. The top-bar toggle
 *  renders "◉ TIDAL" when active and "○ TIDAL" when inactive, so clicking
 *  when already on would *disable* the overlay and unmount the panel. */
async function ensureTidalOverlayEnabled(page: Page): Promise<void> {
  const btn = page.locator("button:has-text('TIDAL')").first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  const text = (await btn.innerText()).trim();
  if (!text.startsWith("◉")) {
    // Use dispatchEvent to bypass any canvas element that may intercept
    // the click in headless mode (z-order overlap with HUD).
    await btn.dispatchEvent("click");
  }
}

/** Build a deterministic 7-day slack schedule rooted at today's UTC midnight
 *  so the slack bands & badges always have something to render regardless of
 *  whether the real NOAA station is reachable. */
function buildMockSchedule() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const events: Array<{
    time: string;
    windowStart: string;
    windowEnd: string;
    type: "high" | "low";
    height: number;
    nextDirectionDeg: number;
  }> = [];
  for (let day = 0; day < 7; day++) {
    const base = new Date(today);
    base.setUTCDate(base.getUTCDate() + day);
    // Two slack events per day: a "high" at 06:00 UTC and a "low" at 18:00 UTC.
    for (const [hour, type, dir] of [
      [6, "high" as const, 45],
      [18, "low" as const, 225],
    ] as const) {
      const center = new Date(base);
      center.setUTCHours(hour, 0, 0, 0);
      const ws = new Date(center.getTime() - 30 * 60_000);
      const we = new Date(center.getTime() + 30 * 60_000);
      events.push({
        time: center.toISOString(),
        windowStart: ws.toISOString(),
        windowEnd: we.toISOString(),
        type,
        height: type === "high" ? 1.42 : -0.31,
        nextDirectionDeg: dir,
      });
    }
  }
  return { events };
}

test.describe("Tide HUD scrubber slack visuals", () => {
  test.beforeEach(async ({ page }) => {
    // Suppress SimulatedDataConfirmDialog before navigating so it cannot
    // block the dataset auto-load that TidePanel depends on.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    // Ensure showTidePanel / autoLoadTidal are enabled so a prior test that
    // disabled them cannot prevent TidePanel from mounting.
    await page.request.put("http://localhost:3151/api/settings", {
      headers: { "x-e2e-user-id": "dev-user-bypass" },
      data: { showTidePanel: true, autoLoadTidal: true },
    });
    // Mock the schedule endpoint with a deterministic 7-day slack schedule.
    await page.route("**/api/tidal/schedule*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildMockSchedule()),
      });
    });
    // Mock the live tidal data endpoint so TidePanel mounts regardless of
    // whether the NOAA tide station is reachable from the test env. The
    // schedule mock above drives the badges/bands; this only needs to return
    // a valid available-station payload so `tidalData !== null` in App.tsx
    // and the panel renders.
    await page.route(/\/api\/tidal(\?|$)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
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
            minutesToSlack: 42,
            minutesSinceSlack: 0,
            nextReversalAt: new Date(Date.now() + 42 * 60_000).toISOString(),
          },
        }),
      });
    });
    await page.goto("/");
    // domcontentloaded (not networkidle): the home route keeps long-lived
    // requests open (NOAA, surface-conditions, terrain warm-up) so networkidle
    // never resolves before Playwright's 30 s timeout. The canvas visibility
    // check and explicit element waits below handle synchronisation.
    await page.waitForLoadState("domcontentloaded");
  });

  test("renders day badges, slack bands, and a hover tooltip on the scrubber", async ({ page }) => {
    test.setTimeout(90_000);
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown (e2e auth bypass inactive)");
      return;
    }

    // TidePanel only fetches tidal data once a dataset is active (it needs
    // the dataset centre coordinates). Wait for terrain to load so the tidal
    // API call fires and our mock can respond.
    await page.waitForFunction(
      () => Boolean(window.__bathyTest?.getTerrainSummary?.()),
      null,
      { timeout: 25_000 },
    ).catch(() => {});
    // If terrain didn't load in time, seed synthetic terrain so that
    // useTidalData receives non-null lat/lon and fires the fetch.
    const hasTerrain = await page.evaluate(
      () => Boolean(window.__bathyTest?.getTerrainSummary?.()),
    ).catch(() => false);
    if (!hasTerrain) {
      const seeded = await page.evaluate(
        () => window.__bathyTest?.seedTerrain?.(),
      ).catch(() => false);
      // Wait for the seeded terrain to actually propagate into app state.
      if (seeded) {
        await page.waitForFunction(
          () => Boolean(window.__bathyTest?.getTerrainSummary?.()),
          null,
          { timeout: 5_000 },
        ).catch(() => {});
      } else {
        await page.waitForTimeout(500);
      }
    }

    await ensureTidalOverlayEnabled(page);

    // Wait for the TidePanel header to mount.
    await expect(page.locator("text=TIDAL OVERLAY")).toBeVisible({ timeout: 20_000 });

    // The "Time scrub" section is always rendered, even if the station data
    // itself is unavailable, so the day-badge + band assertions below don't
    // depend on real NOAA reachability.
    await expect(page.locator("text=Time scrub")).toBeVisible({ timeout: 10_000 });

    // 1. At least one day button should carry a "◐ N" badge.
    const dayBadge = page.locator("button >> text=/◐\\s*\\d+/").first();
    await expect(dayBadge).toBeVisible({ timeout: 10_000 });

    // 2. The hour-slider container should render at least one purple slack
    //    band overlay. The bands sit inside the slider track wrapping the
    //    range input.
    const sliderInput = page.locator("input[type='range']").first();
    await expect(sliderInput).toBeVisible({ timeout: 10_000 });
    const sliderTrack = sliderInput.locator("..");
    // Bands use a purple linear-gradient. Browsers may serialize the rgba()
    // values with or without spaces, so match on a fragment that is stable
    // across representations.
    const bands = sliderTrack.locator("div[style*='linear-gradient']");
    await expect(bands.first()).toBeVisible({ timeout: 10_000 });
    expect(await bands.count()).toBeGreaterThan(0);

    // 3. Hover a slack tick and assert the tooltip with a high/low label and
    //    a compass direction appears. Ticks use the same purple shadow color
    //    (boxShadow rgba(192,132,252,...)) and live inside the slider track.
    // The ticks are rendered on top of the range input (higher z-index and
    // later in DOM order) so a real mouse hover lands on them, matching what
    // a user experiences.
    const ticks = sliderTrack.locator("div[style*='cursor: pointer']");
    const tickCount = await ticks.count();
    expect(tickCount).toBeGreaterThan(0);
    const firstTick = ticks.first();
    await firstTick.hover();

    // Tooltip copy: "Slack ↑ High" or "Slack ↓ Low" + a "Reverses to ebb/flood
    // → <COMPASS> (<deg>°)" line.
    const tooltipLabel = page.locator("text=/Slack\\s*[↑↓]\\s*(High|Low)/").first();
    await expect(tooltipLabel).toBeVisible({ timeout: 5_000 });
    const tooltipDirection = page
      .locator("text=/Reverses to (ebb|flood)\\s*→\\s*[NSEW]+\\s*\\(\\d+°\\)/")
      .first();
    await expect(tooltipDirection).toBeVisible({ timeout: 5_000 });
  });
});
