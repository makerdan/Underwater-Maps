import { test, expect, type Page, API_URL, E2E_USER_ID } from "./fixtures";

/**
 * E2E coverage for the onboarding tour overlay (task #749).
 *
 * The onboarding tour covers four user-facing flows that are easy to break
 * silently:
 *
 *   1. Overlay appears on first load (hasSeenOnboarding: false) and
 *      disappears after Skip.
 *   2. Overlay disappears after clicking Done on the final step.
 *   3. Overlay does NOT appear when hasSeenOnboarding is already true.
 *   4. "Replay tour" button in Settings → Onboarding resets the flag and
 *      navigates back to the scene with the overlay visible.
 *   5. "Take the tour" link in the Help window sidebar triggers the overlay.
 *
 * State setup strategy
 * ─────────────────────
 * The settingsStore persists to localStorage ("bathyscan:settings") AND is
 * hydrated from the server on mount (GET /api/settings).  To guarantee a
 * deterministic starting state we patch both:
 *
 *   • `addInitScript` → writes hasSeenOnboarding into the existing
 *     localStorage entry before Zustand initialises, so the very first
 *     render already has the right value.
 *   • `request.put /api/settings` → updates the server copy so the
 *     hydrateFromServer call that fires shortly after mount agrees.
 *
 * Selectors
 * ──────────
 * The overlay dialog:   [role="dialog"][aria-label="BathyScan guided tour"]
 * Skip button:          [aria-label="Skip tour"]
 * Next/Done button:     button with text "NEXT →" / "DONE ✓"
 * Step dots:            [aria-label="Go to step N"]
 * Settings onboarding:  nav button with text "ONBOARDING"
 * Replay btn:           [data-testid="replay-tour-btn"]
 * Help button:          [data-testid="help-button"]
 * Help window:          [data-testid="help-window"]
 * Take tour btn:        [data-testid="help-take-tour-btn"]
 */

const TOUR_DIALOG_SELECTOR = '[role="dialog"][aria-label="BathyScan guided tour"]';
const SKIP_BTN_SELECTOR = '[aria-label="Skip tour"]';
const STEPS = 5;

/**
 * Inject hasSeenOnboarding into localStorage before the page script runs.
 * Zustand's persist middleware reads localStorage on first access, so
 * patching it here guarantees the initial render has the right value.
 *
 * IMPORTANT: this must be passed to addInitScript as
 * `page.addInitScript(patchOnboardingLocalStorage, value)` — Playwright
 * serializes only the function SOURCE, so a closure-captured `value`
 * (the old `patchOnboardingLocalStorage(value)` factory pattern) arrives
 * in the page as `undefined`, JSON.stringify drops the key, and the seed
 * silently does nothing.
 */
// IMPORTANT: this function is serialized by Playwright and executed in the
// browser, so it must not close over any outer variables — `value` arrives
// as the init-script argument (the second parameter of page.addInitScript).
// A previous version returned a closure capturing `value`; Playwright only
// serializes the function source, so `value` was a ReferenceError at runtime
// and the seed silently never landed (both writes were swallowed by the
// try/catch), leaving the test's starting state to a race between server
// hydration and the first local settings edit.
function patchOnboardingLocalStorage(value: boolean) {
  try {
    const raw = localStorage.getItem("bathyscan:settings");
    const parsed: { state?: Record<string, unknown>; version?: number } = raw
      ? JSON.parse(raw)
      : {};
    parsed.state = { ...(parsed.state ?? {}), hasSeenOnboarding: value };
    localStorage.setItem("bathyscan:settings", JSON.stringify(parsed));
  } catch {
    // If the key doesn't exist yet, write a minimal seed so Zustand's
    // persist migration picks up the override (it merges with defaults).
    try {
      localStorage.setItem(
        "bathyscan:settings",
        JSON.stringify({ state: { hasSeenOnboarding: value }, version: 0 }),
      );
    } catch {
      // localStorage blocked (unlikely in tests, but guard anyway).
    }
  }
}

/**
 * Set hasSeenOnboarding on the server for dev-user-bypass so the GET
 * /api/settings hydration that fires on mount agrees with the localStorage
 * seed.
 */
async function setServerOnboardingFlag(
  request: Parameters<Parameters<typeof test>[1]>[0]["request"],
  value: boolean,
) {
  await request.put(`${API_URL}/api/settings`, {
    headers: { "x-e2e-user-id": E2E_USER_ID },
    data: { hasSeenOnboarding: value },
  });
}

/**
 * Navigate to "/" and confirm the main 3D canvas is visible (which requires
 * the E2E auth bypass to be active). Calls `test.skip` and returns false if
 * the canvas is absent so the calling test exits cleanly.
 */
async function ensureSceneLoaded(page: Page): Promise<boolean> {
  await page.waitForLoadState("domcontentloaded");
  const canvas = page.locator("canvas").first();
  const visible = await canvas.isVisible({ timeout: 15_000 }).catch(() => false);
  if (!visible) {
    test.skip(true, "Scene canvas not visible — E2E auth bypass not active in this environment");
    return false;
  }
  // Seed synthetic terrain so OnboardingGuard (which gates the overlay on terrain
  // being loaded) mounts the OnboardingOverlay. Without this, the overlay is never
  // rendered even when hasSeenOnboarding=false, because the guard returns null
  // until a terrain commit has been received by the React context.
  await page.evaluate(() => {
    (window as unknown as { __bathyTest?: { seedTerrain?: () => void } })
      .__bathyTest?.seedTerrain?.();
  });
  return true;
}

test.describe("Onboarding tour overlay", () => {
  test.beforeEach(async ({ page }) => {
    // Suppress the SimulatedDataConfirmDialog so it cannot block scene load
    // or overlay interaction.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
  });

  // ── 1. Skip ──────────────────────────────────────────────────────────────

  test("overlay appears on first load and disappears after Skip", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);

    await setServerOnboardingFlag(request, false);
    await page.addInitScript(patchOnboardingLocalStorage, false);
    await page.goto("/");

    const ok = await ensureSceneLoaded(page);
    if (!ok) return;

    const dialog = page.locator(TOUR_DIALOG_SELECTOR);
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    // Header confirms we are on step 1 of 5.
    await expect(dialog).toContainText("STEP 1 OF 5");

    // Click Skip — the overlay should unmount (hasSeenOnboarding flips to true).
    await dialog.locator(SKIP_BTN_SELECTOR).dispatchEvent("click");
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });
  });

  // ── 1b. Skip flushes the flag to the server immediately ──────────────────

  test("Skip flushes hasSeenOnboarding:true to the server immediately", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);

    await setServerOnboardingFlag(request, false);
    await page.addInitScript(patchOnboardingLocalStorage, false);
    await page.goto("/");

    const ok = await ensureSceneLoaded(page);
    if (!ok) return;

    const dialog = page.locator(TOUR_DIALOG_SELECTOR);
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    // Dismiss the tour via Skip.
    await dialog.locator(SKIP_BTN_SELECTOR).dispatchEvent("click");
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });

    // Wait for the PUT /api/settings to complete. Skip calls flushServerSync()
    // (non-debounced), so _flushInFlight is true while the PUT is in flight.
    // waitForServerSettingsSync resolves once _flushInFlight clears, giving a
    // precise signal instead of a fixed sleep.
    await page.evaluate(() => window.__bathyTest!.waitForServerSettingsSync());

    // Verify the server now records hasSeenOnboarding: true.
    const resp = await request.get(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
    });
    expect(resp.ok()).toBe(true);
    const body = await resp.json() as Record<string, unknown>;
    expect(body.hasSeenOnboarding).toBe(true);
  });

  // ── 2. Done on last step ─────────────────────────────────────────────────

  test("overlay disappears after clicking Done on the final step", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);

    await setServerOnboardingFlag(request, false);
    await page.addInitScript(patchOnboardingLocalStorage, false);
    await page.goto("/");

    const ok = await ensureSceneLoaded(page);
    if (!ok) return;

    const dialog = page.locator(TOUR_DIALOG_SELECTOR);
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    // Step through to the last step using the step-dot nav (faster than
    // clicking Next four times and avoids timing issues with the fade).
    const lastDot = dialog.locator(`[aria-label="Go to step ${STEPS}"]`);
    await lastDot.dispatchEvent("click");
    await expect(dialog).toContainText(`STEP ${STEPS} OF ${STEPS}`, {
      timeout: 5_000,
    });

    // The Next button becomes "DONE ✓" on the last step.
    const doneBtn = dialog.locator("button", { hasText: /DONE/ });
    await expect(doneBtn).toBeVisible({ timeout: 3_000 });
    await doneBtn.dispatchEvent("click");
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });
  });

  // ── 3. No overlay on second visit ────────────────────────────────────────

  test("overlay does NOT appear when hasSeenOnboarding is already true", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);

    await setServerOnboardingFlag(request, true);
    await page.addInitScript(patchOnboardingLocalStorage, true);
    await page.goto("/");

    const ok = await ensureSceneLoaded(page);
    if (!ok) return;

    // Give the app time to hydrate from the server (brief settle period).
    await page.waitForTimeout(2_000);

    const dialog = page.locator(TOUR_DIALOG_SELECTOR);
    await expect(dialog).toHaveCount(0);
  });

  // ── 4. Replay from Settings → Onboarding ─────────────────────────────────

  test("Replay tour button in Settings resets the flag and shows the overlay", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);

    // Start with hasSeenOnboarding: true so the overlay is not visible before
    // we click the replay button.
    await setServerOnboardingFlag(request, true);
    await page.addInitScript(patchOnboardingLocalStorage, true);

    // Navigate directly to /settings — no need to wait for the 3D scene.
    await page.goto("/settings", { waitUntil: "domcontentloaded" });

    // Check sign-in status via a setting that only renders when signed in.
    const settingsPage = page.locator("text=SETTINGS").first();
    const signedIn = await settingsPage
      .isVisible({ timeout: 15_000 })
      .catch(() => false);
    if (!signedIn) {
      test.skip(true, "Settings page not visible — E2E auth bypass not active in this environment");
      return;
    }

    // Click the "GENERAL" nav tab in the Settings sidebar (replay tour lives there).
    const onboardingTab = page.locator("nav button", { hasText: "GENERAL" });
    await expect(onboardingTab).toBeVisible({ timeout: 10_000 });
    await onboardingTab.dispatchEvent("click");

    // Verify the Replay Tour button is present in the General section.
    const replayBtn = page.getByTestId("replay-tour-btn");
    await expect(replayBtn).toBeVisible({ timeout: 5_000 });

    // Clicking Replay Tour resets hasSeenOnboarding and navigates back to /.
    await replayBtn.dispatchEvent("click");

    // Wait for the SPA back-navigation to the main scene.
    await page.waitForURL((url) => !url.pathname.endsWith("/settings"), {
      timeout: 10_000,
    });

    // Seed synthetic terrain so OnboardingGuard mounts the overlay after the
    // SPA navigation (terrain is not auto-loaded in the test environment
    // quickly enough for the 20 s dialog wait to catch it).
    await page.evaluate(() => {
      (window as unknown as { __bathyTest?: { seedTerrain?: () => void } })
        .__bathyTest?.seedTerrain?.();
    });

    // The overlay should be visible now that hasSeenOnboarding is false.
    const dialog = page.locator(TOUR_DIALOG_SELECTOR);
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toContainText("STEP 1 OF 5");
  });

  // ── 5. Replay from Help window ────────────────────────────────────────────

  test("Take the tour link in the Help window sidebar triggers the overlay", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);

    // Start with hasSeenOnboarding: true so the overlay is absent initially.
    await setServerOnboardingFlag(request, true);
    await page.addInitScript(patchOnboardingLocalStorage, true);
    await page.goto("/");

    const ok = await ensureSceneLoaded(page);
    if (!ok) return;

    // Confirm the overlay is NOT visible before we trigger it.
    const dialog = page.locator(TOUR_DIALOG_SELECTOR);
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });

    // Open the Help window via the help button in the HUD.
    const helpBtn = page.getByTestId("help-button");
    await expect(helpBtn).toBeVisible({ timeout: 10_000 });
    await helpBtn.dispatchEvent("click");

    const helpWindow = page.getByTestId("help-window");
    await expect(helpWindow).toBeVisible({ timeout: 5_000 });

    // Click "Take the tour" in the Help sidebar — this resets
    // hasSeenOnboarding and closes the Help window.
    const takeTourBtn = page.getByTestId("help-take-tour-btn");
    await expect(takeTourBtn).toBeVisible({ timeout: 5_000 });
    await takeTourBtn.dispatchEvent("click");

    // Help window should close.
    await expect(helpWindow).toHaveCount(0, { timeout: 5_000 });


    // Overlay should now be visible on the main scene.
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toContainText("STEP 1 OF 5");
  });
});
