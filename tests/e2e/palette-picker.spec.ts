import { test, expect } from "./fixtures";

/**
 * Task #192 — end-to-end coverage for the depth palette picker.
 *
 * Verifies the full loop: visiting /settings, changing the deep colour,
 * and the main 3D scene's HUD depth scale bar re-painting with the new
 * gradient. Unit/component tests already cover the colormap helper and
 * the scale-bar component in isolation; this spec is the missing
 * surface-level proof that the wiring through paletteStore → colormap →
 * DepthScaleBar holds together in a real browser.
 *
 * Strategy: the DepthScaleBar renders an <img alt="depth colormap"> whose
 * `src` is a data: URL generated from the current palette. Sampling the
 * deepest pixel of that gradient after picking a known-red deep colour
 * is a deterministic, pixel-level way to assert the scale bar (and
 * therefore the colormap pipeline that also feeds the terrain mesh) did
 * actually re-render with the user's new colour.
 *
 * Navigation note: we land on `/` first, let terrain load, then use
 * in-app (SPA) navigation to `/settings` and back via ← BACK. Hard
 * `page.goto("/")` would reset AppState and the depth scale bar would
 * remount before terrain reloads — its src-painting effect only re-fires
 * when shallow/deep/colormapTheme change, so on a fresh mount with no
 * terrain the src would still be empty. SPA navigation preserves the
 * AppState (terrain stays loaded) so the new palette is picked up.
 *
 * The bar only mounts once terrain has loaded, so the spec skips
 * gracefully when the main scene isn't reachable in this environment —
 * matching the convention used by the other canvas-gated specs.
 */

test.describe("Depth palette picker — end-to-end", () => {
  test("changing the deep colour repaints the HUD depth scale bar", async ({ page }) => {
    // 1. Land on the main scene and wait for the depth scale bar (which
    //    requires `terrain` to be loaded into AppState).
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const scaleBar = page.locator('img[alt="depth colormap"]');
    // Terrain has to load from the API before the depth scale bar mounts;
    // first-request fetches can take a while when caches are cold.
    const barVisible = await scaleBar
      .waitFor({ state: "visible", timeout: 25_000 })
      .then(() => true)
      .catch(() => false);
    if (!barVisible) {
      test.skip(true, "Depth scale bar not visible — terrain not loaded in this environment");
      return;
    }

    // 2. SPA-navigate to /settings via the topbar Settings button so
    //    AppState (and the loaded terrain) is preserved across the
    //    transition back to `/`.
    await page.locator('button[aria-label="Settings"], button:has-text("Settings")').first().dispatchEvent("click");
    await page.waitForURL((url) => url.pathname.endsWith("/settings"), { timeout: 5_000 });
    await expect(page.locator("text=◈ DEPTH COLOR PALETTE")).toBeVisible({ timeout: 10_000 });

    // The depth-scale bar paints whichever colormap theme is active, and the
    // Ocean theme is the only one whose deepest stop is sourced from the
    // user-editable palette (the other presets have fixed stops). Force the
    // theme to "ocean" first so the deep-colour pick below is what the bar
    // actually paints — otherwise dev-user-bypass settings persisted from a
    // previous test run (e.g. "freshwater" after a Lake Fork preset) would
    // make the bottom of the bar ignore our palette change.
    const colormapTrigger = page.getByTestId("depth-colormap-select");
    await expect(colormapTrigger).toBeVisible({ timeout: 10_000 });
    if ((await colormapTrigger.getAttribute("data-value")) !== "ocean") {
      await colormapTrigger.dispatchEvent("click");
      await page
        .locator(`ul[role="listbox"] li[role="option"]`)
        .filter({ hasText: /Ocean/i })
        .first()
        .dispatchEvent("click");
      await expect(colormapTrigger).toHaveAttribute("data-value", "ocean", {
        timeout: 5_000,
      });
    }

    const deepHex = page.locator('[data-testid="palette-deep-hex"]');
    await expect(deepHex).toBeVisible();

    // 3. Pick a deep colour that is visibly different from the default
    //    (#283593 indigo) — bright red guarantees the gradient changes.
    const newDeep = "#ff0000";
    await deepHex.fill(newDeep);
    // The hex input commits to paletteStore only when the value matches
    // /^#[0-9a-fA-F]{6}$/; blurring is not required but cheap insurance.
    await deepHex.blur();

    // The in-page palette preview should redraw immediately — this also
    // confirms the colormap pipeline saw the new shallow/deep values
    // before we navigate away.
    const preview = page.locator('[data-testid="palette-preview"]');
    await expect(preview).toBeVisible();
    await expect
      .poll(async () => (await preview.getAttribute("src")) ?? "", { timeout: 5_000 })
      .toMatch(/^data:image\/png/);

    // 4. SPA-navigate back to the main scene via ← BACK and assert the
    //    HUD scale bar repainted with the new gradient.
    await page.locator("text=← BACK").dispatchEvent("click");
    await page.waitForURL((url) => !url.pathname.endsWith("/settings"), { timeout: 5_000 });

    const scaleBar2 = page.locator('img[alt="depth colormap"]');
    await expect(scaleBar2).toBeVisible({ timeout: 15_000 });

    await expect
      .poll(async () => (await scaleBar2.getAttribute("src")) ?? "", { timeout: 10_000 })
      .toMatch(/^data:image\/png/);

    // 5. Pixel-level assertion: decode the new scale-bar PNG in the
    //    browser and confirm the bottom of the bar (deepest depth) is
    //    dominantly red, matching the #ff0000 we just picked. This
    //    proves the colormap pipeline picked up the new deep colour
    //    rather than only re-rendering for an unrelated reason.
    const newSrc = (await scaleBar2.getAttribute("src"))!;
    const bottomPixel = await page.evaluate(
      (src) =>
        new Promise<{ r: number; g: number; b: number }>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement("canvas");
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext("2d")!;
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(
              Math.floor(img.naturalWidth / 2),
              img.naturalHeight - 1,
              1,
              1,
            ).data;
            resolve({ r: data[0]!, g: data[1]!, b: data[2]! });
          };
          img.onerror = () => reject(new Error("scale bar image failed to decode"));
          img.src = src;
        }),
      newSrc,
    );
    expect(bottomPixel.r).toBeGreaterThan(150);
    expect(bottomPixel.g).toBeLessThan(80);
    expect(bottomPixel.b).toBeLessThan(80);

    // 6. Clean up so a re-run of the suite starts from defaults.
    await page.locator('button[aria-label="Settings"], button:has-text("Settings")').first().dispatchEvent("click");
    await page.waitForURL((url) => url.pathname.endsWith("/settings"), { timeout: 5_000 });
    await page.locator('[data-testid="palette-reset-btn"]').dispatchEvent("click");
  });
});
