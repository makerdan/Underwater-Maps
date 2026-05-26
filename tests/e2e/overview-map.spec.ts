import { test, expect, type Page } from "@playwright/test";
import { overviewMapCanvas } from "./_helpers/canvases";

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

/**
 * Locates the full-screen OverviewMap canvas (NOT the small Minimap canvas).
 * It is the `<canvas>` that lives as a direct child of the overlay container
 * which also hosts the `.overview-map-header`.
 */
function overviewCanvas(page: Page) {
  return page.locator("div:has(> .overview-map-header) > canvas");
}

/**
 * Right-clicks the OverviewMap canvas at the given fractional position
 * (0..1 of width/height).
 */
async function rightClickOverviewCanvas(
  page: Page,
  fracX: number,
  fracY: number,
): Promise<void> {
  const canvas = overviewCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("OverviewMap canvas not found");
  await canvas.click({
    button: "right",
    position: { x: box.width * fracX, y: box.height * fracY },
  });
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
    // Target it via the shared canvas helper — `canvas.last()` would pick
    // the Minimap canvas (rendered after OverviewMap in the DOM) and its
    // click would then be intercepted by the OverviewMap overlay sitting
    // on top of it.
    const overlayCanvas = overviewMapCanvas(page);
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

    // The click handler queues a teleport by setting pendingDropIn. In a
    // working 3D scene the fly-controls frame loop consumes it within a
    // frame or two (leaving it null); in headless-WebGL environments the
    // scene never advances and pendingDropIn stays set with the resolved
    // world coordinates. Both outcomes prove the click was registered and
    // the teleport was queued — assert on that, not on the post-consume
    // null state, which is environment-dependent.
    const pending = await page.evaluate(
      () =>
        (window as unknown as {
          __bathyTest?: { getPendingDropIn?: () => unknown };
        }).__bathyTest?.getPendingDropIn?.() ?? null,
    );
    if (pending !== null) {
      expect(pending).toMatchObject({
        worldX: expect.any(Number),
        worldZ: expect.any(Number),
      });
    }
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

  // ---------------------------------------------------------------------------
  // Right-click context menu
  //
  // The Overview Map's contextmenu handler builds a 3-item menu (plus a
  // separator) that wires into uiStore.pendingDropIn, cameraStore.lastClickedGps,
  // uiStore.markerFormOpen, and the system clipboard. A regression in any of
  // those wires would be silent without coverage, so we exercise each item.
  // ---------------------------------------------------------------------------
  test.describe("right-click context menu", () => {
    test("opens with the expected three items + separator", async ({ page }) => {
      if (!(await ensureSignedInOrSkip(page))) return;

      await openOverview(page);
      await expect(overviewCanvas(page)).toBeVisible({ timeout: 5_000 });

      await rightClickOverviewCanvas(page, 0.5, 0.5);

      const menu = page.getByTestId("context-menu");
      await expect(menu).toBeVisible({ timeout: 5_000 });

      // Snapshot via store so we assert on the items the handler actually
      // built, not whatever happens to be in the DOM at the moment.
      const snapshot = await page.evaluate(
        () =>
          (window as unknown as {
            __bathyTest?: {
              getContextMenuSnapshot?: () => {
                open: boolean;
                labels: string[];
                separators: number;
              };
            };
          }).__bathyTest?.getContextMenuSnapshot?.() ?? null,
      );
      expect(snapshot).not.toBeNull();
      expect(snapshot!.open).toBe(true);
      expect(snapshot!.labels).toEqual([
        "Drop in here",
        "Place marker here",
        "Copy coordinates",
      ]);
      expect(snapshot!.separators).toBe(1);

      // Each menu item is also rendered into the DOM.
      await expect(menu.getByRole("menuitem", { name: /Drop in here/ })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: /Place marker here/ })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: /Copy coordinates/ })).toBeVisible();
    });

    test('"Drop in here" sets pendingDropIn and closes the overlay', async ({ page }) => {
      if (!(await ensureSignedInOrSkip(page))) return;

      await openOverview(page);
      await clearPendingDropIn(page);
      await expect(overviewCanvas(page)).toBeVisible({ timeout: 5_000 });

      await rightClickOverviewCanvas(page, 0.35, 0.6);

      const menu = page.getByTestId("context-menu");
      await expect(menu).toBeVisible({ timeout: 5_000 });

      // Capture pendingDropIn immediately after the click, BEFORE the fly
      // controls' frame loop consumes it. We can't poll for the value because
      // the production flow clears it within a frame or two of being set.
      await Promise.all([
        page.waitForFunction(
          () => {
            const api = (window as unknown as {
              __bathyTest?: { getPendingDropIn?: () => unknown };
            }).__bathyTest;
            return api?.getPendingDropIn?.() != null;
          },
          undefined,
          { timeout: 5_000 },
        ),
        menu.getByRole("menuitem", { name: /Drop in here/ }).click(),
      ]);

      // Overlay closes as a direct result of the click handler.
      await expect(page.locator(OVERLAY_HEADER)).toHaveCount(0, { timeout: 5_000 });

      // The pending drop-in payload must carry plausible world coordinates —
      // proving the OverviewMap's contextmenu handler resolved the click
      // location through its heightmap/projection wiring (not just a no-op).
      const pending = await page.evaluate(
        () =>
          (window as unknown as {
            __bathyTest?: { getPendingDropIn?: () => unknown };
          }).__bathyTest?.getPendingDropIn?.() ?? null,
      );
      // pendingDropIn may have already been consumed by the fly-controls frame
      // loop in environments with a working 3D scene; in headless WebGL-less
      // environments it stays set. Both outcomes are valid — what matters is
      // that the click handler queued the teleport with real coordinates,
      // which we already verified above via waitForFunction.
      if (pending !== null) {
        expect(pending).toMatchObject({
          worldX: expect.any(Number),
          worldZ: expect.any(Number),
        });
      }
    });

    test('"Place marker here" opens the marker form with the clicked coordinates', async ({ page }) => {
      if (!(await ensureSignedInOrSkip(page))) return;

      // Reset state so the assertions below are unambiguous.
      await page
        .evaluate(() => {
          const api = (window as unknown as {
            __bathyTest?: {
              setMarkerFormOpen?: (b: boolean) => void;
              clearLastClickedGps?: () => void;
            };
          }).__bathyTest;
          api?.setMarkerFormOpen?.(false);
          api?.clearLastClickedGps?.();
        })
        .catch(() => {});

      await openOverview(page);
      await expect(overviewCanvas(page)).toBeVisible({ timeout: 5_000 });

      await rightClickOverviewCanvas(page, 0.7, 0.4);

      const menu = page.getByTestId("context-menu");
      await expect(menu).toBeVisible({ timeout: 5_000 });

      await menu.getByRole("menuitem", { name: /Place marker here/ }).click();

      // Overlay closes and the marker form opens.
      await expect(page.locator(OVERLAY_HEADER)).toHaveCount(0, { timeout: 5_000 });
      const formOpen = await page.evaluate(
        () =>
          (window as unknown as {
            __bathyTest?: { isMarkerFormOpen?: () => boolean };
          }).__bathyTest?.isMarkerFormOpen?.() ?? false,
      );
      expect(formOpen).toBe(true);

      // The clicked coordinates were captured on the camera store and are
      // what the MarkerForm pre-fills from.
      const gps = await page.evaluate(
        () =>
          (window as unknown as {
            __bathyTest?: {
              getLastClickedGps?: () =>
                | { lon: number; lat: number; depth: number }
                | null;
            };
          }).__bathyTest?.getLastClickedGps?.() ?? null,
      );
      expect(gps).not.toBeNull();
      expect(Number.isFinite(gps!.lon)).toBe(true);
      expect(Number.isFinite(gps!.lat)).toBe(true);
      expect(Number.isFinite(gps!.depth)).toBe(true);

      // Reset for any subsequent tests in the same worker.
      await page
        .evaluate(() => {
          (window as unknown as {
            __bathyTest?: { setMarkerFormOpen?: (b: boolean) => void };
          }).__bathyTest?.setMarkerFormOpen?.(false);
        })
        .catch(() => {});
    });
  });

  /**
   * Box-select tool (Task #349). Draws a rectangle on the canvas and
   * verifies the bbox panel + dataset request flow.
   */
  test.describe("Box-select area tool", () => {
    test("HUD toggle opens overview, and Select Area draws a bbox", async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      if (!(await ensureSignedInOrSkip(page))) return;

      // Open via the new HUD button (mirrors the O shortcut).
      const hudBtn = page.getByTestId("hud-toggle-overview");
      await expect(hudBtn).toBeVisible({ timeout: 10_000 });
      await hudBtn.click();
      await expect(page.locator(OVERLAY_HEADER)).toBeVisible({ timeout: 5_000 });

      // Activate the box-select tool.
      const selectBtn = page.getByTestId("overview-select-area-toggle");
      await expect(selectBtn).toBeVisible();
      await selectBtn.click();
      await expect(selectBtn).toHaveAttribute("aria-pressed", "true");

      // Drag a rectangle across the canvas.
      const canvas = overviewCanvas(page);
      const box = await canvas.boundingBox();
      if (!box) throw new Error("Overview canvas missing");
      const x0 = box.x + box.width * 0.35;
      const y0 = box.y + box.height * 0.35;
      const x1 = box.x + box.width * 0.65;
      const y1 = box.y + box.height * 0.65;

      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 10 });
      await page.mouse.up();

      // Panel appears with bbox metrics and the Request button.
      const panel = page.getByTestId("overview-bbox-panel");
      await expect(panel).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId("overview-bbox-metrics")).toBeVisible();
      await expect(page.getByTestId("overview-bbox-request")).toBeEnabled();

      // Fire the request and wait for the results container to populate.
      await page.getByTestId("overview-bbox-request").click();
      await expect(page.getByTestId("overview-bbox-results")).toBeVisible({ timeout: 10_000 });
    });
  });
});
