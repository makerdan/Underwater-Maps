import { test, expect } from "./fixtures";

/**
 * Regression hardening for the adaptive colour palette suggestion pipeline.
 *
 * Tests covered here:
 *   1. Banner dismiss — inject a suggestion via __bathyTest, verify the banner
 *      appears, dismiss it, re-inject the same suggestion for the same
 *      datasetId, confirm the banner stays hidden within the same session.
 *
 *   2. Auto-apply fires on fresh load — seed terrain while colormapUserSet ===
 *      false, verify the colormapTheme changed to the suggestion theme.
 *
 *   3. Custom palette not overwritten — mark palette as user-set, seed terrain
 *      again, verify the theme did NOT change (suggestion stored, not applied).
 *
 * All three tests skip gracefully when the __bathyTest bridge is not available
 * (e.g. when running against a production build or a non-bypass environment).
 */

const VALID_BB = [0, 200, 400, 600, 700, 800, 900, 1000, 1200, 1500, 2000] as const;

async function waitForBridge(page: import("@playwright/test").Page): Promise<boolean> {
  return page
    .waitForFunction(() => !!window.__bathyTest, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
}

test.describe("Adaptive colour palette — regression hardening", () => {
  test("banner dismiss: stays hidden after dismissal when suggestion is re-injected for same dataset", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    const ready = await waitForBridge(page);
    if (!ready) {
      test.skip(true, "__bathyTest bridge not available in this environment");
      return;
    }

    await page.evaluate(() => {
      window.__bathyTest!.setColormapUserSet(true);
    });

    const SUGGESTION_THEME = "thermal";
    await page.evaluate(
      ([theme, bb]) => {
        window.__bathyTest!.setPaletteSuggestion(
          { theme: theme as string, bandBoundaries: bb as number[] },
          "e2e-dataset-banner-test",
        );
      },
      [SUGGESTION_THEME, [...VALID_BB]],
    );

    const banner = page.locator('[data-testid="palette-suggestion-banner"]');
    await expect(banner).toBeVisible({ timeout: 5_000 });

    await page.locator('[data-testid="palette-suggestion-dismiss"]').click();
    await expect(banner).toBeHidden({ timeout: 3_000 });

    await page.evaluate(
      ([theme, bb]) => {
        window.__bathyTest!.setPaletteSuggestion(
          { theme: theme as string, bandBoundaries: bb as number[] },
          "e2e-dataset-banner-test",
        );
      },
      [SUGGESTION_THEME, [...VALID_BB]],
    );

    await expect(banner).toBeHidden({ timeout: 3_000 });
  });

  test("banner dismiss: a DIFFERENT dataset's suggestion still shows after ds-1 is dismissed", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    const ready = await waitForBridge(page);
    if (!ready) {
      test.skip(true, "__bathyTest bridge not available in this environment");
      return;
    }

    await page.evaluate(() => {
      window.__bathyTest!.setColormapUserSet(true);
    });

    await page.evaluate(
      ([bb]) => {
        window.__bathyTest!.setPaletteSuggestion(
          { theme: "thermal", bandBoundaries: bb as number[] },
          "e2e-dataset-1",
        );
      },
      [[...VALID_BB]],
    );

    await page.locator('[data-testid="palette-suggestion-dismiss"]').click();
    await expect(page.locator('[data-testid="palette-suggestion-banner"]')).toBeHidden({
      timeout: 3_000,
    });

    await page.evaluate(
      ([bb]) => {
        window.__bathyTest!.setPaletteSuggestion(
          { theme: "thermal", bandBoundaries: bb as number[] },
          "e2e-dataset-2",
        );
      },
      [[...VALID_BB]],
    );

    await expect(page.locator('[data-testid="palette-suggestion-banner"]')).toBeVisible({
      timeout: 3_000,
    });
  });

  test("auto-apply fires on first load: colormapUserSet=false → theme changes", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const ready = await waitForBridge(page);
    if (!ready) {
      test.skip(true, "__bathyTest bridge not available in this environment");
      return;
    }

    await page.evaluate(() => {
      window.__bathyTest!.setColormapUserSet(false);
    });

    const seeded = await page.evaluate(
      ([bb]) => {
        return window.__bathyTest!.seedTerrain({
          datasetId: "e2e-auto-apply-test",
          depths: Array.from({ length: 64 * 64 }, () => 80 + Math.random() * 30),
        });
      },
      [[...VALID_BB]],
    );

    if (!seeded) {
      test.skip(true, "seedTerrain returned false — test bridge not fully initialised");
      return;
    }

    const changed = await expect
      .poll(
        async () => {
          const theme = await page.evaluate(
            () => window.__bathyTest!.getColormapTheme(),
          );
          return theme;
        },
        { timeout: 8_000, intervals: [300, 500, 1000] },
      )
      .not.toBe("ocean");

    void changed;

    const finalTheme = await page.evaluate(() => window.__bathyTest!.getColormapTheme());
    expect(["thermal", "freshwater", "grayscale", "viridis", "ocean"]).toContain(finalTheme);

    expect(await page.evaluate(() => window.__bathyTest!.getColormapUserSet())).toBe(false);
  });

  test("no-overwrite: custom palette not overwritten after dataset reload when colormapUserSet=true", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const ready = await waitForBridge(page);
    if (!ready) {
      test.skip(true, "__bathyTest bridge not available in this environment");
      return;
    }

    await page.evaluate(() => {
      window.__bathyTest!.setColormapThemeByUser("viridis");
    });

    expect(await page.evaluate(() => window.__bathyTest!.getColormapUserSet())).toBe(true);
    expect(await page.evaluate(() => window.__bathyTest!.getColormapTheme())).toBe("viridis");

    const seeded = await page.evaluate(() =>
      window.__bathyTest!.seedTerrain({
        datasetId: "e2e-no-overwrite-test",
        depths: Array.from({ length: 64 * 64 }, () => 80 + Math.random() * 30),
      }),
    );
    if (!seeded) {
      test.skip(true, "seedTerrain returned false — test bridge not fully initialised");
      return;
    }

    await page.waitForTimeout(1_500);

    const theme = await page.evaluate(() => window.__bathyTest!.getColormapTheme());
    expect(theme).toBe("viridis");
    expect(await page.evaluate(() => window.__bathyTest!.getColormapUserSet())).toBe(true);
  });
});
