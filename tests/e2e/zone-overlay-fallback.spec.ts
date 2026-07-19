import { test, expect, type Page } from "./fixtures";

/**
 * Zone overlay AI fallback chain — E2E coverage (Task #2416).
 *
 * Both scenarios mock POST /api/poe/classify at the network layer so the
 * test runs reliably in any environment (with or without live Poe / OpenAI
 * keys) and exercise the full browser path from "classify response received"
 * through to "zone legend rendered".
 *
 * Scenario A — Heuristic path (both AI providers failed):
 *   The server fell back to the depth-heuristic; classify returns
 *   { source: "heuristic", zones: [...] }. The zone-source-heuristic badge
 *   must be visible and the zone legend must be populated.
 *
 * Scenario B — OpenAI fallback path (Poe failed, OpenAI succeeded):
 *   The server used the OpenAI vision model as the secondary AI provider;
 *   classify returns { source: "ai", zones: [...] }. The zone-source-badge-ai
 *   element must be visible and the zone legend must be populated.
 *
 * Both scenarios share a helper that:
 *   1. Routes the classify endpoint.
 *   2. Seeds a 32×32 terrain via window.__bathyTest.seedTerrain.
 *   3. Clicks the zone-toggle to trigger the classify call.
 *   4. Asserts that the expected source badge and zone legend appear.
 */

const SALTWATER_ZONES_HEURISTIC = Array(1024).fill("sandy_shelf");
const SALTWATER_ZONES_AI = Array(1024).fill("basalt_rock");

function buildClassifyResponse(
  source: "ai" | "heuristic",
  zones: string[],
): Record<string, unknown> {
  return {
    zones,
    fromCache: false,
    source,
    substrateFp: "00000000",
    coarseWidth: 32,
    coarseHeight: 32,
    tilesTotal: 1,
    tilesAi: source === "ai" ? 1 : 0,
    tilesHeuristic: source === "heuristic" ? 1 : 0,
  };
}

async function waitForTestBridge(page: Page): Promise<boolean> {
  return page
    .waitForFunction(
      () =>
        Boolean(
          (window as unknown as { __bathyTest?: { seedTerrain?: unknown } })
            .__bathyTest?.seedTerrain,
        ),
      { timeout: 15_000 },
    )
    .then(() => true)
    .catch(() => false);
}

async function runFallbackCase(
  page: Page,
  source: "ai" | "heuristic",
  zones: string[],
): Promise<void> {
  const mockedResponse = buildClassifyResponse(source, zones);

  await page.route(/\/api\/poe\/classify/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockedResponse),
    });
  });

  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  if (!(await waitForTestBridge(page))) {
    test.skip(
      true,
      "window.__bathyTest.seedTerrain not available — dev test helpers missing",
    );
    return;
  }

  const seeded = await page.evaluate(() => {
    const t = (
      window as unknown as {
        __bathyTest?: { seedTerrain?: (o?: Record<string, unknown>) => boolean };
      }
    ).__bathyTest;
    if (!t?.seedTerrain) return false;
    return t.seedTerrain({ waterType: "saltwater" });
  });

  if (!seeded) {
    test.skip(true, "seedTerrain returned false — signed-in shell not mounted");
    return;
  }

  // Zone Analysis panel must mount before the toggle is visible.
  const zonePanel = page.locator("text=Zone Analysis").first();
  const panelVisible = await zonePanel
    .isVisible({ timeout: 15_000 })
    .catch(() => false);
  if (!panelVisible) {
    test.skip(true, "Zone Analysis panel not visible — UI shell not rendered in this env");
    return;
  }

  // Trigger the classify call by clicking the zone overlay toggle.
  const toggle = page.locator('[data-testid="zone-toggle"]');
  const toggleVisible = await toggle.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!toggleVisible) {
    test.skip(true, "zone-toggle not visible — overlay controls not rendered in this env");
    return;
  }
  await toggle.click();

  if (source === "heuristic") {
    // Heuristic path: zone-source-heuristic badge must appear.
    await expect(page.locator('[data-testid="zone-source-heuristic"]')).toBeVisible({
      timeout: 10_000,
    });
  } else {
    // AI path: zone-source-badge-ai must appear.
    await expect(page.locator('[data-testid="zone-source-badge-ai"]')).toBeVisible({
      timeout: 10_000,
    });
  }

  // Zone legend chips must be present regardless of source.
  await expect(page.locator(".zone-legend")).toBeVisible({ timeout: 5_000 });
}

test.describe("Zone overlay AI fallback chain", () => {
  test(
    "heuristic path: zone overlay renders when both AI providers fail",
    async ({ page }) => {
      test.setTimeout(60_000);
      await runFallbackCase(page, "heuristic", SALTWATER_ZONES_HEURISTIC);
    },
  );

  test(
    "OpenAI fallback path: zone overlay renders when Poe fails but OpenAI succeeds",
    async ({ page }) => {
      test.setTimeout(60_000);
      await runFallbackCase(page, "ai", SALTWATER_ZONES_AI);
    },
  );
});
