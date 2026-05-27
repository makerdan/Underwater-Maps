import { test, expect, type Page } from "./fixtures";

/**
 * Per-section Save buttons (Task #106 → tested here in Task #108)
 *
 * Verifies the SectionSaveButton + SyncContext.flushSync flow from
 * artifacts/bathyscan/src/pages/Settings.tsx, end-to-end against the
 * real api-server (with the dev auth bypass active — see playwright.config.ts).
 *
 * Covered:
 *   - Idle → dirty → SAVING… → ✓ SAVED transitions for the HUD section,
 *     including the top-bar "✓ SAVED" indicator flash.
 *   - Error path: PUT /api/settings stubbed to 500 → RETRY SAVE + inline
 *     error message appear, button stays dirty.
 *   - Smoke: clicking SAVE on a dirty section produces ✓ SAVED feedback
 *     (covers the signed-out / local-only flushSync branch's UX, which
 *     shares the same flashSavedMsg + markAllSaved code path).
 */

const HUD_SAVE = "[data-testid='save-section-hud-btn']";
const HUD_ERROR = "[data-testid='save-section-hud-error']";
const TOP_SAVED = "[data-testid='topbar-saved-indicator']";

/**
 * Drive the HUD Opacity range input to a specific value via React's
 * native input setter so React's onChange fires (Playwright's .fill()
 * does not dispatch the synthetic event range inputs need).
 */
async function nudgeHudOpacity(page: Page, value: number): Promise<void> {
  const slider = page.locator("input[type='range']").nth(0); // HUD Opacity is the first range in the HUD tab
  await expect(slider).toBeVisible({ timeout: 5_000 });
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, String(v));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function gotoHudTab(page: Page): Promise<void> {
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  await page.locator('button:has-text("HUD & LAYOUT")').first().click();
  await expect(page.locator("text=◈ HUD").first()).toBeVisible({ timeout: 5_000 });
}

test.describe("Settings — per-section Save buttons", () => {
  test("HUD section: edit → SAVE → SAVING… → ✓ SAVED, top-bar flashes", async ({ page }) => {
    // Slow the PUT down enough that the SAVING… intermediate state is
    // observable. Without this delay the request often resolves between
    // Playwright polling intervals and the assertion races.
    await page.route("**/api/settings", async (route) => {
      if (route.request().method() === "PUT") {
        await new Promise((r) => setTimeout(r, 1200));
        await route.continue();
        return;
      }
      await route.continue();
    });

    await gotoHudTab(page);

    const saveBtn = page.locator(HUD_SAVE);
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });

    // Initially clean: disabled, data-dirty="false", label "✓ SAVED".
    await expect(saveBtn).toHaveAttribute("data-dirty", "false");
    await expect(saveBtn).toBeDisabled();

    // Edit HUD Opacity → section becomes dirty → button enables.
    await nudgeHudOpacity(page, 0.5);
    await expect(saveBtn).toHaveAttribute("data-dirty", "true", { timeout: 3_000 });
    await expect(saveBtn).toBeEnabled();
    await expect(saveBtn).toHaveText(/SAVE/);

    // Click → SAVING… (data-state="saving", label "SAVING…") observable
    // thanks to the route delay above.
    await saveBtn.click();
    await expect(saveBtn).toHaveAttribute("data-state", "saving", { timeout: 5_000 });
    await expect(saveBtn).toHaveText(/SAVING…/);

    // Then resolves to ✓ SAVED and disables + clean again.
    await expect(saveBtn).toHaveText(/✓ SAVED/, { timeout: 10_000 });
    await expect(saveBtn).toHaveAttribute("data-state", "saved");
    await expect(saveBtn).toHaveAttribute("data-dirty", "false");
    await expect(saveBtn).toBeDisabled();

    // Top-bar "✓ SAVED" indicator flashes (flashSavedMsg). Asserted via its
    // dedicated testid so it cannot be confused with the section button's
    // "✓ SAVED" label.
    await expect(page.locator(TOP_SAVED)).toBeVisible({ timeout: 3_000 });
  });

  test("HUD section: PUT /api/settings 500 → RETRY SAVE + inline error, stays dirty", async ({ page }) => {
    // Intercept the PUT before navigating so neither the auto-debounce sync
    // nor the manual click can succeed.
    await page.route("**/api/settings", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Simulated server failure" }),
        });
        return;
      }
      await route.continue();
    });

    await gotoHudTab(page);

    const saveBtn = page.locator(HUD_SAVE);
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });

    // Edit a value. The auto-debounce save will also 500 but swallows errors
    // silently (see scheduleSync), so the section stays dirty.
    await nudgeHudOpacity(page, 0.4);
    await expect(saveBtn).toHaveAttribute("data-dirty", "true", { timeout: 3_000 });

    // Manual click surfaces the failure.
    await saveBtn.click();
    await expect(saveBtn).toHaveText(/RETRY SAVE/, { timeout: 10_000 });
    await expect(saveBtn).toHaveAttribute("data-dirty", "true");
    await expect(saveBtn).toHaveAttribute("data-state", "error");

    // Inline error message is rendered alongside the button.
    await expect(page.locator(HUD_ERROR)).toBeVisible({ timeout: 3_000 });

    // The button remains clickable so the user can retry.
    await expect(saveBtn).toBeEnabled();
  });

  // NOTE: The signed-out smoke case for SectionSaveButton lives in a vitest
  // spec (artifacts/bathyscan/src/__tests__/SettingsSaveButtonSignedOut.test.tsx)
  // because the e2e webServer config hard-wires VITE_DEV_AUTH_BYPASS=1, which
  // is evaluated at module init and cannot be toggled per-test. The vitest
  // spec mocks `useUser` to return `{ isSignedIn: false }` and asserts the
  // local-only flushSync UX (✓ SAVED feedback, data-dirty="false").
});
