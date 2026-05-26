import type { Locator, Page } from "@playwright/test";

/**
 * Centralised canvas locators for the BathyScan HUD.
 *
 * The HUD now contains multiple `<canvas>` elements (three.js terrain,
 * Minimap, OverviewMap, depth-profile sparkline, …) and a bare
 * `page.locator("canvas")` is no longer unambiguous — when a second canvas
 * was added the e2e suite started failing with strict-mode violations and
 * "click intercepted by other canvas" errors. Always prefer one of the
 * helpers here over `locator("canvas")` / `locator("canvas").nth(0)` so
 * the next canvas added to the HUD doesn't silently break tests.
 */

/**
 * The main three.js terrain canvas. Detected via the `data-engine`
 * attribute that three.js's WebGLRenderer sets on its output canvas
 * (e.g. `three.js r184 webgl1`).
 */
export function terrainCanvas(page: Page): Locator {
  return page.locator('canvas[data-engine^="three.js"]');
}

/**
 * The OverviewMap (big "Open overview map" overlay) canvas. Targeted by a
 * dedicated testid on the component so future canvas additions inside the
 * overlay can't shadow it.
 */
export function overviewMapCanvas(page: Page): Locator {
  return page.getByTestId("overview-map-canvas");
}

/**
 * The Minimap canvas (small HUD radar in the corner). Targeted by its
 * dedicated testid.
 */
export function minimapCanvas(page: Page): Locator {
  return page.getByTestId("minimap-canvas");
}
