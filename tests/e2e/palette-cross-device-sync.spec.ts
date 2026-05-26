import { test, expect } from "@playwright/test";

/**
 * Task #368 — end-to-end coverage for depth-palette cross-device sync.
 *
 * Complements the unit tests on `paletteStore.hydrateFromServer` and the
 * server-side PUT round-trip tests with a full browser-level proof that:
 *
 *   1. Editing the deep-palette hex on /settings persists to the server
 *      via the debounced PUT /api/settings auto-sync.
 *   2. Wiping local storage (simulating a fresh device / browser) and
 *      reloading rehydrates the palette from the server-side row via
 *      paletteStore.hydrateFromServer.
 *
 * This is the regression test for the failure mode the task describes —
 * a future settings refactor silently dropping the palette fields from
 * the /api/settings round-trip would only be caught at this layer.
 *
 * Uses the dev-auth-bypass already configured in playwright.config.ts
 * (VITE_DEV_AUTH_BYPASS=1 / E2E_AUTH_BYPASS=1) so the same fake user id
 * is shared across "device A" and "device B" within the same browser.
 */

test.describe("Depth palette cross-device sync", () => {
  test("custom deep colour persists to server and rehydrates on a fresh device", async ({
    page,
  }) => {
    // ── Device A: change the deep hex and let auto-sync PUT it ──────────
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const deepHex = page.locator('[data-testid="palette-deep-hex"]');
    await expect(deepHex).toBeVisible({ timeout: 10_000 });

    // Pick a value that's unmistakeably different from the default
    // (#283593 indigo) so the assertion can't be satisfied by a stale
    // default value sneaking through.
    const newDeep = "#ff00aa";
    await deepHex.fill(newDeep);
    await deepHex.blur();
    await expect(deepHex).toHaveValue(newDeep);

    // Force-flush the pending debounced sync via the section Save button so
    // we have a deterministic "saved" signal to await before "switching
    // devices".
    const saveBtn = page.locator('[data-testid="save-section-visuals-btn"]');
    await expect(saveBtn).toHaveAttribute("data-dirty", "true", { timeout: 5_000 });
    await saveBtn.click();
    await expect(saveBtn).toHaveAttribute("data-state", "saved", { timeout: 10_000 });

    // ── Device B: clear local persistence and reload ────────────────────
    // The palette persists locally under "bathyscan:palette". Wiping
    // localStorage puts us in the same state a brand-new browser would
    // be in. The dev-auth bypass still injects the same x-e2e-user-id on
    // /api/* requests, so the server-side row survives and should be
    // re-applied via paletteStore.hydrateFromServer.
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const deepHexAfter = page.locator('[data-testid="palette-deep-hex"]');
    await expect(deepHexAfter).toBeVisible({ timeout: 10_000 });
    // hydrateFromServer applies the server-side deep colour because
    // lastSyncedAt is null on this "fresh device".
    await expect(deepHexAfter).toHaveValue(newDeep, { timeout: 10_000 });

    // ── Cleanup: restore palette defaults so we don't pollute the shared
    //    dev user's server-side row for subsequent test runs.
    await page.locator('[data-testid="palette-reset-btn"]').click();
    // Wait for the debounced auto-sync (300 ms) + PUT round-trip.
    await page.waitForTimeout(1500);
  });
});
