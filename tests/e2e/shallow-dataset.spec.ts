import { test, expect } from "./fixtures";

/**
 * Shallow-dataset display polish (vertical exaggeration + fine contours).
 *
 * Tests covered here:
 *   1. Banner apply flow — seed a shallow terrain (depth range < 6 m), verify
 *      the suggestion banner appears, click APPLY, and confirm both the
 *      terrain exaggeration and contour interval settings changed in one step.
 *   2. Banner dismiss — dismiss the banner and confirm it does not reappear
 *      for the same dataset within the session (once-per-dataset).
 *   3. No banner for deep datasets — seed a deep terrain and confirm no
 *      suggestion is raised (settings are never touched silently).
 *   4. Exaggeration slider label — the settings slider renders the
 *      "N× vertical exaggeration" label reflecting the current value.
 *
 * All tests skip gracefully when the __bathyTest bridge is not available.
 */

/**
 * Inject hasSeenOnboarding=true into localStorage before the page script
 * runs so the OnboardingOverlay (zIndex 9000, full-screen) never mounts and
 * cannot intercept clicks on the shallow-suggestion banner. Same pattern as
 * onboarding-tour.spec.ts.
 */
function patchOnboardingSeen() {
  return () => {
    try {
      const raw = localStorage.getItem("bathyscan:settings");
      const parsed: { state?: Record<string, unknown>; version?: number } = raw
        ? JSON.parse(raw)
        : {};
      parsed.state = { ...(parsed.state ?? {}), hasSeenOnboarding: true };
      localStorage.setItem("bathyscan:settings", JSON.stringify(parsed));
    } catch {
      try {
        localStorage.setItem(
          "bathyscan:settings",
          JSON.stringify({ state: { hasSeenOnboarding: true }, version: 0 }),
        );
      } catch {
        // localStorage blocked (unlikely in tests, but guard anyway).
      }
    }
  };
}

async function waitForBridge(page: import("@playwright/test").Page): Promise<boolean> {
  return page
    .waitForFunction(() => !!window.__bathyTest, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
}

function shallowDepths(n: number): number[] {
  // Depth range 0.5–3.5 m — well under the 6.096 m shallow threshold.
  return Array.from({ length: n * n }, (_, i) => 0.5 + ((i % 7) / 6) * 3);
}

function deepDepths(n: number): number[] {
  return Array.from({ length: n * n }, (_, i) => 50 + ((i % 11) / 10) * 100);
}

test.describe("Shallow dataset — suggestion banner and display settings", () => {
  test("banner appears for a shallow dataset and APPLY sets exaggeration + fine contours in one step", async ({
    page,
  }) => {
    await page.addInitScript(patchOnboardingSeen());
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const ready = await waitForBridge(page);
    if (!ready) {
      test.skip(true, "__bathyTest bridge not available in this environment");
      return;
    }

    const seeded = await page.evaluate(([depths]) =>
      window.__bathyTest!.seedTerrain({
        datasetId: "e2e-shallow-apply",
        depths: depths as number[],
        minDepth: 0.5,
        maxDepth: 3.5,
      }),
      [shallowDepths(64)],
    );
    if (!seeded) {
      test.skip(true, "seedTerrain returned false — test bridge not fully initialised");
      return;
    }

    const banner = page.locator('[data-testid="shallow-suggestion-banner"]');
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // Settings must NOT have been changed just by showing the banner.
    const preExaggeration = await page.evaluate(() =>
      window.__bathyTest!.getTerrainExaggeration(),
    );
    expect(preExaggeration).not.toBe(5);

    await page.locator('[data-testid="shallow-suggestion-apply"]').click();
    await expect(banner).toBeHidden({ timeout: 3_000 });

    await expect
      .poll(
        () => page.evaluate(() => window.__bathyTest!.getTerrainExaggeration()),
        { timeout: 5_000 },
      )
      .toBe(5);

    const units = await page.evaluate(() => window.__bathyTest!.getUnits());
    const expectedInterval = units === "imperial" ? 1 : 0.5;
    expect(await page.evaluate(() => window.__bathyTest!.getContourInterval())).toBe(
      expectedInterval,
    );
    expect(await page.evaluate(() => window.__bathyTest!.getContoursEnabled())).toBe(
      true,
    );
  });

  test("banner dismiss: does not reappear for the same dataset within the session", async ({
    page,
  }) => {
    await page.addInitScript(patchOnboardingSeen());
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const ready = await waitForBridge(page);
    if (!ready) {
      test.skip(true, "__bathyTest bridge not available in this environment");
      return;
    }

    const seeded = await page.evaluate(([depths]) =>
      window.__bathyTest!.seedTerrain({
        datasetId: "e2e-shallow-dismiss",
        depths: depths as number[],
        minDepth: 0.5,
        maxDepth: 3.5,
      }),
      [shallowDepths(64)],
    );
    if (!seeded) {
      test.skip(true, "seedTerrain returned false — test bridge not fully initialised");
      return;
    }

    const banner = page.locator('[data-testid="shallow-suggestion-banner"]');
    await expect(banner).toBeVisible({ timeout: 5_000 });

    await page.locator('[data-testid="shallow-suggestion-dismiss"]').click();
    await expect(banner).toBeHidden({ timeout: 3_000 });

    // Re-seed the same shallow dataset — banner must stay hidden.
    await page.evaluate(([depths]) =>
      window.__bathyTest!.seedTerrain({
        datasetId: "e2e-shallow-dismiss",
        depths: depths as number[],
        minDepth: 0.5,
        maxDepth: 3.5,
      }),
      [shallowDepths(64)],
    );
    await expect(banner).toBeHidden({ timeout: 3_000 });
  });

  test("no banner for a deep dataset, and settings are untouched", async ({ page }) => {
    await page.addInitScript(patchOnboardingSeen());
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const ready = await waitForBridge(page);
    if (!ready) {
      test.skip(true, "__bathyTest bridge not available in this environment");
      return;
    }

    const preExaggeration = await page.evaluate(() =>
      window.__bathyTest!.getTerrainExaggeration(),
    );

    const seeded = await page.evaluate(([depths]) =>
      window.__bathyTest!.seedTerrain({
        datasetId: "e2e-deep-no-banner",
        depths: depths as number[],
        minDepth: 50,
        maxDepth: 150,
      }),
      [deepDepths(64)],
    );
    if (!seeded) {
      test.skip(true, "seedTerrain returned false — test bridge not fully initialised");
      return;
    }

    await page.waitForTimeout(1_500);
    await expect(
      page.locator('[data-testid="shallow-suggestion-banner"]'),
    ).toBeHidden();
    expect(
      await page.evaluate(() => window.__bathyTest!.getShallowSuggestionDatasetId()),
    ).toBeNull();
    expect(
      await page.evaluate(() => window.__bathyTest!.getTerrainExaggeration()),
    ).toBe(preExaggeration);
  });

  test("settings slider shows the N× vertical exaggeration label", async ({ page }) => {
    await page.addInitScript(patchOnboardingSeen());
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    const ready = await waitForBridge(page);
    if (!ready) {
      test.skip(true, "__bathyTest bridge not available in this environment");
      return;
    }

    await expect(page.getByText("Vertical Exaggeration", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    const exaggeration = await page.evaluate(() =>
      window.__bathyTest!.getTerrainExaggeration(),
    );
    // Slider display clamps into [1, 20]; the label always ends with
    // "× vertical exaggeration".
    const clamped = Math.min(20, Math.max(1, exaggeration));
    const n = clamped % 1 === 0 ? clamped.toFixed(0) : clamped.toFixed(1);
    await expect(page.getByText(`${n}× vertical exaggeration`)).toBeVisible({
      timeout: 5_000,
    });
  });
});
