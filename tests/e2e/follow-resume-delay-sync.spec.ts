import { test, expect } from "./fixtures";

/**
 * followResumeDelaySec server round-trip end-to-end test.
 *
 * Exercises the full slider → PUT /api/settings → fresh-device
 * GET /api/settings → hydrateFromServer loop for the Follow Me
 * auto-resume delay setting.
 *
 * Scenario:
 *   1. Sign in (dev-auth-bypass) and open /settings → MAP LAYERS tab.
 *   2. Move the "Follow Resume Delay" slider to a non-default value (45s)
 *      and persist it via the section Save button.
 *   3. Simulate a fresh device: clear localStorage/sessionStorage and
 *      reload. The dev-auth-bypass keeps the same user id on /api/*
 *      requests, so the server-side row carries over.
 *   4. Verify the slider is restored to 45 from the server.
 *   5. Cleanup: reset back to the default so subsequent runs start clean.
 */

test.describe("Follow resume delay server sync", () => {
  test("followResumeDelaySec round-trips through the server to a fresh device", async ({
    page,
  }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });

    // Open the MAP LAYERS tab where the GPS & Trail settings live.
    await page.locator('button:has-text("MAP LAYERS")').first().click();

    const slider = page.locator("#slider-follow-resume-delay");
    await expect(slider).toBeVisible({ timeout: 10_000 });

    const setSlider = async (value: number) => {
      // Range inputs need fill() + change event via evaluate to trigger the
      // React onChange handler reliably across browsers.
      await slider.evaluate((el, v) => {
        const input = el as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(input, String(v));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
      await expect(slider).toHaveValue(String(value), { timeout: 5_000 });
    };

    // Make sure we actually flip the value so the section becomes dirty —
    // if a previous run left it on 45, move to 30 first.
    const startingValue = await slider.inputValue();
    if (startingValue === "45") {
      await setSlider(30);
      await page.waitForTimeout(1500); // debounce + PUT
    }

    await setSlider(45);

    // Flush via the MAP LAYERS section Save button ("markers" section key).
    const saveBtn = page.locator('[data-testid="save-section-markers-btn"]');
    await expect(saveBtn).toHaveAttribute("data-dirty", "true", { timeout: 5_000 });
    await saveBtn.click();
    await expect(saveBtn).toHaveAttribute("data-state", "saved", { timeout: 10_000 });

    // ── Fresh device: clear local persistence and reload ─────────────────
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.locator('button:has-text("MAP LAYERS")').first().click();

    const sliderAfter = page.locator("#slider-follow-resume-delay");
    await expect(sliderAfter).toBeVisible({ timeout: 10_000 });
    // hydrateFromServer applies the server-side 45 because lastSyncedAt is
    // null on this "fresh device".
    await expect(sliderAfter).toHaveValue("45", { timeout: 10_000 });

    // ── Cleanup: restore the default (20) for subsequent runs ────────────
    await sliderAfter.evaluate((el) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "20");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(1500); // debounce + PUT
  });
});
