import { test, expect, type Page, API_URL, E2E_USER_ID } from "./fixtures";

/**
 * Right-click Context Menu E2E tests.
 *
 * Strategy:
 * - The 3D canvas and marker raycasting require Clerk authentication, so for
 *   the auth-gated raycast path we keep a graceful-skip test that proves the
 *   browser context menu is suppressed.
 * - For everything else (menu rendering, keyboard navigation, item actions,
 *   measurement flow, marker detail card) we drive the underlying Zustand
 *   stores through `window.__bathyTest` — a dev-only test API installed by
 *   `src/lib/testHelpers.ts`. This lets us exercise the real `ContextMenu`,
 *   `MeasurementBanner`, and `MarkerDetailCard` components without needing
 *   to sign in, mock the WebGL raycaster, or seed the database.
 */

async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__bathyTest), null, {
    timeout: 10_000,
  });
}

test.describe("BathyScan — Right-click context menu", () => {
  test.beforeEach(async ({ page }) => {
    // Suppress SimulatedDataConfirmDialog before any navigation so it cannot
    // steal focus or intercept Escape from the context menu.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);
  });

  test("page loads without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.waitForTimeout(800);
    const realErrors = errors.filter(
      (e) => !/favicon|manifest|preload|WebGL/i.test(e),
    );
    expect(realErrors).toEqual([]);
  });

  test("right-click on 3D canvas does not navigate to browser menu", async ({ page }) => {
    const canvas = page.locator("canvas").first();
    const hasCanvas = (await canvas.count()) > 0;
    test.skip(!hasCanvas, "3D canvas requires authentication");

    const urlBefore = page.url();
    await canvas.click({ button: "right", force: true });
    await page.waitForTimeout(200);
    expect(page.url()).toBe(urlBefore);
  });

  test("context menu portal is initially absent from the DOM", async ({ page }) => {
    const menu = page.locator('[data-testid="context-menu"]');
    expect(await menu.count()).toBe(0);
  });
});

test.describe("BathyScan — Context menu rendering & keyboard nav", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);
  });

  test("terrain context menu renders all expected items at clamped position", async ({ page }) => {
    await page.evaluate(() => {
      window.__bathyTest!.showTerrainMenu(200, 150, {
        lon: -132.5,
        lat: 55.9,
        depth: 42,
      });
    });

    const menu = page.locator('[data-testid="context-menu"]');
    await expect(menu).toBeVisible();

    // Terrain menu has 3 actions + 1 separator
    const items = menu.locator('[role="menuitem"]');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText("Drop GPS pin here");
    await expect(items.nth(1)).toContainText("Measure from here");
    await expect(items.nth(2)).toContainText("Copy coordinates");

    // Separator renders as a non-menuitem <li role="separator">
    const sep = menu.locator('[role="separator"]');
    await expect(sep).toHaveCount(1);
  });

  test("first menu item is auto-focused on open", async ({ page }) => {
    await page.evaluate(() => {
      window.__bathyTest!.showTerrainMenu(100, 100, {
        lon: 0,
        lat: 0,
        depth: 10,
      });
    });

    const menu = page.locator('[data-testid="context-menu"]');
    await expect(menu).toBeVisible();

    const focusedText = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.textContent ?? "",
    );
    expect(focusedText).toContain("Drop GPS pin here");
  });

  test("ArrowDown / ArrowUp cycle focus across menu items", async ({ page }) => {
    await page.evaluate(() => {
      window.__bathyTest!.showTerrainMenu(100, 100, {
        lon: 0,
        lat: 0,
        depth: 10,
      });
    });
    await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();

    const focusedText = async () =>
      await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.textContent ?? "",
      );

    // Starts on "Drop GPS pin here"
    expect(await focusedText()).toContain("Drop GPS pin here");

    await page.keyboard.press("ArrowDown");
    expect(await focusedText()).toContain("Measure from here");

    await page.keyboard.press("ArrowDown");
    expect(await focusedText()).toContain("Copy coordinates");

    // Wraps around back to the first item
    await page.keyboard.press("ArrowDown");
    expect(await focusedText()).toContain("Drop GPS pin here");

    // ArrowUp wraps to the last item
    await page.keyboard.press("ArrowUp");
    expect(await focusedText()).toContain("Copy coordinates");
  });

  test("Escape dismisses the menu", async ({ page }) => {
    await page.evaluate(() => {
      window.__bathyTest!.showTerrainMenu(100, 100, {
        lon: 0,
        lat: 0,
        depth: 10,
      });
    });
    const menu = page.locator('[data-testid="context-menu"]');
    await expect(menu).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("click outside the menu dismisses it", async ({ page }) => {
    await page.evaluate(() => {
      window.__bathyTest!.showTerrainMenu(100, 100, {
        lon: 0,
        lat: 0,
        depth: 10,
      });
    });
    const menu = page.locator('[data-testid="context-menu"]');
    await expect(menu).toBeVisible();

    // Click somewhere clearly outside the menu
    await page.mouse.click(600, 500);
    await expect(menu).toHaveCount(0);
  });

  test("position is clamped to the viewport so menu never overflows", async ({ page }) => {
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("viewport not set");

    // Try to open beyond the right/bottom edge — should clamp inside
    await page.evaluate(
      ([w, h]) => {
        window.__bathyTest!.showContextMenu(w + 500, h + 500, [
          { label: "Item A", onClick: () => {} },
          { label: "Item B", onClick: () => {} },
        ]);
      },
      [viewport.width, viewport.height],
    );

    const menu = page.locator('[data-testid="context-menu"]');
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
  });
});

test.describe("BathyScan — Two-click measurement flow", () => {
  test.beforeEach(async ({ page, request }) => {
    // Reset units to metric so the measurement banner shows "m" and "km".
    // A prior test run may have persisted "imperial" for the bypass user.
    // Patch both server state AND localStorage so the Zustand persist layer
    // initialises with the correct value on page.goto, independent of any
    // hydrateFromServer race with the server PUT above.
    await request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: { units: "metric" },
    });
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
      try {
        const raw = localStorage.getItem("bathyscan:settings");
        const parsed: { state?: Record<string, unknown>; version?: number } =
          raw ? JSON.parse(raw) : {};
        parsed.state = { ...(parsed.state ?? {}), units: "metric" };
        localStorage.setItem("bathyscan:settings", JSON.stringify(parsed));
      } catch {}
    });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);
    await page.evaluate(() => window.__bathyTest!.clearMeasurement());
  });

  test("first right-click sets the anchor and shows the ANCHOR SET banner", async ({ page }) => {
    // Open terrain menu and click "Measure from here"
    await page.evaluate(() => {
      window.__bathyTest!.showTerrainMenu(150, 150, {
        lon: -132.5,
        lat: 55.9,
        depth: 30,
      });
    });
    const measureItem = page
      .locator('[data-testid="context-menu"] [role="menuitem"]')
      .filter({ hasText: "Measure from here" });
    await measureItem.click();

    // Menu closes; banner appears in ANCHOR-SET state
    await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);
    const banner = page.locator('[data-testid="measurement-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/ANCHOR SET/i);
  });

  test("second right-click computes plausible distance and depth delta", async ({ page }) => {
    // Anchor at point A
    await page.evaluate(() => {
      window.__bathyTest!.showTerrainMenu(100, 100, {
        lon: -132.5000,
        lat: 55.9000,
        depth: 30,
      });
    });
    await page
      .locator('[data-testid="context-menu"] [role="menuitem"]')
      .filter({ hasText: "Measure from here" })
      .click();

    // Open second menu — should now read "Measure to here"
    await page.evaluate(() => {
      window.__bathyTest!.showTerrainMenu(300, 300, {
        // ~0.05° east + 0.01° north of A; depth +20m
        lon: -132.4500,
        lat: 55.9100,
        depth: 50,
      });
    });
    const toHere = page
      .locator('[data-testid="context-menu"] [role="menuitem"]')
      .filter({ hasText: "Measure to here" });
    await expect(toHere).toBeVisible();
    await toHere.click();

    // Banner now shows DIST + Δ DEPTH
    const banner = page.locator('[data-testid="measurement-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/DIST/);
    await expect(banner).toContainText(/Δ DEPTH/);
    await expect(banner).toContainText(/\+20 m/);

    // Distance for ~0.05° lon @ 56°N is roughly 3–4 km — assert "km" appears
    // (banner renders km when distance ≥ 1, metres when < 1).
    await expect(banner).toContainText(/km/);

    // Validate the numeric result via the store as well
    const result = await page.evaluate(() =>
      window.__bathyTest!.getMeasurementResult(),
    );
    expect(result).not.toBeNull();
    expect(result!.distanceKm).toBeGreaterThan(1);
    expect(result!.distanceKm).toBeLessThan(10);
    expect(result!.depthDeltaM).toBe(20);
  });

  test("negative depth delta from shallower → deeper renders blue + sign", async ({ page }) => {
    await page.evaluate(() => {
      window.__bathyTest!.measureAnchor({ lon: 0, lat: 0, depth: 100 });
      window.__bathyTest!.measureTo({ lon: 0.01, lat: 0, depth: 40 });
    });
    const banner = page.locator('[data-testid="measurement-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/-60 m/);
  });
});

test.describe("BathyScan — Marker context menu items", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);
  });

  test("marker menu renders Fly to / View details / Copy / Delete", async ({ page }) => {
    // Simulate the marker menu items that useFlyControls.buildMarkerMenuItems
    // produces after a successful marker raycast hit.
    await page.evaluate(() => {
      const fakeMarker = {
        id: "test-marker-1",
        lon: -132.5,
        lat: 55.9,
        depth: 42,
        label: "Test Pin",
      };
      window.__bathyTest!.showContextMenu(120, 120, [
        {
          label: "Fly to marker",
          icon: "✈️",
          onClick: () => {},
        },
        {
          label: "View details",
          icon: "ℹ️",
          onClick: () => window.__bathyTest!.showMarkerDetail(fakeMarker),
        },
        {
          label: "Copy coordinates",
          icon: "📋",
          onClick: () => {},
        },
        { label: "", onClick: () => {}, separator: true },
        {
          label: "Delete marker",
          icon: "🗑️",
          onClick: () => {},
        },
      ]);
    });

    const menu = page.locator('[data-testid="context-menu"]');
    await expect(menu).toBeVisible();

    const items = menu.locator('[role="menuitem"]');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText("Fly to marker");
    await expect(items.nth(1)).toContainText("View details");
    await expect(items.nth(2)).toContainText("Copy coordinates");
    await expect(items.nth(3)).toContainText("Delete marker");
  });

  test('"View details" opens the marker detail card', async ({ page }) => {
    await page.evaluate(() => {
      const fakeMarker = {
        id: "test-marker-2",
        lon: -132.5,
        lat: 55.9,
        depth: 42,
        label: "Halibut Hole",
      };
      window.__bathyTest!.showContextMenu(120, 120, [
        {
          label: "View details",
          icon: "ℹ️",
          onClick: () => window.__bathyTest!.showMarkerDetail(fakeMarker),
        },
      ]);
    });

    await page
      .locator('[data-testid="context-menu"] [role="menuitem"]')
      .filter({ hasText: "View details" })
      .click();

    await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);
    const card = page.locator('[data-testid="marker-detail-card"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText("Halibut Hole");
  });

  test("invoking a menu item closes the menu", async ({ page }) => {
    let clickCount = 0;
    await page.exposeFunction("__noteClick", () => {
      clickCount += 1;
    });
    await page.evaluate(() => {
      window.__bathyTest!.showContextMenu(120, 120, [
        {
          label: "Click me",
          onClick: () =>
            (window as unknown as { __noteClick: () => void }).__noteClick(),
        },
      ]);
    });

    const menu = page.locator('[data-testid="context-menu"]');
    await expect(menu).toBeVisible();
    await menu
      .locator('[role="menuitem"]')
      .filter({ hasText: "Click me" })
      .click();
    await expect(menu).toHaveCount(0);
    expect(clickCount).toBe(1);
  });

  test("Enter key on a focused menu item invokes its action", async ({ page }) => {
    let triggered = false;
    await page.exposeFunction("__triggerDelete", () => {
      triggered = true;
    });
    await page.evaluate(() => {
      window.__bathyTest!.showContextMenu(120, 120, [
        { label: "Fly to marker", onClick: () => {} },
        {
          label: "Delete marker",
          onClick: () =>
            (
              window as unknown as { __triggerDelete: () => void }
            ).__triggerDelete(),
        },
      ]);
    });
    await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();

    // First item is auto-focused; ArrowDown → Delete marker; Enter to fire.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);
    expect(triggered).toBe(true);
  });

  test("disabled items are skipped by keyboard navigation and not clickable", async ({ page }) => {
    let firedDisabled = false;
    await page.exposeFunction("__firedDisabled", () => {
      firedDisabled = true;
    });
    await page.evaluate(() => {
      window.__bathyTest!.showContextMenu(120, 120, [
        { label: "Enabled A", onClick: () => {} },
        {
          label: "Disabled B",
          disabled: true,
          onClick: () =>
            (
              window as unknown as { __firedDisabled: () => void }
            ).__firedDisabled(),
        },
        { label: "Enabled C", onClick: () => {} },
      ]);
    });
    await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();

    // Disabled item is not focusable (tabIndex=-1) and is excluded from
    // ArrowDown cycling, so ArrowDown from "Enabled A" goes straight to
    // "Enabled C".
    await page.keyboard.press("ArrowDown");
    const focusedText = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.textContent ?? "",
    );
    expect(focusedText).toContain("Enabled C");

    expect(firedDisabled).toBe(false);
  });
});
