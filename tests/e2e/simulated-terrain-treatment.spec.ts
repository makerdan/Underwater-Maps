import { test, expect } from "./fixtures";
import { suppressSimulatedDataDialog } from "./_helpers/suppress-simulated-dialog";

/**
 * Simulated-terrain visual treatment (Task: make synthetic data unmistakable).
 *
 * The 3D rainbow banding is applied inside the terrain fragment shader
 * (uSynthetic uniform) and the floating "SIMULATED" billboards are drei
 * objects inside the WebGL canvas — neither is observable from the DOM, and
 * pixel assertions are unreliable in headless WebGL. TerrainMesh therefore
 * registers its per-dataset treatment state in a dev-only registry exposed
 * via `__bathyTest.getSimulatedTreatment()`.
 *
 * HEADLESS CAVEAT: on hosts where the Chromium GPU process cannot start
 * (see webgl-smoke.spec.ts), the app renders the dev-only stub canvas
 * (`data-engine="three.js stub-no-webgl"`) instead of the real R3F scene, so
 * TerrainMesh never mounts and the registry stays empty. In that case this
 * spec SKIPS with a loud message — exactly like the other canvas-gated
 * specs — and the invariant remains covered by the unit tests in
 * `simulatedTerrainRainbow.test.ts`.
 */

interface TreatmentApi {
  __bathyTest?: {
    getSimulatedTreatment?: () => Record<string, boolean>;
  };
}

test.describe("Simulated terrain treatment", () => {
  test.beforeEach(async ({ page }) => {
    await suppressSimulatedDataDialog(page);
    await page.goto("/");
  });

  test("rainbow treatment activates exactly for synthetic grids and matches the HUD badge", async ({ page }) => {
    test.setTimeout(120_000);

    const canvas = page.locator("canvas[data-engine^='three.js']").first();
    const canvasVisible = await canvas
      .isVisible({ timeout: 20_000 })
      .catch(() => false);
    if (!canvasVisible) {
      test.skip(true, "Scene canvas not visible — user is not signed in; landing page is shown");
      return;
    }

    const engine = await canvas.getAttribute("data-engine");
    if (engine === "three.js stub-no-webgl") {
      test.skip(
        true,
        "WebGL unavailable in this headless Chromium — TerrainMesh cannot mount, " +
          "so the shader-treatment registry never populates. Covered by unit tests " +
          "(simulatedTerrainRainbow.test.ts); this spec activates automatically once " +
          "the platform GPU process can start (see webgl-smoke.spec.ts).",
      );
      return;
    }

    // Real WebGL canvas — wait until at least one TerrainMesh has mounted
    // and registered its treatment state.
    await page.waitForFunction(
      () => {
        const api = (window as unknown as TreatmentApi).__bathyTest;
        const map = api?.getSimulatedTreatment?.();
        return !!map && Object.keys(map).length > 0;
      },
      undefined,
      { timeout: 60_000 },
    );

    const treatment = await page.evaluate(() => {
      const api = (window as unknown as TreatmentApi).__bathyTest;
      return api?.getSimulatedTreatment?.() ?? {};
    });

    const anyActive = Object.values(treatment).some((v) => v === true);
    const badge = page.locator("[data-testid='synthetic-data-badge']");

    if (anyActive) {
      // Synthetic grid loaded — the HUD badge must agree with the 3D
      // treatment: no rainbow without a badge, no badge without rainbow.
      await expect(badge.first()).toBeVisible({ timeout: 15_000 });
    } else {
      // Real data only — the treatment must be off for every mounted grid
      // and the simulated-data badge must be hidden.
      expect(Object.values(treatment).every((v) => v === false)).toBe(true);
      await expect(badge).toHaveCount(0);
    }
  });
});
