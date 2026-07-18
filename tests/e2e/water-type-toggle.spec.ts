import { test, expect, API_URL, E2E_USER_ID } from "./fixtures";

/**
 * Water-type toggle end-to-end test.
 *
 * Verifies the full freshwater/saltwater switching flow wired in App.tsx
 * (waterType subscription around lines 229–285):
 *   - clicking the WaterTypeToggle updates the active button state
 *   - the DatasetPanel filters to datasets of the new water type
 *     (demo/freshwater preset appears when freshwater is active)
 *   - the depth colormap auto-switches from "ocean" → "freshwater"
 *     (the scene hue proxy — terrain mesh and depth bar are keyed by it)
 *   - switching back to saltwater restores the ocean colormap and hides
 *     the freshwater demo preset
 *
 * The toggle and DatasetPanel only mount once the user is signed in.
 * The e2e webServer sets VITE_DEV_AUTH_BYPASS=1 so the canvas-gated UI
 * renders during tests; if it isn't visible the suite skips rather than
 * failing the run.
 */

const FRESHWATER_DATASET = "btn-dataset-lake-ray-roberts";

test.describe("Water-type toggle", () => {
  test("switching to freshwater and back updates UI, datasets, and colormap", async ({ page }) => {
    test.setTimeout(120_000);

    // Reset the dev user's persisted waterType to a known baseline
    // ("saltwater") before the page loads. The dev-auth bypass on the API
    // server matches on the `x-e2e-user-id` header that the frontend's
    // devAuth helper injects on every fetch; sending the same header here
    // targets the same row.
    // Patch both server state AND localStorage so the Zustand persist layer
    // initialises with the correct waterType on page.goto, independent of any
    // hydrateFromServer race with the server PUT above.
    await page.request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: { waterType: "saltwater", colormapTheme: "ocean" },
    });

    // Suppress SimulatedDataConfirmDialog so it cannot block water-type
    // button clicks or intercept the PUT /api/settings round-trip.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
      try {
        const raw = localStorage.getItem("bathyscan:settings");
        const parsed: { state?: Record<string, unknown>; version?: number } =
          raw ? JSON.parse(raw) : {};
        parsed.state = {
          ...(parsed.state ?? {}),
          waterType: "saltwater",
          colormapTheme: "ocean",
        };
        localStorage.setItem("bathyscan:settings", JSON.stringify(parsed));
      } catch {}
    });

    await page.goto("/");

    const saltBtn = page.locator('[data-testid="water-type-saltwater"]');
    const freshBtn = page.locator('[data-testid="water-type-freshwater"]');

    // The toggle only mounts inside DatasetPanel, which itself only renders
    // when the user is signed in. With VITE_DEV_AUTH_BYPASS=1 this is the
    // expected state; if it isn't, skip gracefully.
    const toggleVisible = await saltBtn.isVisible({ timeout: 20_000 }).catch(() => false);
    if (!toggleVisible) {
      test.skip(true, "Water-type toggle not visible — user is not signed in; landing page is shown");
      return;
    }
    await expect(freshBtn).toBeVisible();

    // ---- Sanity: starts in saltwater mode ---------------------------------
    // The active button uses its theme color (#00e5ff for salt), inactive
    // collapses to #475569. Compare via computed style.
    const activeSaltColor = await saltBtn.evaluate((el) => getComputedStyle(el).color);
    const inactiveFreshColor = await freshBtn.evaluate((el) => getComputedStyle(el).color);
    expect(activeSaltColor).not.toBe(inactiveFreshColor);

    // Confirm the default colormap is "ocean" by visiting Settings.
    await page.goto("/settings");
    const colormapSelect = page.locator('[data-testid="depth-colormap-select"]');
    await expect(colormapSelect).toBeVisible({ timeout: 15_000 });
    await expect(colormapSelect).toHaveAttribute("data-value", "ocean");
    await expect(colormapSelect).toContainText("Ocean (blue)");

    // ---- Switch to freshwater ---------------------------------------------
    await page.goto("/");
    await expect(freshBtn).toBeVisible({ timeout: 20_000 });
    await freshBtn.dispatchEvent("click");

    // Freshwater button now wears its theme color (#4ade80); saltwater dims
    // to the inactive slate color. Wait for the style transition to settle.
    await expect
      .poll(async () => saltBtn.evaluate((el) => getComputedStyle(el).color), {
        timeout: 10_000,
      })
      .not.toBe(activeSaltColor);
    // The auto-debounced PUT /api/settings for the colormap side-effect runs
    // ~300 ms after the click. Wait for it to flush before navigating to
    // /settings so the page re-hydrates from the server with the new value
    // instead of catching the pre-flip "ocean" state.
    await page.waitForTimeout(3000);
    const activeFreshColor = await freshBtn.evaluate((el) => getComputedStyle(el).color);
    const inactiveSaltColor = await saltBtn.evaluate((el) => getComputedStyle(el).color);
    expect(activeFreshColor).not.toBe(inactiveSaltColor);
    // The fresh button's color flipped from inactive → its active hue.
    expect(activeFreshColor).not.toBe(inactiveFreshColor);

    // DatasetPanel filters by waterType: the freshwater demo preset appears.
    await expect(page.locator(`[data-testid="${FRESHWATER_DATASET}"]`)).toBeVisible({ timeout: 10_000 });

    // Scene-hue proxy: the colormap auto-switched from "ocean" → "freshwater".
    // Check the in-memory Zustand store directly via the TestBridge so we
    // avoid navigating to /settings (which triggers a GET /api/settings that
    // re-hydrates the store with the server's stale "ocean" value before our
    // assertion can fire).
    await expect
      .poll(
        async () => await page.evaluate(() => window.__bathyTest!.getColormapTheme()),
        { timeout: 5_000 },
      )
      .toBe("freshwater");

    // ---- Switch back to saltwater -----------------------------------------
    await page.goto("/");
    await expect(saltBtn).toBeVisible({ timeout: 20_000 });
    await saltBtn.dispatchEvent("click");

    // Freshwater demo preset is filtered out again (saltwater mode, no saltwater presets).
    await expect(page.locator(`[data-testid="${FRESHWATER_DATASET}"]`)).toHaveCount(0, { timeout: 10_000 });

    // Colormap restored to "ocean", verified via the in-memory Zustand store.
    await expect
      .poll(
        async () => await page.evaluate(() => window.__bathyTest!.getColormapTheme()),
        { timeout: 5_000 },
      )
      .toBe("ocean");
  });
});
