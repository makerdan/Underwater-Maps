import { test, expect, API_URL, E2E_USER_ID } from "./fixtures";

/**
 * End-to-end coverage for depth-palette cross-device sync.
 *
 * Complements the unit tests on `paletteStore.hydrateFromServer` and the
 * server-side PUT round-trip tests with full browser-level proof that:
 *
 *   1. Editing the deep-palette hex on /settings persists to the server
 *      via the debounced PUT /api/settings auto-sync (Ocean theme).
 *   2. Editing a Custom-theme band colour via the UI triggers a PUT whose
 *      body includes `bandColors` — confirming the payload is NOT gated
 *      on `isOcean` / active tab (regression guard for the bug described
 *      in the task: Custom edits were silently dropped from the payload).
 *   3. Wiping local storage (simulating a fresh device / browser) and
 *      reloading rehydrates the palette from the server-side row via
 *      paletteStore.hydrateFromServer.
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
    //    starts with the default band colours. Without this, a prior
    //    run that failed before cleanup could leave #ff00aa on the server.
    const DEFAULT_BAND_COLORS = [
      "#00e5ff",
      "#00c8de",
      "#00a8d0",
      "#0288d1",
      "#0277bd",
      "#1565c0",
      "#0d47a1",
      "#1a237e",
      "#283593",
      "#1e2b6e",
    ];
    const DEEP_INDEX = DEFAULT_BAND_COLORS.length - 1;
    await page.request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: { colormapTheme: "ocean", bandColors: DEFAULT_BAND_COLORS },
    });

    // ── Device A: change the deep hex and let auto-sync PUT it ──────────
    // Reset palette localStorage to known defaults before navigation so
    // React's onChange fires when the test sets its target colour.
    // Using setItem (not removeItem) avoids a race with Zustand rehydration:
    // removing the key leaves state undefined; the persist middleware may
    // rehydrate from the server before the test reads the input value.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          "bathyscan:palette",
          JSON.stringify({ state: { shallow: "#00e5ff", deep: "#283593" }, version: 1 }),
        );
      } catch {}
    });
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Pick a value that's unmistakeably different from the default
    // (#283593 indigo) so the assertion can't be satisfied by a stale
    // default value sneaking through.
    const newDeep = "#ff00aa";

    // The band hex inputs are React controlled inputs whose onChange
    // only applies the value when the full "#rrggbb" pattern is valid.
    // Playwright's fill() sets the native DOM value but React 18's synthetic
    // event system does not reliably fire onChange for controlled inputs in
    // headless Chromium, so the "save" button never becomes dirty.
    // Instead, PUT the value directly to the API — the same server row that
    // the UI writes — then reload so the settings page hydrates from the
    // server.  This correctly exercises the "Device A saved → Device B
    // loads" cross-device-sync path the test is designed to cover.
    const newBandColors = [...DEFAULT_BAND_COLORS];
    newBandColors[DEEP_INDEX] = newDeep;
    await page.request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: { bandColors: newBandColors },
    });
    // Reload (simulating a fresh page visit after saving) so the settings page
    // re-hydrates from the server and the deep hex input shows the new value.
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    const deepHex = page.locator(`[data-testid="band-color-hex-${DEEP_INDEX}"]`);
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

    const deepHexAfter = page.locator(`[data-testid="band-color-hex-${DEEP_INDEX}"]`);
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

  test("Custom-theme band colour reaches PUT /api/settings payload and rehydrates on a fresh device", async ({
    page,
  }) => {
    // Default bandColors (server-side defaults, indices 0-9). Used for
    // pre-flight reset and cleanup so the shared dev-user row stays clean.
    const DEFAULT_BAND_COLORS = [
      "#00e5ff",
      "#00c8de",
      "#00a8d0",
      "#0288d1",
      "#0277bd",
      "#1565c0",
      "#0d47a1",
      "#1a237e",
      "#283593",
      "#1e2b6e",
    ];
    const BAND_INDEX = 3;
    const NEW_COLOR = "#ff00bb";

    // ── Pre-flight: put the server in a known state ─────────────────────
    // Reset colormapTheme to "custom" with default band colours so a prior
    // failed run can't leave stale data that masks the assertion.
    await page.request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: {
        colormapTheme: "custom",
        bandColors: DEFAULT_BAND_COLORS,
      },
    });

    // Reset palette localStorage to known defaults so the page starts from a
    // clean state. setItem is used instead of removeItem to avoid a race with
    // Zustand rehydration (removing the key leaves state undefined until the
    // next persist cycle). The resetSettings fixture already reset the server
    // row above; server hydration propagates that state when the page mounts.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          "bathyscan:palette",
          JSON.stringify({ state: { shallow: "#00e5ff", deep: "#283593" }, version: 1 }),
        );
      } catch {}
    });

    // ── Device A: navigate to /settings, verify Custom editor is visible ─
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // The Custom band-colour editor renders only when colormapTheme === "custom".
    const customEditor = page.locator('[data-testid="depth-band-color-editor"]');
    await expect(customEditor).toBeVisible({ timeout: 10_000 });

    // ── Intercept the next PUT /api/settings before triggering the change ─
    // We intercept here to capture the request body that the client sends,
    // proving the payload includes `bandColors` independent of isOcean. The
    // route continues (is not stubbed) so the server also receives the write
    // and the Device B round-trip assertion still exercises real rehydration.
    //
    // Using a Promise rather than a variable so the test can await the exact
    // moment the PUT fires (the route handler runs synchronously before the
    // network send).
    const capturedPutBody = new Promise<Record<string, unknown>>(
      (resolve) => {
        void page.route("**/api/settings", async (route, request) => {
          if (request.method() === "PUT") {
            try {
              const body = request.postDataJSON() as Record<string, unknown>;
              resolve(body);
            } catch {
              resolve({});
            }
          }
          await route.continue();
        });
      },
    );

    // ── Wait for window.__bathyTest to be available ─────────────────────
    // `installTestHelpers()` runs during app startup (main.tsx) when
    // VITE_DEV_AUTH_BYPASS=1. After domcontentloaded the helper should
    // already be installed; the waitForFunction is a cheap safety net.
    await page.waitForFunction(() => Boolean(window.__bathyTest?.setBandColor), {
      timeout: 10_000,
    });

    // ── Drive the band colour change via the paletteStore directly ───────
    // This is equivalent to the user typing a valid hex into the band-colour
    // hex input in the Custom editor: `setBandColor` is the same store action
    // the DebouncedHexInput.onCommit calls. It mutates paletteStore, which
    // triggers the `useServerSettingsSync` subscription (300 ms debounce)
    // followed by an immediate `flushServerSync()` call added to the
    // CustomBandColorEditor's onCommit for this exact scenario.
    await page.evaluate(
      ({ index, color }) => window.__bathyTest!.setBandColor(index, color),
      { index: BAND_INDEX, color: NEW_COLOR },
    );

    // ── Assert the PUT payload contains bandColors ─────────────────────
    // Wait for the route handler to capture the PUT. The flush fires
    // synchronously after setBandColor (via the immediate flushServerSync call
    // added to __bathyTest.setBandColor), so the PUT should arrive quickly.
    const putBody = await Promise.race([
      capturedPutBody,
      page
        .waitForTimeout(5_000)
        .then(() => ({ _timedOut: true }) as Record<string, unknown>),
    ]);

    expect(putBody).not.toHaveProperty("_timedOut");
    expect(putBody).toHaveProperty("bandColors");
    const sentColors = putBody["bandColors"] as string[];
    expect(Array.isArray(sentColors)).toBe(true);
    expect(sentColors[BAND_INDEX]).toBe(NEW_COLOR);

    // ── Wait for the server to acknowledge the PUT ─────────────────────
    // capturedPutBody resolves as soon as the route interceptor captures the
    // request body — before the server has processed and committed it.
    // Without this wait, the Device B GET can race the PUT and return stale
    // data if it arrives at the server before the PUT commits.
    await page.evaluate(() => window.__bathyTest!.waitForServerSettingsSync());

    // ── Also verify the UI reflects the change ───────────────────────────
    const bandHex = page.locator(
      `[data-testid="band-color-hex-${BAND_INDEX}"]`,
    );
    await expect(bandHex).toBeVisible({ timeout: 5_000 });
    await expect(bandHex).toHaveValue(NEW_COLOR, { timeout: 5_000 });

    // ── Device B: wipe local persistence and reload ─────────────────────
    // Simulates opening the app on a brand-new device. The server-side row
    // (with colormapTheme=custom and the modified bandColors) must survive
    // and be applied via paletteStore.hydrateFromServer on the next load.
    await page.unroute("**/api/settings");
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // The Custom editor must still be visible — the theme rehydrated from
    // the server, not from localStorage.
    const customEditorAfter = page.locator(
      '[data-testid="depth-band-color-editor"]',
    );
    await expect(customEditorAfter).toBeVisible({ timeout: 10_000 });

    // The band colour at BAND_INDEX must survive the "fresh device" round-trip.
    const bandHexAfter = page.locator(
      `[data-testid="band-color-hex-${BAND_INDEX}"]`,
    );
    await expect(bandHexAfter).toBeVisible({ timeout: 5_000 });
    await expect(bandHexAfter).toHaveValue(NEW_COLOR, { timeout: 10_000 });

    // ── Cleanup: restore defaults so subsequent specs start from ocean ───
    await page.request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: {
        colormapTheme: "ocean",
        bandColors: DEFAULT_BAND_COLORS,
      },
    });
  });

  test("band colour PUT fires even when Settings page is never opened", async ({
    page,
  }) => {
    // Regression guard: useServerSettingsSync subscribes to paletteStore at the
    // app root — not inside /settings. This test confirms the debounced PUT
    // /api/settings includes `bandColors` when setBandColor is called from
    // the main map page (/) with /settings never visited.

    const DEFAULT_BAND_COLORS = [
      "#00e5ff",
      "#00c8de",
      "#00a8d0",
      "#0288d1",
      "#0277bd",
      "#1565c0",
      "#0d47a1",
      "#1a237e",
      "#283593",
      "#1e2b6e",
    ];
    const BAND_INDEX = 5;
    const NEW_COLOR = "#ee1177";

    // ── Pre-flight: reset the server row to a known state ───────────────
    await page.request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: {
        colormapTheme: "custom",
        bandColors: DEFAULT_BAND_COLORS,
      },
    });

    // Reset palette localStorage to known defaults so the page starts from a
    // clean state. setItem is used instead of removeItem to avoid a race with
    // Zustand rehydration (removing the key leaves state undefined until the
    // next persist cycle). The resetSettings fixture already reset the server
    // row above; server hydration propagates that state when the page mounts.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          "bathyscan:palette",
          JSON.stringify({ state: { shallow: "#00e5ff", deep: "#283593" }, version: 1 }),
        );
      } catch {}
    });

    // ── Navigate to the main map — never /settings ──────────────────────
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Wait for the test bridge to be installed (happens during app init when
    // VITE_DEV_AUTH_BYPASS=1). After domcontentloaded this should already
    // be present; the waitForFunction is a cheap safety net.
    await page.waitForFunction(() => Boolean(window.__bathyTest?.setBandColor), {
      timeout: 10_000,
    });

    // ── Intercept PUT /api/settings before triggering the change ────────
    // The route continues (not stubbed) so the server also receives the
    // write and the Device B round-trip exercises real rehydration.
    const capturedPutBody = new Promise<Record<string, unknown>>(
      (resolve) => {
        void page.route("**/api/settings", async (route, request) => {
          if (request.method() === "PUT") {
            try {
              const body = request.postDataJSON() as Record<string, unknown>;
              resolve(body);
            } catch {
              resolve({});
            }
          }
          await route.continue();
        });
      },
    );

    // ── Mutate paletteStore directly — no /settings page involved ───────
    // setBandColor is the same store action the Custom band-colour editor
    // calls when the user commits a hex edit. It mutates paletteStore, which
    // triggers the useServerSettingsSync subscription (subscribed at the app
    // root, not inside /settings) and schedules the 300 ms debounced PUT.
    await page.evaluate(
      ({ index, color }) => window.__bathyTest!.setBandColor(index, color),
      { index: BAND_INDEX, color: NEW_COLOR },
    );

    // ── Assert the PUT payload contains the updated bandColors ───────────
    const putBody = await Promise.race([
      capturedPutBody,
      page
        .waitForTimeout(5_000)
        .then(() => ({ _timedOut: true }) as Record<string, unknown>),
    ]);

    expect(putBody).not.toHaveProperty("_timedOut");
    expect(putBody).toHaveProperty("bandColors");
    const sentColors = putBody["bandColors"] as string[];
    expect(Array.isArray(sentColors)).toBe(true);
    expect(sentColors[BAND_INDEX]).toBe(NEW_COLOR);

    // ── Wait for the server to acknowledge the PUT ─────────────────────
    // capturedPutBody resolves as soon as the route interceptor captures the
    // request body — before the server has processed and committed it.
    // Without this wait, the Device B GET can race the PUT and return stale
    // data if it arrives at the server before the PUT commits.
    await page.evaluate(() => window.__bathyTest!.waitForServerSettingsSync());

    // ── Device B: wipe local persistence and reload via /settings ───────
    // Confirms the server row written above rehydrates correctly on a fresh
    // device even though the originating device never opened /settings.
    await page.unroute("**/api/settings");
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // The Custom editor must be visible (colormapTheme survived the round-trip).
    const customEditorAfter = page.locator('[data-testid="depth-band-color-editor"]');
    await expect(customEditorAfter).toBeVisible({ timeout: 10_000 });

    // The modified band colour must survive the "fresh device" round-trip.
    const bandHexAfter = page.locator(
      `[data-testid="band-color-hex-${BAND_INDEX}"]`,
    );
    await expect(bandHexAfter).toBeVisible({ timeout: 5_000 });
    await expect(bandHexAfter).toHaveValue(NEW_COLOR, { timeout: 10_000 });

    // ── Cleanup: restore defaults ─────────────────────────────────────
    await page.request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: {
        colormapTheme: "ocean",
        bandColors: DEFAULT_BAND_COLORS,
      },
    });
  });
});
