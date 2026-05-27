import { test, expect, type Page } from "./fixtures";
import crypto from "node:crypto";

/**
 * Habitat overlay end-to-end coverage (Task #202).
 *
 * The habitat scoring math is already covered by unit tests. This spec locks
 * down the full UI → store → shader path so a regression like the recent
 * wrong-texture-format bug (which produced a blank amber overlay) would fail
 * here first.
 *
 * Flow per case:
 *   1. Seed a synthetic terrain via the dev-only `window.__bathyTest` helper
 *      (saltwater or freshwater) with a non-uniform depth ramp so habitat
 *      scoring yields real variation.
 *   2. Capture a baseline screenshot of the WebGL canvas while no species is
 *      selected.
 *   3. Pick a species through the HabitatPanel <select> the same way a user
 *      would; assert the habitat store now has non-zero scores in a
 *      habitat-likely region (the depth ramp guarantees this).
 *   4. Capture a second canvas screenshot and assert the pixel hash differs
 *      from baseline — proves the amber overlay actually reached the GPU.
 *   5. Set the species back to "— disabled —" and assert the canvas hash
 *      returns to (or near) the baseline, confirming the overlay shuts off.
 *
 * Renderer liveliness is proven separately by comparing the canvas hash
 * BEFORE seeding terrain vs AFTER seeding it. A working WebGL stack must
 * produce a different frame between an empty scene and a 0–200 m depth
 * ramp. If those hashes match (or either is null), the headless WebGL
 * context isn't drawing real pixels in this env and the spec skips with a
 * clear reason — we do NOT fall back to a weaker store-only check, because
 * that's exactly the failure mode (blank overlay) we exist to catch.
 *
 * Once liveliness is proven, every subsequent pixel assertion is a HARD
 * failure: selecting a species MUST change canvas pixels, and disabling it
 * MUST restore them to the no-species baseline.
 */

async function waitForTestHelpers(page: Page): Promise<boolean> {
  return await page
    .waitForFunction(
      () =>
        typeof (window as unknown as { __bathyTest?: unknown }).__bathyTest !==
        "undefined",
      undefined,
      { timeout: 15_000 },
    )
    .then(() => true)
    .catch(() => false);
}

async function seedTerrainOrSkip(
  page: Page,
  waterType: "saltwater" | "freshwater",
): Promise<boolean> {
  // 64×64 grid with a west→east depth ramp 0→200 m. The ramp guarantees a
  // wide band of cells lands inside every species' depthOptimal window so
  // habitat scoring produces non-zero values everywhere a species applies.
  const seeded = await page.evaluate(
    ({ wt }) => {
      const N = 64;
      const depths: number[] = new Array(N * N);
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          depths[r * N + c] = (c / (N - 1)) * 200;
        }
      }
      const helper = (
        window as unknown as {
          __bathyTest?: {
            seedTerrain?: (overrides?: Record<string, unknown>) => boolean;
          };
        }
      ).__bathyTest;
      if (!helper?.seedTerrain) return false;
      return helper.seedTerrain({
        resolution: N,
        width: N,
        height: N,
        depths,
        minDepth: 0,
        maxDepth: 200,
        waterType: wt,
      });
    },
    { wt: waterType },
  );
  return !!seeded;
}

async function canvasHash(page: Page): Promise<string | null> {
  // Read the WebGL canvas's drawing buffer directly via toDataURL so we
  // get the actual rendered frame instead of a Playwright region capture
  // (which can pick up DOM background pixels when the GL canvas isn't
  // composited). Requires preserveDrawingBuffer to be enabled on the
  // Three.js context — playwright.config.ts sets VITE_E2E_PRESERVE_BUFFER=1
  // which the TerrainScene reads to flip that flag in dev builds.
  const dataUrl = await page.evaluate(() => {
    // Prefer the largest canvas (the R3F terrain canvas spans 100vw/100vh,
    // whereas Minimap/overview map canvases are far smaller).
    const all = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    if (all.length === 0) return null;
    let best: HTMLCanvasElement | null = null;
    let bestArea = -1;
    for (const c of all) {
      const area = c.width * c.height;
      if (area > bestArea) {
        bestArea = area;
        best = c;
      }
    }
    if (!best) return null;
    try {
      return best.toDataURL("image/png");
    } catch {
      return null;
    }
  });
  if (!dataUrl) return null;
  return crypto.createHash("sha1").update(dataUrl).digest("hex");
}

interface HabitatSummary {
  activeSpecies: string | null;
  scoreCount: number;
  nonZeroCount: number;
  maxScore: number;
  hotspotCount: number;
}

async function readHabitatSummary(page: Page): Promise<HabitatSummary> {
  return await page.evaluate(() => {
    return (
      window as unknown as {
        __bathyTest: { getHabitatSummary: () => HabitatSummary };
      }
    ).__bathyTest.getHabitatSummary();
  });
}

async function runHabitatCase(
  page: Page,
  waterType: "saltwater" | "freshwater",
  speciesId: string,
): Promise<void> {
  await page.goto("/");
  // domcontentloaded (not networkidle): the home route keeps long-lived
  // requests open (NOAA, surface-conditions, terrain warm-up) so networkidle
  // never resolves before Playwright's 30 s timeout. The waitForFunction
  // calls below handle synchronisation with the dev test helpers instead.
  await page.waitForLoadState("domcontentloaded");

  if (!(await waitForTestHelpers(page))) {
    test.skip(true, "window.__bathyTest not installed — dev test helpers missing");
    return;
  }

  // The TestBridge registers setTerrain inside AppProvider only when the
  // signed-in shell mounts (via VITE_DEV_AUTH_BYPASS).
  const bridged = await page
    .waitForFunction(
      () => {
        const t = (window as unknown as {
          __bathyTest?: { seedTerrain?: (o?: unknown) => boolean };
        }).__bathyTest;
        return !!(t && t.seedTerrain);
      },
      undefined,
      { timeout: 15_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!bridged) {
    test.skip(true, "TestBridge setTerrain not registered — signed-in shell not mounted");
    return;
  }

  // ── Prove the renderer is actually drawing frames in this env ──────────
  // Capture the canvas BEFORE seeding terrain (no mesh) and AFTER (a
  // 0–200 m depth ramp). A working WebGL stack MUST produce a visibly
  // different frame between those two states. If the hashes match or
  // either is null, the headless WebGL stack is not drawing real pixels
  // and we cannot make pixel-level assertions — skip the spec rather than
  // falling back to a weaker store-only check that would let the exact
  // regression this spec exists to catch (blank overlay) pass silently.
  const preSeedHash = await canvasHash(page);

  if (!(await seedTerrainOrSkip(page, waterType))) {
    test.skip(true, "seedTerrain failed — signed-in shell not mounted");
    return;
  }

  // HabitatPanel only renders once terrain is non-null. Wait for it to mount
  // so we know the React tree picked up the seeded terrain.
  const panel = page.locator(".habitat-panel");
  const panelVisible = await panel.isVisible({ timeout: 10_000 }).catch(() => false);
  if (!panelVisible) {
    test.skip(true, "HabitatPanel not visible — UI shell not rendered in this env");
    return;
  }

  // Confirm the panel is reporting the right water type — proves the seeded
  // terrain reached the HabitatPanel through AppContext.
  const wtLabel = waterType === "freshwater" ? "freshwater" : "marine";
  await expect(panel.locator(`text=SPECIES (${wtLabel})`)).toBeVisible({
    timeout: 5_000,
  });

  // Allow the terrain fade-in (~400 ms) plus a small buffer to settle so
  // the post-seed frame represents the steady-state "no species" view.
  await page.waitForTimeout(1000);
  const noSpeciesHash = await canvasHash(page);
  if (!preSeedHash || !noSpeciesHash || preSeedHash === noSpeciesHash) {
    test.skip(
      true,
      "Canvas did not change after seeding terrain (headless WebGL unavailable) — pixel assertions are impossible in this env",
    );
    return;
  }

  const beforeSummary = await readHabitatSummary(page);
  expect(beforeSummary.activeSpecies).toBeNull();
  expect(beforeSummary.nonZeroCount).toBe(0);

  // Pick the species through the same <select> the user interacts with so
  // we exercise HabitatPanel's onChange handler end-to-end.
  const select = panel.locator("select.habitat-overlay-toggle");
  await expect(select).toBeVisible({ timeout: 5_000 });
  await select.selectOption(speciesId);

  // Wait for the store to update (setSpecies is synchronous but React state
  // propagation through the useEffect compute path takes a tick).
  await expect
    .poll(async () => (await readHabitatSummary(page)).activeSpecies, {
      timeout: 5_000,
    })
    .toBe(speciesId);

  const activeSummary = await readHabitatSummary(page);
  expect(activeSummary.scoreCount).toBe(64 * 64);
  // The depth ramp spans 0–200 m, which covers every species' optimal band,
  // so a non-trivial fraction of cells must land in a habitat-likely region.
  expect(activeSummary.nonZeroCount).toBeGreaterThan(64 * 64 * 0.25);
  expect(activeSummary.maxScore).toBeGreaterThan(0.5);

  // Give the shader effect a couple of frames to upload the new DataTexture
  // and the useFrame loop to flip uShowHabitat to 1.
  await page.waitForTimeout(800);
  const activeHash = await canvasHash(page);
  expect(activeHash).not.toBeNull();
  // The amber overlay MUST change canvas pixels — this is the regression
  // the spec exists to catch (wrong texture format → blank overlay would
  // leave the hash unchanged).
  expect(activeHash).not.toBe(noSpeciesHash);

  // Disable the species through the same <select> by selecting the
  // "— disabled —" option (value=""). This exercises HabitatPanel's
  // onChange null-id branch end-to-end instead of bypassing it.
  await select.selectOption("");
  await expect
    .poll(async () => (await readHabitatSummary(page)).activeSpecies, {
      timeout: 5_000,
    })
    .toBeNull();
  await page.waitForTimeout(800);
  const restoredHash = await canvasHash(page);
  expect(restoredHash).toBe(noSpeciesHash);
}

test.describe("Habitat overlay", () => {
  test("saltwater species lights up the terrain and disabling restores baseline", async ({
    page,
  }) => {
    await runHabitatCase(page, "saltwater", "halibut");
  });

  test("freshwater species lights up the terrain on a freshwater dataset", async ({
    page,
  }) => {
    await runHabitatCase(page, "freshwater", "rainbow_trout");
  });
});
