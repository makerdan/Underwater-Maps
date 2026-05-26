import { test, expect } from "@playwright/test";

/**
 * Settings page end-to-end tests
 *
 * Updated to match the real sidebar labels and headings in
 * artifacts/bathyscan/src/pages/Settings.tsx (see NAV_TABS).
 *
 * These tests assume the e2e auth bypass is active (set on the bathyscan
 * webServer entry in playwright.config.ts via VITE_DEV_AUTH_BYPASS=1).
 * Without it the /settings route still mounts the Settings component
 * (it isn't auth-gated), so the assertions below run regardless.
 */

test.describe("Settings page", () => {
  // E2E tests share the same dev-bypass user, so a setting persisted by an
  // earlier test (e.g. the cross-device-sync spec leaving colormapTheme as
  // "freshwater" or "viridis") would otherwise bleed into the assertions
  // below that expect the default "ocean" value. Reset the relevant fields
  // to defaults before every test. Uses the same x-e2e-user-id pattern as
  // water-type-toggle.spec.ts.
  test.beforeEach(async ({ request }) => {
    await request.put("http://127.0.0.1:3151/api/settings", {
      headers: { "x-e2e-user-id": "dev-user-bypass" },
      data: { colormapTheme: "ocean", units: "metric", waterType: "saltwater" },
    });
  });

  // NOTE: Intentionally NO beforeEach that visits "/". The home route mounts
  // the heavy Three.js scene, which under headless Chromium leaks WebGL
  // contexts across many goto("/") calls during the full Playwright run and
  // eventually crashes the renderer → ERR_CONNECTION_REFUSED on subsequent
  // page loads. Settings-only specs navigate straight to /settings, which
  // is a lightweight route with no canvas. The one keyboard-shortcut test
  // below that genuinely needs the home page navigates to "/" itself.

  test("settings page is reachable via /settings route", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("text=SETTINGS").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=← BACK")).toBeVisible();
  });

  test("settings sidebar shows all tab labels", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Match the NAV_TABS array in Settings.tsx. Each entry below is a
    // substring that uniquely identifies its sidebar button.
    const expectedTabs = [
      "VISUALS",         // "VISUALS & PERF"
      "CAMERA & CTRL",
      "HUD & LAYOUT",
      "OVERVIEW MAP",
      "MARKERS",
      "DATA & STORAGE",
      "OFFLINE CACHE",
      "ACCOUNT & PRIVACY",
    ];
    for (const label of expectedTabs) {
      await expect(page.locator(`button:has-text("${label}")`).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test("clicking a sidebar tab shows the correct section heading", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("CAMERA & CTRL")').first().click();
    await expect(page.locator("text=◈ CAMERA").first()).toBeVisible({ timeout: 5_000 });

    await page.locator('button:has-text("HUD & LAYOUT")').first().click();
    await expect(page.locator("text=◈ HUD").first()).toBeVisible({ timeout: 5_000 });

    await page.locator('button:has-text("MARKERS")').first().click();
    await expect(page.locator("text=◈ MARKERS").first()).toBeVisible({ timeout: 5_000 });

    await page.locator('button:has-text("OFFLINE CACHE")').first().click();
    await expect(page.locator("text=◈ OFFLINE").first()).toBeVisible({ timeout: 5_000 });
  });

  test("caustics toggle changes checked state in the Visuals tab", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // ToggleRow renders the label and a Radix Switch in the same row.
    // Find the row by the "Caustics Effect" label, then the switch inside it.
    const causticsRow = page.locator("div").filter({
      has: page.locator("text=Caustics Effect"),
    }).filter({
      has: page.locator('[role="switch"]'),
    }).last();
    const causticsSwitch = causticsRow.locator('[role="switch"]').first();

    await expect(causticsSwitch).toBeVisible({ timeout: 5_000 });
    const initial = await causticsSwitch.getAttribute("aria-checked");
    await causticsSwitch.click();
    const after = await causticsSwitch.getAttribute("aria-checked");
    expect(after).not.toBe(initial);
  });

  test("Visuals tab is active by default and shows colormap selector", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("text=◈ VISUALS").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Depth Colormap").first()).toBeVisible();
  });

  test("RESET ALL SETTINGS button is present", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("text=RESET ALL SETTINGS")).toBeVisible({ timeout: 10_000 });
  });

  test("Offline tab shows pending markers count", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("OFFLINE CACHE")').first().click();
    const count = page.locator("[data-testid='pending-markers-count']");
    await expect(count).toBeVisible({ timeout: 5_000 });
  });

  test("← BACK navigates back to the home route", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.locator("text=← BACK").click();
    await page.waitForURL((url) => !url.pathname.endsWith("/settings"), { timeout: 5_000 });
  });

  test("Account tab shows danger zone", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("ACCOUNT & PRIVACY")').first().click();
    await expect(page.locator("text=DANGER ZONE")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=DELETE ALL MY MARKERS")).toBeVisible();
  });

  test("danger zone delete button requires confirmation", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("ACCOUNT & PRIVACY")').first().click();
    await page.locator("text=DELETE ALL MY MARKERS").click();

    await expect(page.locator("text=Are you sure?")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=YES, DELETE ALL")).toBeVisible();
    await expect(page.locator("text=CANCEL")).toBeVisible();
  });

  test("RESET ALL SETTINGS restores colormap to ocean after a change", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Visuals tab is active by default. Find the Depth Colormap picker.
    const colormapSelect = page.locator('[data-testid="depth-colormap-select"]');
    await expect(colormapSelect).toBeVisible({ timeout: 5_000 });

    // Sanity: starts on 'ocean'.
    await expect(colormapSelect).toHaveAttribute("data-value", "ocean");

    // Open the picker and choose 'viridis'.
    await colormapSelect.click();
    await page.locator('[role="option"]', { hasText: "Viridis" }).click();
    await expect(colormapSelect).toHaveAttribute("data-value", "viridis");

    // Trigger the global reset (two-step confirm).
    await page.locator("[data-testid='reset-all-btn']").click();
    await page.locator("[data-testid='confirm-reset-all-btn']").click();

    // Colormap should return to its default.
    await expect(colormapSelect).toHaveAttribute("data-value", "ocean");
  });

  test("colormap selection survives a full page reload", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const colormapSelect = page.locator('[data-testid="depth-colormap-select"]');
    await expect(colormapSelect).toBeVisible({ timeout: 5_000 });
    await expect(colormapSelect).toHaveAttribute("data-value", "ocean");

    // Change to a non-default value via the custom picker popover.
    await colormapSelect.click();
    await page.locator('[role="option"]', { hasText: "Viridis" }).click();
    await expect(colormapSelect).toHaveAttribute("data-value", "viridis");

    // Wait for the persist middleware to write to localStorage.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem("bathyscan:settings");
          if (!raw) return null;
          try {
            return JSON.parse(raw)?.state?.colormapTheme ?? null;
          } catch {
            return null;
          }
        }),
        { timeout: 5_000 },
      )
      .toBe("viridis");

    // Full page reload.
    await page.reload();
    await page.waitForLoadState("networkidle");

    // The picker should still reflect the previously chosen value.
    const reloadedSelect = page.locator('[data-testid="depth-colormap-select"]');
    await expect(reloadedSelect).toBeVisible({ timeout: 10_000 });
    await expect(reloadedSelect).toHaveAttribute("data-value", "viridis");

    // Cleanup: reset to defaults via the global reset (two-step confirm).
    await page.locator("[data-testid='reset-all-btn']").click();
    await page.locator("[data-testid='confirm-reset-all-btn']").click();
    await expect(reloadedSelect).toHaveAttribute("data-value", "ocean");
  });

  test("settings on Visuals, HUD, Camera, and Markers tabs all survive a full page reload", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Helper: read a field out of the persisted settings blob in localStorage.
    const readPersisted = (field: string) =>
      page.evaluate((key) => {
        const raw = window.localStorage.getItem("bathyscan:settings");
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw);
          return parsed?.state?.[key] ?? null;
        } catch {
          return null;
        }
      }, field);

    // Helper: locate a ToggleRow's [role="switch"] by its visible label.
    const toggleByLabel = (label: string) =>
      page
        .locator("div")
        .filter({ has: page.locator(`text="${label}"`) })
        .filter({ has: page.locator('[role="switch"]') })
        .last()
        .locator('[role="switch"]')
        .first();

    // Helper: locate a SliderRow's range input by its visible label, then set
    // its value via the native HTMLInputElement setter so React's onChange
    // fires (Playwright's locator.fill() does not work on range inputs).
    const setSliderByLabel = async (label: string, value: number) => {
      const row = page
        .locator("div")
        .filter({ has: page.locator(`text="${label}"`) })
        .filter({ has: page.locator('input[type="range"]') })
        .last();
      const input = row.locator('input[type="range"]').first();
      await expect(input).toBeVisible({ timeout: 5_000 });
      await input.evaluate((el, v) => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(el, String(v));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
    };

    // ── Visuals tab (active by default): flip the Caustics toggle. ──────
    await expect(page.locator("text=◈ VISUALS").first()).toBeVisible({ timeout: 10_000 });
    const caustics = toggleByLabel("Caustics Effect");
    await expect(caustics).toBeVisible({ timeout: 5_000 });
    const causticsInitial = await caustics.getAttribute("aria-checked");
    await caustics.click();
    const causticsExpected = causticsInitial === "true" ? false : true;
    await expect(caustics).toHaveAttribute("aria-checked", String(causticsExpected));

    // ── HUD & Layout tab: change HUD Opacity to a non-default value. ────
    await page.locator('button:has-text("HUD & LAYOUT")').first().click();
    await expect(page.locator("text=◈ HUD").first()).toBeVisible({ timeout: 5_000 });
    const hudOpacityTarget = 0.5; // default is 0.75
    await setSliderByLabel("HUD Opacity", hudOpacityTarget);

    // ── Camera & Controls tab: bump Mouse Sensitivity off its default. ──
    await page.locator('button:has-text("CAMERA & CTRL")').first().click();
    await expect(page.locator("text=◈ CAMERA").first()).toBeVisible({ timeout: 5_000 });
    const mouseSensTarget = 2.3; // default is 1.0
    await setSliderByLabel("Mouse Sensitivity", mouseSensTarget);

    // ── Markers tab: flip the Show Marker Labels toggle. ────────────────
    await page.locator('button:has-text("MARKERS")').first().click();
    await expect(page.locator("text=◈ MARKERS").first()).toBeVisible({ timeout: 5_000 });
    const labels = toggleByLabel("Show Marker Labels");
    await expect(labels).toBeVisible({ timeout: 5_000 });
    const labelsInitial = await labels.getAttribute("aria-checked");
    await labels.click();
    const labelsExpected = labelsInitial === "true" ? false : true;
    await expect(labels).toHaveAttribute("aria-checked", String(labelsExpected));

    // Wait for the persist middleware to flush every changed field to
    // localStorage before we reload. The store writes the whole object so
    // any one of these polls confirming success means the write happened.
    await expect.poll(() => readPersisted("enableCaustics"), { timeout: 5_000 }).toBe(causticsExpected);
    await expect.poll(() => readPersisted("hudOpacity"), { timeout: 5_000 }).toBe(hudOpacityTarget);
    await expect.poll(() => readPersisted("mouseSensitivity"), { timeout: 5_000 }).toBe(mouseSensTarget);
    await expect.poll(() => readPersisted("showMarkerLabels"), { timeout: 5_000 }).toBe(labelsExpected);

    // Full page reload — the real persistence check.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=◈ VISUALS").first()).toBeVisible({ timeout: 10_000 });

    // After reload, every changed field must still be in localStorage
    // (which is what the persist middleware re-hydrates the store from).
    expect(await readPersisted("enableCaustics")).toBe(causticsExpected);
    expect(await readPersisted("hudOpacity")).toBe(hudOpacityTarget);
    expect(await readPersisted("mouseSensitivity")).toBe(mouseSensTarget);
    expect(await readPersisted("showMarkerLabels")).toBe(labelsExpected);

    // And the rehydrated UI must reflect those values on each tab.
    const causticsAfter = toggleByLabel("Caustics Effect");
    await expect(causticsAfter).toHaveAttribute("aria-checked", String(causticsExpected));

    await page.locator('button:has-text("MARKERS")').first().click();
    await expect(page.locator("text=◈ MARKERS").first()).toBeVisible({ timeout: 5_000 });
    const labelsAfter = toggleByLabel("Show Marker Labels");
    await expect(labelsAfter).toHaveAttribute("aria-checked", String(labelsExpected));

    // Cleanup: restore every setting to defaults via the global reset
    // (two-step confirm) so this test doesn't bleed into other specs.
    await page.locator("[data-testid='reset-all-btn']").click();
    await page.locator("[data-testid='confirm-reset-all-btn']").click();
    await expect
      .poll(() => readPersisted("enableCaustics"), { timeout: 5_000 })
      .toBe(false);
    await expect.poll(() => readPersisted("hudOpacity"), { timeout: 5_000 }).toBe(0.75);
    await expect.poll(() => readPersisted("mouseSensitivity"), { timeout: 5_000 }).toBe(1.0);
    await expect.poll(() => readPersisted("showMarkerLabels"), { timeout: 5_000 }).toBe(true);
  });

  test("comma keyboard shortcut navigates to /settings from the main page", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Only works when signed in (app main page visible)
    const isSignedIn = await page.locator("canvas, [data-testid='hud']").isVisible({ timeout: 5_000 }).catch(() => false);
    if (!isSignedIn) {
      test.skip(true, "Keyboard shortcut only works when signed in and canvas is visible");
      return;
    }

    await page.keyboard.press(",");
    await page.waitForURL((url) => url.pathname.includes("settings"), { timeout: 5_000 });
    await expect(page.locator("text=SETTINGS").first()).toBeVisible();
  });
});
