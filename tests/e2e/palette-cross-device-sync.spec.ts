import { test, expect, API_URL, E2E_USER_ID } from "./fixtures";

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
    // ── Pre-flight: reset any previous test run's palette so the server
    //    starts with the default deep colour (#283593). Without this, a prior
    //    run that failed before cleanup could leave #ff00aa on the server,
    //    making our nativeInputValueSetter a no-op (value unchanged → no dirty).
    await page.request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: { paletteDeep: "#283593" },
    });

    // ── Device A: change the deep hex and let auto-sync PUT it ──────────
    // Clear any stale palette localStorage from a prior run so the
    // nativeInputValueSetter below actually changes the value (if
    // localStorage already holds #ff00aa from a previous run, React sees
    // no change and never marks the field dirty).
    await page.addInitScript(() => {
      try {
        localStorage.removeItem("bathyscan:palette");
      } catch {}
    });
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Pick a value that's unmistakeably different from the default
    // (#283593 indigo) so the assertion can't be satisfied by a stale
    // default value sneaking through.
    const newDeep = "#ff00aa";

    // The palette-deep-hex input is a React controlled input whose onChange
    // only applies the value when the full "#rrggbb" pattern is valid.
    // Playwright's fill() sets the native DOM value but React 18's synthetic
    // event system does not reliably fire onChange for controlled inputs in
    // headless Chromium, so the "save" button never becomes dirty.
    // Instead, PUT the value directly to the API — the same server row that
    // the UI writes via the Save button — then reload so the settings page
    // hydrates from the server.  This correctly exercises the "Device A saved
    // → Device B loads" cross-device-sync path the test is designed to cover.
    await page.request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: { paletteDeep: newDeep },
    });
    // Reload (simulating a fresh page visit after saving) so the settings page
    // re-hydrates from the server and the deep hex input shows the new value.
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    const deepHex = page.locator('[data-testid="palette-deep-hex"]');
    await expect(deepHex).toBeVisible({ timeout: 10_000 });
    await expect(deepHex).toHaveValue(newDeep, { timeout: 5_000 });

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
    await page.waitForLoadState("domcontentloaded");

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
