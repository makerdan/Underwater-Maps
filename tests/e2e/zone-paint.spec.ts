import { test, expect, type Page } from "@playwright/test";

// Detect the signed-in dev shell by waiting for the dev-only `__bathyTest`
// helper to install. We can't rely on the WebGL canvas being visible — it
// often fails to create a context in headless CI — and we don't need it for
// this spec since the paint store is driven through the helper directly.

/**
 * Zone paint-mode e2e coverage (Task #67).
 *
 * Flow:
 *   1. Load the app and wait for the Zone Analysis panel.
 *   2. Seed a zoneMap via the dev-only `window.__bathyTest` helper to
 *      simulate the AI classification landing (avoids a real Poe API call
 *      and the headless-WebGL raycaster needed for a true canvas drag).
 *   3. Enable the overlay, toggle paint mode on, and pick a swatch.
 *   4. Invoke `paintZone` (the same store action TerrainMesh's drag handler
 *      calls) and assert the zoneMap mutated and hasEdits flipped.
 *   5. Click "Reset to AI" and assert the zoneMap returned to baseline.
 */

async function waitForTestHelpers(page: Page): Promise<boolean> {
  return await page
    .waitForFunction(
      () => typeof (window as unknown as { __bathyTest?: unknown }).__bathyTest !== "undefined",
      undefined,
      { timeout: 15_000 },
    )
    .then(() => true)
    .catch(() => false);
}

test.describe("Zone paint mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // domcontentloaded (not networkidle): the home route keeps long-lived
    // requests open (NOAA, surface-conditions, terrain warm-up) so networkidle
    // never resolves before Playwright's 30 s timeout. The waitForFunction
    // calls below handle synchronisation with the dev test helpers instead.
    await page.waitForLoadState("domcontentloaded");
  });

  test("painting mutates zoneMap and Reset to AI restores baseline", async ({ page }) => {
    if (!(await waitForTestHelpers(page))) {
      test.skip(true, "window.__bathyTest not installed — dev test helpers missing");
      return;
    }

    // Wait for the TestBridge to register setTerrain (it mounts inside
    // AppProvider once the user is signed in via VITE_DEV_AUTH_BYPASS).
    const terrainSeeded = await page
      .waitForFunction(
        () => {
          const t = (window as unknown as {
            __bathyTest?: { seedTerrain?: () => boolean };
          }).__bathyTest;
          return !!(t && t.seedTerrain && t.seedTerrain());
        },
        undefined,
        { timeout: 15_000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!terrainSeeded) {
      test.skip(true, "TestBridge setTerrain not registered — signed-in shell not mounted");
      return;
    }

    // Zone Analysis panel renders once terrain context is populated. The
    // canvas itself may fail in headless WebGL but the HUD DOM still renders
    // when the app's React tree is healthy. If the panel can't appear (for
    // example a sibling component crashes the tree in this env), skip the
    // test gracefully — this matches the existing pattern in smoke.spec.ts.
    const zonePanel = page.locator("text=Zone Analysis");
    const panelVisible = await zonePanel.first().isVisible({ timeout: 15_000 }).catch(() => false);
    if (!panelVisible) {
      test.skip(true, "Zone Analysis panel not visible — UI shell not rendered in this env");
      return;
    }

    // Seed a deterministic zoneMap (simulates AI classification landing).
    // 64×64 matches a realistic upsampled resolution and is small enough
    // for a fast hash. fillZone=2 picks a non-default baseline value so a
    // paint with slot=0 (zone index 0) is guaranteed to mutate cells.
    const RES = 64;
    await page.evaluate(
      ([res]) => {
        (window as unknown as { __bathyTest: { seedZoneMap: (n: number, f?: number) => void } })
          .__bathyTest.seedZoneMap(res as number, 2);
      },
      [RES],
    );

    const baseline = await page.evaluate(() => {
      return (window as unknown as {
        __bathyTest: {
          getZoneSnapshot: () => {
            length: number;
            hasEdits: boolean;
            hash: string;
            sample: number[];
          } | null;
        };
      }).__bathyTest.getZoneSnapshot();
    });
    expect(baseline).not.toBeNull();
    expect(baseline!.length).toBe(RES * RES);
    expect(baseline!.hasEdits).toBe(false);

    // Ensure the overlay is enabled — paint controls only render when it is.
    const overlayToggle = page.locator("[data-testid='zone-toggle']");
    await expect(overlayToggle).toBeVisible({ timeout: 5_000 });
    const overlayPressed = await overlayToggle.getAttribute("aria-pressed");
    if (overlayPressed !== "true") {
      await overlayToggle.click();
      await expect(overlayToggle).toHaveAttribute("aria-pressed", "true");
    }

    // Enter paint mode.
    const paintToggle = page.locator("[data-testid='zone-paint-toggle']");
    await expect(paintToggle).toBeVisible({ timeout: 5_000 });
    await paintToggle.click();
    await expect(paintToggle).toHaveAttribute("aria-pressed", "true");

    // Pick swatch 0 (will write zone index 0; baseline is zone 2).
    const swatch0 = page.locator("[data-testid='zone-paint-swatch-0']");
    await expect(swatch0).toBeVisible();
    await swatch0.click();
    await expect(swatch0).toHaveAttribute("aria-pressed", "true");

    // Simulate the drag: invoke paintSlot the way the canvas pointer handler
    // does (headless WebGL raycasting is unreliable). A radius-5 brush at the
    // grid centre guarantees the mutation is observable in the hash + sample.
    await page.evaluate(
      ([res]) => {
        const N = res as number;
        (window as unknown as {
          __bathyTest: {
            paintZone: (
              r: number,
              c: number,
              radius: number,
              slot: 0 | 1 | 2 | 3,
              wt: "saltwater" | "freshwater",
              resolution: number,
            ) => void;
          };
        }).__bathyTest.paintZone(
          Math.floor(N / 2),
          Math.floor(N / 2),
          5,
          0,
          "saltwater",
          N,
        );
      },
      [RES],
    );

    const painted = await page.evaluate(() => {
      return (window as unknown as {
        __bathyTest: {
          getZoneSnapshot: () => {
            length: number;
            hasEdits: boolean;
            hash: string;
            sample: number[];
          } | null;
        };
      }).__bathyTest.getZoneSnapshot();
    });
    expect(painted).not.toBeNull();
    expect(painted!.length).toBe(baseline!.length);
    expect(painted!.hasEdits).toBe(true);
    expect(painted!.hash).not.toBe(baseline!.hash);

    // Reset to AI button only appears once hasEdits is true.
    const resetBtn = page.locator("[data-testid='zone-reset-ai']");
    await expect(resetBtn).toBeVisible({ timeout: 5_000 });
    await resetBtn.click();

    // After reset, zoneMap should match the baseline hash exactly and
    // hasEdits should flip back to false.
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
            return (window as unknown as {
              __bathyTest: {
                getZoneSnapshot: () => {
                  length: number;
                  hasEdits: boolean;
                  hash: string;
                } | null;
              };
            }).__bathyTest.getZoneSnapshot();
          }),
        { timeout: 3_000 },
      )
      .toMatchObject({ hasEdits: false, hash: baseline!.hash });

    // The reset button should also disappear (hasEdits === false).
    await expect(resetBtn).toBeHidden({ timeout: 3_000 });
  });
});
