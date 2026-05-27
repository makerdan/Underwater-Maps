import { test, expect } from "./fixtures";

/**
 * Cross-device settings sync end-to-end test.
 *
 * Exercises the full GET /api/settings → store.hydrateFromServer →
 * Account tab "Last synced" display path that backs multi-device sync.
 *
 * Scenario:
 *   1. Sign in (dev-auth-bypass) and open /settings.
 *   2. Change a setting (Depth Colormap → Viridis) and persist it via the
 *      section Save button so we know a PUT /api/settings completed.
 *   3. Switch to ACCOUNT & PRIVACY and verify the "Last synced" row in the
 *      Account tab is populated (not "NEVER").
 *   4. Simulate signing in from a different device by clearing
 *      localStorage (where zustand persists the settings store) and
 *      reloading. The same fake user id (dev-user-bypass) is still injected
 *      on /api/* requests, so the server-side row carries over.
 *   5. Verify the previously-saved Viridis value is restored from the
 *      server via hydrateFromServer (server wins when lastSyncedAt is null).
 *   6. Verify the "Last synced" row is again populated after hydration,
 *      proving the server's __updatedAt stamp made it into the store.
 *
 * This complements the unit tests in `settingsStore.test.ts` by covering
 * the full network → store → UI loop end-to-end, which is what would break
 * silently if cross-device sync regressed.
 *
 * Assumes the e2e auth bypass is active (VITE_DEV_AUTH_BYPASS=1 on the
 * bathyscan webServer, E2E_AUTH_BYPASS=1 on the api-server — see
 * playwright.config.ts).
 */

test.describe("Settings cross-device sync", () => {
  test("server-side setting is restored on a fresh device and Last synced updates", async ({
    page,
  }) => {
    // ── Device A: change a setting and persist it ────────────────────────
    // domcontentloaded (not networkidle): bathyscan keeps long-lived requests
    // open (terrain warm-up, /api/me poll, etc.) so networkidle would time
    // out before this page is interactive.
    await page.goto("/settings", { waitUntil: "domcontentloaded" });

    // The Depth Colormap picker is a custom (button + listbox) dropdown,
    // not a native <select>. Drive it via its testid and the listbox
    // option that carries the target value.
    const colormapTrigger = page.getByTestId("depth-colormap-select");
    await expect(colormapTrigger).toBeVisible({ timeout: 10_000 });

    const selectColormap = async (value: string) => {
      const current = await colormapTrigger.getAttribute("data-value");
      if (current === value) return;
      await colormapTrigger.click();
      await page
        .locator(`ul[role="listbox"] li[role="option"]`)
        .filter({ hasText: new RegExp(value, "i") })
        .first()
        .click();
      await expect(colormapTrigger).toHaveAttribute("data-value", value, {
        timeout: 5_000,
      });
    };

    // Make sure we actually flip the value so the section becomes dirty —
    // if a previous test run left it on viridis, start from ocean first.
    const startingValue = await colormapTrigger.getAttribute("data-value");
    if (startingValue === "viridis") {
      await selectColormap("ocean");
      // Wait for the auto-sync debounce (300 ms) + PUT round-trip.
      await page.waitForTimeout(1500);
    }

    await selectColormap("viridis");

    // Force-flush the pending debounced sync via the section Save button so
    // we have a deterministic "saved" signal to await.
    const saveBtn = page.locator('[data-testid="save-section-visuals-btn"]');
    await expect(saveBtn).toHaveAttribute("data-dirty", "true", { timeout: 5_000 });
    await saveBtn.click();
    await expect(saveBtn).toHaveAttribute("data-state", "saved", { timeout: 10_000 });

    // Account tab should now show a populated "Last synced" row.
    await page.locator('button:has-text("ACCOUNT & PRIVACY")').first().click();
    const lastSynced = page.locator('[data-testid="last-synced-row"]');
    await expect(lastSynced).toBeVisible({ timeout: 5_000 });
    await expect(lastSynced).toContainText("LAST SYNCED:");
    await expect(lastSynced).not.toContainText("NEVER");

    // ── Device B: clear local persistence and reload ─────────────────────
    // localStorage is where zustand-persist stores the settings snapshot
    // (key: "bathyscan:settings"). Wiping it puts us in the same state a
    // brand-new browser/device would be in. The dev-auth-bypass still
    // injects the same `x-e2e-user-id` on /api/* requests, so the server
    // row persists and should be re-hydrated into the store.
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto("/settings", { waitUntil: "domcontentloaded" });

    const colormapAfter = page.getByTestId("depth-colormap-select");
    // hydrateFromServer applies the server-side viridis value because
    // lastSyncedAt is null on this "fresh device".
    await expect(colormapAfter).toHaveAttribute("data-value", "viridis", {
      timeout: 10_000,
    });

    // The Account tab's Last synced row should be populated again from the
    // server's __updatedAt stamp (not the post-clear "NEVER" placeholder).
    await page.locator('button:has-text("ACCOUNT & PRIVACY")').first().click();
    const lastSyncedAfter = page.locator('[data-testid="last-synced-row"]');
    await expect(lastSyncedAfter).toBeVisible({ timeout: 5_000 });
    await expect(lastSyncedAfter).toContainText("LAST SYNCED:");
    await expect(lastSyncedAfter).not.toContainText("NEVER");

    // ── Cleanup: restore defaults so we don't pollute the shared dev
    //    user's server-side row for subsequent test runs.
    await page.locator("[data-testid='reset-all-btn']").click();
    await page.locator("[data-testid='confirm-reset-all-btn']").click();
    // Wait for debounced auto-sync (300 ms) + PUT round-trip.
    await page.waitForTimeout(1500);
  });
});
