import { test, expect, type Page, type Locator } from "./fixtures";

/**
 * Viewscreen tooltip end-to-end coverage (task #121).
 *
 * Unit tests already cover the settings store, the Settings page toggle and
 * the gating logic inside `ViewscreenTooltip`. These specs exercise the real
 * Radix tooltip against the live 3D scene to catch regressions that unit
 * tests can't see — pointer-events bleed through to the canvas, keyboard
 * focus not opening the tooltip, or the Settings toggle not taking effect
 * in the wider app.
 *
 * The FIND DATA HUD button is used as the wrapped control because it is
 * always rendered on the explorer when signed in (E2E auth bypass active)
 * and lives in the bottom-right HUD column, well clear of other overlays.
 *
 * Note: the headless Chromium used by this suite is launched with
 * `primaryPointerType=touch` (see playwright.config.ts launch args).
 * Radix Tooltip intentionally ignores touch-pointer hover (only focus
 * opens the tooltip on touch devices), so for the hover case we dispatch
 * a real `PointerEvent` with `pointerType: 'mouse'` to mirror what a
 * desktop user sees.
 */

const HUD_BUTTON = 'button:has-text("FIND DATA")';
const TOOLTIP_LABEL = "Browse datasets, markers and habitats";

/**
 * Force `showUiTooltips` to the desired value by walking the real Settings UI.
 * We expand the HUD "Advanced Settings" disclosure (whose toggle lives there)
 * by clicking its inner expander button by aria-expanded, then flip the row.
 *
 * When `returnHome` is true (default) we navigate to "/" afterwards so the
 * caller can interact with the HUD button under test, and we use that visit
 * to perform the canvas-visible sign-in check (skipping the test if the dev
 * auth bypass is inactive). This replaces the previous pattern of a separate
 * `ensureSignedIn()` helper that did its own throwaway `goto("/")` before
 * `setTooltipsViaSettings` immediately navigated away to `/settings`.
 */
async function setTooltipsViaSettings(
  page: Page,
  enabled: boolean,
  options: { returnHome?: boolean } = {},
) {
  const returnHome = options.returnHome ?? true;
  await page.goto("/settings");
  // No networkidle wait here — the explicit `expect(expander).toBeVisible`
  // below auto-waits for the DOM we actually depend on, and /settings still
  // streams several background fetches.
  await page.locator('button:has-text("HUD & LAYOUT")').first().click();

  // AdvancedDisclosure renders a <div data-testid="hud-advanced"> containing
  // a <button aria-expanded={open}> as its first child. Open it if closed.
  const expander = page.locator('[data-testid="hud-advanced"] > button').first();
  await expect(expander).toBeVisible({ timeout: 5_000 });
  if ((await expander.getAttribute("aria-expanded")) !== "true") {
    await expander.click();
    await expect(expander).toHaveAttribute("aria-expanded", "true");
  }

  const row = page
    .locator("div")
    .filter({ has: page.locator("text=Show UI tooltips") })
    .filter({ has: page.locator('[role="switch"]') })
    .last();
  const sw = row.locator('[role="switch"]').first();
  await expect(sw).toBeVisible({ timeout: 5_000 });
  const needsClick = ((await sw.getAttribute("aria-checked")) === "true") !== enabled;
  if (needsClick) {
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", enabled ? "true" : "false");
  }

  // Only wait for server sync when the setting was actually changed. The helper
  // polls `_pendingDebounce` / `_flushInFlight` flags (set inside
  // useServerSettingsSync) and resolves as soon as the server acknowledges the
  // PUT, or immediately when nothing is outstanding. This prevents the GET
  // /api/settings hydration on the next page from reverting the change.
  if (needsClick) {
    await page.evaluate(() => window.__bathyTest!.waitForServerSettingsSync());
  }

  if (!returnHome) return;

  await page.goto("/");
  // Sign-in/auth-bypass check: piggy-back on the home visit we already need
  // for the HUD assertions instead of warming up "/" a second time. The
  // canvas-visibility poll below has its own 15s budget, so a separate
  // `waitForLoadState("networkidle")` on the heavy 3D route is redundant.
  const canvas = page.locator("canvas").first();
  const visible = await canvas.isVisible({ timeout: 15_000 }).catch(() => false);
  if (!visible) {
    test.skip(true, "Canvas not visible — E2E auth bypass not active in this environment");
  }
}

/**
 * Dispatch a real mouse-typed pointerover/pointermove on the locator's
 * element. Radix Tooltip ignores hover from touch pointers, so we cannot
 * rely on `locator.hover()` in this headless config.
 */
async function mouseHover(locator: Locator) {
  await locator.evaluate((el) => {
    const make = (type: string) =>
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerType: "mouse",
        isPrimary: true,
      });
    el.dispatchEvent(make("pointerover"));
    el.dispatchEvent(make("pointerenter"));
    el.dispatchEvent(make("pointermove"));
  });
}

test.describe("Viewscreen tooltips — live HUD behaviour", () => {
  test("hover on FIND DATA shows the tooltip", async ({ page }) => {
    await setTooltipsViaSettings(page, true);

    const btn = page.locator(HUD_BUTTON).first();
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await mouseHover(btn);

    await expect(page.getByRole("tooltip", { name: TOOLTIP_LABEL })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("keyboard focus on FIND DATA shows the tooltip", async ({ page }) => {
    await setTooltipsViaSettings(page, true);

    const btn = page.locator(HUD_BUTTON).first();
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await btn.focus();

    await expect(page.getByRole("tooltip", { name: TOOLTIP_LABEL })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('disabling Settings → HUD → "Show UI tooltips" suppresses the tooltip', async ({ page }) => {
    await setTooltipsViaSettings(page, false);

    const btn = page.locator(HUD_BUTTON).first();
    await expect(btn).toBeVisible({ timeout: 10_000 });

    // Try both interactions a real user would use.
    await mouseHover(btn);
    await btn.focus();
    // Give Radix plenty of time to mount a tooltip if it were going to.
    await page.waitForTimeout(1200);

    await expect(page.getByRole("tooltip", { name: TOOLTIP_LABEL })).toHaveCount(0);

    // Restore the default so other specs aren't affected by persisted state.
    // No need to return to "/" — the test is over.
    await setTooltipsViaSettings(page, true, { returnHome: false });
  });

  test("tooltips do not swallow pointer events from the 3D canvas", async ({ page }) => {
    await setTooltipsViaSettings(page, true);

    const btn = page.locator(HUD_BUTTON).first();
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await btn.focus();
    await expect(page.getByRole("tooltip", { name: TOOLTIP_LABEL })).toBeVisible({
      timeout: 5_000,
    });

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    // Pick a point well clear of the bottom-right HUD column.
    const x = Math.round(box!.x + box!.width * 0.35);
    const y = Math.round(box!.y + box!.height * 0.45);

    // The tooltip portal must not stretch a hit-target across the
    // viewscreen. Walk the element stack at the point and confirm that
    // neither the tooltip nor any wrapping container is intercepting the
    // event — i.e. the canvas is reachable underneath whatever decorative
    // overlay sits on top (HUD chrome layers use `pointer-events: none`).
    const probe = await page.evaluate(
      ({ x, y }) => {
        const stack = (document.elementsFromPoint(x, y) as HTMLElement[]) ?? [];
        return stack.map((el) => ({
          tag: el.tagName,
          role: el.getAttribute("role"),
          pe: getComputedStyle(el).pointerEvents,
        }));
      },
      { x, y },
    );
    // No tooltip (or its portal container) in the stack at this point on
    // the canvas — that would mean the open tooltip is stealing events.
    expect(probe.some((e) => e.role === "tooltip")).toBe(false);
    // The canvas must be in the hit stack at this point.
    expect(probe.some((e) => e.tag === "CANVAS")).toBe(true);

    // And a real click + drag at that point should reach the canvas without
    // throwing or being intercepted by tooltip content.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y + 20, { steps: 5 });
    await page.mouse.up();
  });
});
