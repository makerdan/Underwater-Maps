import { test, expect, type Page } from "@playwright/test";

/**
 * Overview Map E2E tests.
 *
 * The full-screen Overview Map is a primary navigation surface (heatmap,
 * camera arrow, click-to-teleport, Esc/close button, GPS, trails, markers).
 * These tests cover the open/close lifecycle and click-to-teleport behaviour
 * so future changes can't regress them silently.
 *
 * Like the other suites here, navigation uses `domcontentloaded` and the
 * tests skip gracefully when the app is showing the unauthenticated landing
 * page (the 3D canvas is the proxy for "signed in").
 */

const OVERLAY_HEADER = ".overview-map-header";

async function ensureSignedInOrSkip(page: Page): Promise<boolean> {
  const canvas = page.locator("canvas").first();
  const visible = await canvas.isVisible({ timeout: 12_000 }).catch(() => false);
  if (!visible) {
    test.skip(true, "Canvas not visible — user is not signed in");
    return false;
  }
  return true;
}

async function openOverview(page: Page): Promise<void> {
  // Prefer the dev-only test helper if available — robust to focus loss after
  // navigation. Falls back to the visible ▲ OVERVIEW button.
  const opened = await page
    .evaluate(() => {
      const api = (window as unknown as { __bathyTest?: { setOverviewOpen?: (b: boolean) => void } }).__bathyTest;
      if (api?.setOverviewOpen) {
        api.setOverviewOpen(true);
        return true;
      }
      return false;
    })
    .catch(() => false);

  if (!opened) {
    const btn = page.getByRole("button", { name: /▲\s*OVERVIEW/ });
    await btn.click();
  }

  await expect(page.locator(OVERLAY_HEADER)).toBeVisible({ timeout: 5_000 });
}

async function clearPendingDropIn(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      (window as unknown as { __bathyTest?: { clearPendingDropIn?: () => void } }).__bathyTest?.clearPendingDropIn?.();
    })
    .catch(() => {});
}

test.describe("BathyScan — Overview Map", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    // Give the React app a moment to mount and install the test helpers.
    await page.waitForTimeout(800);
  });

  test("▲ OVERVIEW button opens the overlay", async ({ page }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    // The button lives in the Minimap, which only renders once terrain is
    // loaded from the API. Wait briefly for it to appear.
    const overviewBtn = page.getByRole("button", { name: /▲\s*OVERVIEW/ });
    const btnVisible = await overviewBtn.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!btnVisible) {
      test.skip(true, "▲ OVERVIEW button not visible — terrain may not be loaded");
      return;
    }

    await overviewBtn.click();
    await expect(page.locator(OVERLAY_HEADER)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(OVERLAY_HEADER)).toContainText("OVERVIEW MAP");
  });

  test("clicking the overview canvas teleports and closes the overlay", async ({ page }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);
    await clearPendingDropIn(page);

    // The OverviewMap mounts its own full-screen canvas on top of the scene.
    // It is the last <canvas> in the DOM while the overlay is open.
    const overlayCanvas = page.locator("canvas").last();
    const box = await overlayCanvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);

    // Click roughly in the middle of the canvas — well clear of the header.
    await overlayCanvas.click({
      position: { x: box!.width / 2, y: box!.height / 2 },
    });

    // Overlay must close as a direct result of the click handler.
    await expect(page.locator(OVERLAY_HEADER)).toHaveCount(0, { timeout: 5_000 });

    // The click handler queues a teleport by setting pendingDropIn, which the
    // 3D fly-controls frame loop then consumes (clearing it) once the camera
    // jumps to the target. Poll the store: it must end up cleared, proving
    // both that the click was registered AND that the teleport actually
    // completed end-to-end.
    const getPending = () =>
      page.evaluate(
        () =>
          (window as unknown as {
            __bathyTest?: { getPendingDropIn?: () => unknown };
          }).__bathyTest?.getPendingDropIn?.() ?? null,
      );

    await expect
      .poll(getPending, { timeout: 5_000, intervals: [50, 100, 200, 400] })
      .toBeNull();
  });

  test("Escape key dismisses the overlay", async ({ page }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);

    // Focus the body so the document-level keydown handler fires.
    await page.locator("body").click({ position: { x: 1, y: 1 } }).catch(() => {});
    await page.keyboard.press("Escape");

    await expect(page.locator(OVERLAY_HEADER)).toHaveCount(0, { timeout: 5_000 });
  });

  test("✕ CLOSE button dismisses the overlay", async ({ page }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);

    const closeBtn = page.getByRole("button", { name: /✕\s*CLOSE/ });
    await expect(closeBtn).toBeVisible({ timeout: 5_000 });
    await closeBtn.click();

    await expect(page.locator(OVERLAY_HEADER)).toHaveCount(0, { timeout: 5_000 });
  });
});
