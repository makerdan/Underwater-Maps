import { test, expect, type Page, DEFAULT_ZONE_SLOTS_JSON } from "./fixtures";

/**
 * Zone-colour water-type isolation — end-to-end smoke test.
 *
 * Three production invariants are verified end-to-end:
 *
 *   1. NO BLEED: Changing slot 0's colour on a saltwater dataset does not
 *      change slot 0 on freshwater.  The regression path: a shared colour
 *      array, or a setSlotColor that ignores activeWaterType.
 *
 *   2. HUD ZONE ANALYSIS PANEL: After switching terrain waterType via
 *      seedTerrain, ZoneOverlay's `useEffect([terrain])` calls
 *      `setActiveWaterType(terrain.waterType)`.  The slot colour inputs in
 *      the HUD (`data-testid="zone-slot-color-0"`) must reflect the new
 *      palette immediately.
 *
 *   3. SETTINGS PAGE SWATCHES: Navigating to /settings while
 *      `settingsStore.waterType === "freshwater"` causes ZoneColoursCard's
 *      `useEffect([waterType])` to call `setActiveWaterType("freshwater")`.
 *      The `settings-zone-colour-input-0` input must show the freshwater
 *      default — this assertion is mandatory (not gated behind a visibility
 *      guard) so a rendering failure doesn't produce a silent pass.
 *
 * Strategy
 * --------
 * • Water-type switches use `seedTerrain({waterType})` (which fires
 *   ZoneOverlay's terrain useEffect) combined with
 *   `window.__bathyTest.setWaterType()` (which fires ZoneColoursCard's
 *   waterType useEffect on /settings).  Neither path calls
 *   `setActiveZoneWaterType` directly — that would bypass the wiring under
 *   test.
 * • Colour mutations use `setZoneSlotColor` (the same store action the HUD
 *   colour picker's onChange calls).  The native OS colour dialog opened by
 *   <input type="color"> is not reliably controllable in headless Playwright.
 * • If seedTerrain fails (TestBridge not registered — signed-in shell not
 *   mounted), the test skips gracefully rather than failing.  Matching the
 *   convention used by zone-paint.spec.ts and habitat-overlay.spec.ts.
 */

async function waitForTestHelpers(page: Page): Promise<boolean> {
  return page
    .waitForFunction(
      () =>
        typeof (window as unknown as { __bathyTest?: unknown }).__bathyTest !==
          "undefined" &&
        typeof (
          window as unknown as {
            __bathyTest?: { getZoneSlotColor?: unknown; setZoneSlotColor?: unknown };
          }
        ).__bathyTest?.getZoneSlotColor === "function",
      undefined,
      { timeout: 15_000 },
    )
    .then(() => true)
    .catch(() => false);
}

/** Seed saltwater terrain and a zone map; return false if TestBridge is not registered. */
async function seedSaltwaterTerrain(page: Page): Promise<boolean> {
  return page
    .waitForFunction(
      () => {
        const t = (
          window as unknown as { __bathyTest?: { seedTerrain?: () => boolean } }
        ).__bathyTest;
        return !!(
          t &&
          t.seedTerrain &&
          t.seedTerrain({ waterType: "saltwater" })
        );
      },
      undefined,
      { timeout: 15_000 },
    )
    .then(() => true)
    .catch(() => false);
}

/** Call setWaterType on the settings store (same action the water-type toggle fires). */
async function setWaterType(
  page: Page,
  wt: "saltwater" | "freshwater",
): Promise<void> {
  await page.evaluate(
    ([w]) =>
      (
        window as unknown as {
          __bathyTest: { setWaterType: (wt: "saltwater" | "freshwater") => void };
        }
      ).__bathyTest.setWaterType(w as "saltwater" | "freshwater"),
    [wt] as const,
  );
}

/** Seed terrain with a given waterType; fires ZoneOverlay's useEffect([terrain]). */
async function seedTerrain(
  page: Page,
  waterType: "saltwater" | "freshwater",
): Promise<boolean> {
  return page.evaluate(
    ([wt]) =>
      !!(
        window as unknown as {
          __bathyTest: { seedTerrain: (o: Record<string, unknown>) => boolean };
        }
      ).__bathyTest.seedTerrain({ waterType: wt }),
    [waterType] as const,
  );
}

/** Seed a zone map so the HUD Zone Colours pickers render. */
async function seedZoneMap(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as {
        __bathyTest: { seedZoneMap: (n: number) => void };
      }
    ).__bathyTest.seedZoneMap(32);
  });
}

/** Read slot colour from the store (does NOT go through the active-palette mirror). */
async function readStoreColour(
  page: Page,
  waterType: "saltwater" | "freshwater",
  slot: 0 | 1 | 2 | 3,
): Promise<string> {
  return page.evaluate(
    ([wt, s]) =>
      (
        window as unknown as {
          __bathyTest: {
            getZoneSlotColor: (
              wt: "saltwater" | "freshwater",
              s: 0 | 1 | 2 | 3,
            ) => string;
          };
        }
      ).__bathyTest.getZoneSlotColor(
        wt as "saltwater" | "freshwater",
        s as 0 | 1 | 2 | 3,
      ),
    [waterType, slot] as const,
  );
}

/** Compile-time default hex for a slot. */
async function readDefaultColour(page: Page, slot: 0 | 1 | 2 | 3): Promise<string> {
  return page.evaluate(
    ([s]) =>
      (
        window as unknown as {
          __bathyTest: { getZoneDefaultColor: (s: 0 | 1 | 2 | 3) => string };
        }
      ).__bathyTest.getZoneDefaultColor(s as 0 | 1 | 2 | 3),
    [slot] as const,
  );
}

/** Mutate slot colour in the active palette (same store action as the HUD picker onChange). */
async function setZoneSlotColor(
  page: Page,
  slot: 0 | 1 | 2 | 3,
  color: string,
): Promise<void> {
  await page.evaluate(
    ([s, c]) =>
      (
        window as unknown as {
          __bathyTest: { setZoneSlotColor: (slot: 0 | 1 | 2 | 3, color: string) => void };
        }
      ).__bathyTest.setZoneSlotColor(s as 0 | 1 | 2 | 3, c as string),
    [slot, color] as const,
  );
}

test.describe("Zone colour water-type isolation", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
  });

  test(
    "saltwater colour does not bleed into freshwater; " +
      "HUD swatches reflect each palette; " +
      "Settings swatches update on water-type switch; " +
      "saltwater colour survives round-trip",
    async ({ page }) => {
      test.setTimeout(90_000);

      // ── 0. Require dev test helpers ──────────────────────────────────────
      if (!(await waitForTestHelpers(page))) {
        test.skip(
          true,
          "window.__bathyTest zone-colour helpers not installed — dev test helpers missing",
        );
        return;
      }

      // ── 1. Load saltwater terrain + zone map ─────────────────────────────
      // seedTerrain registers terrain in AppContext so ZoneOverlay mounts and
      // its useEffect([terrain]) fires → setActiveWaterType("saltwater").
      // This is the same path as loading a real saltwater dataset.
      const terrainSeeded = await seedSaltwaterTerrain(page);
      if (!terrainSeeded) {
        test.skip(
          true,
          "TestBridge seedTerrain not registered — signed-in shell not mounted",
        );
        return;
      }

      // Also align the settings store (mirrors what the water-type toggle does).
      await setWaterType(page, "saltwater");

      // Seed a zone map so the HUD Zone Colours pickers become visible.
      await seedZoneMap(page);

      // ── 2. Wait for HUD Zone Analysis panel ──────────────────────────────
      // ZoneOverlay renders once terrain + zoneMap are both set.  With
      // headless WebGL the canvas may not initialise, but the HUD DOM still
      // renders when the React tree is healthy.
      const zonePanel = page.locator("text=Zone Analysis").first();
      const panelVisible = await zonePanel
        .isVisible({ timeout: 15_000 })
        .catch(() => false);
      if (!panelVisible) {
        test.skip(
          true,
          "Zone Analysis panel not visible — UI shell not rendered in this env",
        );
        return;
      }

      // Expand the panel if it is collapsed.
      const expandBtn = page.locator("button[aria-expanded='false']").filter({
        hasText: /Zone Analysis/i,
      });
      if (await expandBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await expandBtn.click();
      }

      // ── 3. Confirm slot 0 starts at the default colour ───────────────────
      const defaultColour = await readDefaultColour(page, 0);

      // Reset zone-colour localStorage so this test starts clean even after
      // a prior failed run that may have left a custom colour behind.
      // setItem with explicit defaults is used instead of removeItem to avoid
      // a race with Zustand store init (missing key → undefined state).
      await page.evaluate((slotsJson: string) => {
        try {
          localStorage.setItem("bathyscan:zoneOverlaySlots:saltwater", slotsJson);
          localStorage.setItem("bathyscan:zoneOverlaySlots:freshwater", slotsJson);
        } catch {}
      }, DEFAULT_ZONE_SLOTS_JSON);
      // Re-seed after clearing so the store picks up defaults from localStorage.
      await seedTerrain(page, "saltwater");
      await setWaterType(page, "saltwater");
      await seedZoneMap(page);

      // HUD colour input for slot 0.  ZoneOverlay already has
      // data-testid="zone-slot-color-{i}" on each slot's <input type="color">.
      const hudSlot0 = page.locator('[data-testid="zone-slot-color-0"]');
      await expect(hudSlot0).toBeAttached({ timeout: 8_000 });

      await expect
        .poll(
          async () => (await hudSlot0.getAttribute("value") ?? "").toLowerCase(),
          { timeout: 5_000 },
        )
        .toBe(defaultColour.toLowerCase());

      // ── 4. Change slot 0 on the saltwater palette ─────────────────────────
      const saltCustomColour = "#c0ffee";
      // Use the store helper — same action as the HUD picker's onChange.
      await setZoneSlotColor(page, 0, saltCustomColour);

      // HUD input must immediately reflect the new colour (React re-render).
      await expect
        .poll(
          async () => (await hudSlot0.getAttribute("value") ?? "").toLowerCase(),
          { timeout: 5_000 },
        )
        .toBe(saltCustomColour.toLowerCase());

      // Confirm via store read (bypasses the active-palette mirror).
      const saltAfterMutation = await readStoreColour(page, "saltwater", 0);
      expect(saltAfterMutation.toLowerCase()).toBe(saltCustomColour.toLowerCase());

      // ── 5. Switch to freshwater ──────────────────────────────────────────
      // Drive the switch through the PRODUCTION path:
      //   a. setWaterType → settingsStore.waterType changes, useWaterTypeSideEffects
      //      clears the zoneMap, ZoneColoursCard's useEffect([waterType]) (when
      //      mounted on /settings) calls setActiveWaterType("freshwater").
      //   b. seedTerrain({waterType:"freshwater"}) → ZoneOverlay's
      //      useEffect([terrain]) calls setActiveWaterType("freshwater").
      await setWaterType(page, "freshwater");
      const freshTerrainSeeded = await seedTerrain(page, "freshwater");
      expect(freshTerrainSeeded).toBe(true);
      await seedZoneMap(page);

      // HUD slot 0 must now reflect the freshwater palette's default —
      // proving that ZoneOverlay's terrain useEffect fired and the `slots`
      // mirror switched palettes.  No direct setActiveZoneWaterType call is
      // made; the hook wiring is what produces the update.
      await expect
        .poll(
          async () => (await hudSlot0.getAttribute("value") ?? "").toLowerCase(),
          { timeout: 8_000 },
        )
        .toBe(defaultColour.toLowerCase());

      // Store read also confirms no bleed: freshwater slot 0 is still default.
      const freshAfterSwitch = await readStoreColour(page, "freshwater", 0);
      expect(freshAfterSwitch.toLowerCase()).toBe(defaultColour.toLowerCase());

      // ── 6. Settings page — ZoneColoursCard useEffect wiring ──────────────
      // Navigate to /settings while settingsStore.waterType === "freshwater".
      // ZoneColoursCard mounts, its useEffect([waterType]) fires and calls
      // setActiveWaterType("freshwater").  The bound colour input must show
      // the freshwater default.  This assertion is MANDATORY — no gating on
      // visibility so a rendering failure is a test failure, not a silent pass.
      const settingsBtn = page.locator(
        'button[aria-label="Settings"], button:has-text("Settings")',
      );
      const settingsBtnVisible = await settingsBtn
        .first()
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
      if (settingsBtnVisible) {
        await settingsBtn.first().dispatchEvent("click");
        await page.waitForURL(
          (url) => url.pathname.endsWith("/settings"),
          { timeout: 5_000 },
        );
      } else {
        await page.goto("/settings");
        await page.waitForLoadState("domcontentloaded");
      }

      // Switch to the DISPLAY & OVERLAYS tab (Zone Colours lives there).
      const displayTab = page
        .locator("nav button", { hasText: /display/i })
        .first();
      await expect(displayTab).toBeVisible({ timeout: 10_000 });
      await displayTab.dispatchEvent("click");
      const zoneColoursHeading = page.locator("text=ZONE COLOURS").first();
      await expect(zoneColoursHeading).toBeVisible({ timeout: 10_000 });

      // The colour input for slot 0 is bound to slots[0].color in ZoneColoursCard.
      // After the useEffect([waterType]) fires with "freshwater", slots mirrors
      // the freshwater palette, so the input must show the freshwater default.
      const settingsSlot0 = page.locator('[data-testid="settings-zone-colour-input-0"]');
      await expect(settingsSlot0).toBeVisible({ timeout: 5_000 });
      await expect
        .poll(
          async () =>
            (await settingsSlot0.getAttribute("value") ?? "").toLowerCase(),
          { timeout: 5_000 },
        )
        .toBe(defaultColour.toLowerCase());

      // ── 7. Change slot 0 on the freshwater palette ────────────────────────
      // Navigate back to the main scene so __bathyTest helpers are available.
      const backBtn = page.locator("text=← BACK");
      if (await backBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await backBtn.dispatchEvent("click");
        await page.waitForURL(
          (url) => !url.pathname.endsWith("/settings"),
          { timeout: 5_000 },
        );
      } else {
        await page.goto("/");
        await page.waitForLoadState("domcontentloaded");
      }

      // Re-check helpers survived navigation.
      if (!(await waitForTestHelpers(page))) {
        test.skip(
          true,
          "Test helpers lost after settings navigation — skipping",
        );
        return;
      }

      // Re-seed freshwater terrain so ZoneOverlay's useEffect fires and the
      // HUD is ready for assertions.
      await seedTerrain(page, "freshwater");
      await seedZoneMap(page);
      await expect(hudSlot0).toBeAttached({ timeout: 5_000 });

      const freshCustomColour = "#abcdef";
      await setZoneSlotColor(page, 0, freshCustomColour);

      // HUD reflects the freshwater custom colour immediately.
      await expect
        .poll(
          async () => (await hudSlot0.getAttribute("value") ?? "").toLowerCase(),
          { timeout: 5_000 },
        )
        .toBe(freshCustomColour.toLowerCase());

      // Saltwater slot 0 must still hold the value from step 4 — the freshwater
      // mutation must not have clobbered the saltwater palette.
      const saltUnchanged = await readStoreColour(page, "saltwater", 0);
      expect(saltUnchanged.toLowerCase()).toBe(saltCustomColour.toLowerCase());

      // ── 8. Switch back to saltwater ───────────────────────────────────────
      // Drive through the production path again (terrain useEffect + settings store).
      await setWaterType(page, "saltwater");
      const backToSalt = await seedTerrain(page, "saltwater");
      expect(backToSalt).toBe(true);
      await seedZoneMap(page);

      // HUD slot 0 must restore to the saltwater custom colour — proving the
      // saltwater palette survived the round-trip without being clobbered.
      await expect
        .poll(
          async () => (await hudSlot0.getAttribute("value") ?? "").toLowerCase(),
          { timeout: 8_000 },
        )
        .toBe(saltCustomColour.toLowerCase());

      // Final store reads confirm both palettes are intact.
      const saltFinal = await readStoreColour(page, "saltwater", 0);
      expect(saltFinal.toLowerCase()).toBe(saltCustomColour.toLowerCase());

      const freshFinal = await readStoreColour(page, "freshwater", 0);
      expect(freshFinal.toLowerCase()).toBe(freshCustomColour.toLowerCase());

      // ── 9. Clean up ───────────────────────────────────────────────────────
      // Restore zone slots to defaults rather than removing the keys (removing
      // leaves state undefined and races with Zustand rehydration in any
      // immediately following test in the same worker).
      await page.evaluate((slotsJson: string) => {
        try {
          localStorage.setItem("bathyscan:zoneOverlaySlots:saltwater", slotsJson);
          localStorage.setItem("bathyscan:zoneOverlaySlots:freshwater", slotsJson);
        } catch {}
      }, DEFAULT_ZONE_SLOTS_JSON);
    },
  );
});
