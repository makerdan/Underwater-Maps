import { test, expect, type Page, DEFAULT_ZONE_SLOTS_JSON } from "./fixtures";

/**
 * Zone-colour water-type isolation — Settings-page flow (headless-safe).
 *
 * Split off from zone-colour-watertype.spec.ts, whose HUD-panel gate
 * ("Zone Analysis panel not visible") skips the whole test in headless
 * environments where the 3D HUD shell doesn't render. This spec exercises
 * the same production wiring WITHOUT any dependency on the HUD:
 *
 *   1. SETTINGS SWATCH WIRING: ZoneColourSwatches' `useEffect([waterType])`
 *      calls `setActiveWaterType(waterType)`, so the bound
 *      `settings-zone-colour-input-{i}` inputs must mirror the palette for
 *      the currently selected water type.
 *
 *   2. NO BLEED: Changing slot 0's colour while the saltwater palette is
 *      active must not change slot 0 on the freshwater palette (and vice
 *      versa). The regression path: a shared colour array, or a
 *      setSlotColor that ignores activeWaterType.
 *
 *   3. ROUND-TRIP: Switching saltwater → freshwater → saltwater restores
 *      the saltwater custom colour in the Settings input.
 *
 * Strategy
 * --------
 * • NO skip gates. The `__bathyTest` helpers are installed by main.tsx in
 *   every dev build (the same build the e2e webServer runs), so their
 *   absence is a product/build failure, not an environment limitation —
 *   this spec hard-fails instead of silently skipping.
 * • Water-type switches go through `__bathyTest.setWaterType` — the same
 *   settingsStore action the water-type toggle fires — so the
 *   ZoneColourSwatches `useEffect([waterType])` wiring is what's under
 *   test. No direct `setActiveZoneWaterType` calls.
 * • Colour mutations use `setZoneSlotColor` (the same store action the
 *   colour input's onChange calls). The native OS colour dialog opened by
 *   <input type="color"> is not controllable in headless Playwright.
 */

async function waitForTestHelpers(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const t = (
        window as unknown as {
          __bathyTest?: {
            getZoneSlotColor?: unknown;
            setZoneSlotColor?: unknown;
            setWaterType?: unknown;
          };
        }
      ).__bathyTest;
      return !!(
        t &&
        typeof t.getZoneSlotColor === "function" &&
        typeof t.setZoneSlotColor === "function" &&
        typeof t.setWaterType === "function"
      );
    },
    undefined,
    { timeout: 15_000 },
  );
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

/** Mutate slot colour in the active palette (same store action as the picker onChange). */
async function setZoneSlotColor(
  page: Page,
  slot: 0 | 1 | 2 | 3,
  color: string,
): Promise<void> {
  await page.evaluate(
    ([s, c]) =>
      (
        window as unknown as {
          __bathyTest: {
            setZoneSlotColor: (slot: 0 | 1 | 2 | 3, color: string) => void;
          };
        }
      ).__bathyTest.setZoneSlotColor(s as 0 | 1 | 2 | 3, c as string),
    [slot, color] as const,
  );
}

/** Poll the Settings-page slot-0 colour input value (lowercased). */
function settingsSlot0Value(page: Page) {
  const input = page.locator('[data-testid="settings-zone-colour-input-0"]');
  return expect.poll(
    async () => ((await input.getAttribute("value")) ?? "").toLowerCase(),
    { timeout: 8_000 },
  );
}

test.describe("Zone colour water-type isolation — Settings page", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((slotsJson: string) => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
        // Reset zone-colour localStorage so this test starts clean even after
        // a prior failed run left a custom colour behind. setItem with explicit
        // defaults (not removeItem) avoids a race with Zustand store init.
        localStorage.setItem("bathyscan:zoneOverlaySlots:saltwater", slotsJson);
        localStorage.setItem("bathyscan:zoneOverlaySlots:freshwater", slotsJson);
      } catch {}
    }, DEFAULT_ZONE_SLOTS_JSON);
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
  });

  test(
    "Settings swatches follow the active water type; palette colours don't bleed and survive a round-trip",
    async ({ page }) => {
      test.setTimeout(60_000);

      // ── 0. Dev test helpers are mandatory in the e2e dev build ──────────
      await waitForTestHelpers(page);

      // Start from a known water type (same action the toggle fires).
      await setWaterType(page, "saltwater");

      // ── 1. Open the DISPLAY & OVERLAYS tab (Zone Colours lives there) ───
      const displayTab = page
        .locator("nav button", { hasText: /display/i })
        .first();
      await expect(displayTab).toBeVisible({ timeout: 10_000 });
      await displayTab.dispatchEvent("click");
      await expect(page.locator("text=ZONE COLOURS").first()).toBeVisible({
        timeout: 10_000,
      });

      const settingsSlot0 = page.locator(
        '[data-testid="settings-zone-colour-input-0"]',
      );
      await expect(settingsSlot0).toBeAttached({ timeout: 8_000 });

      // ── 2. Slot 0 starts at the compile-time default ─────────────────────
      const defaultColour = (await readDefaultColour(page, 0)).toLowerCase();
      await settingsSlot0Value(page).toBe(defaultColour);

      // ── 3. Change slot 0 on the saltwater palette ─────────────────────────
      // ZoneColourSwatches' useEffect([waterType]) already activated the
      // saltwater palette, so setZoneSlotColor writes to it.
      const saltCustomColour = "#c0ffee";
      await setZoneSlotColor(page, 0, saltCustomColour);
      await settingsSlot0Value(page).toBe(saltCustomColour);

      // Store read confirms the write landed on the saltwater palette.
      expect((await readStoreColour(page, "saltwater", 0)).toLowerCase()).toBe(
        saltCustomColour,
      );

      // ── 4. Switch to freshwater via the production path ───────────────────
      // setWaterType → settingsStore.waterType changes → ZoneColourSwatches'
      // useEffect([waterType]) fires → setActiveWaterType("freshwater") →
      // the bound input mirrors the freshwater palette.
      await setWaterType(page, "freshwater");
      await settingsSlot0Value(page).toBe(defaultColour);

      // NO BLEED: freshwater slot 0 is still default; saltwater kept its custom.
      expect((await readStoreColour(page, "freshwater", 0)).toLowerCase()).toBe(
        defaultColour,
      );
      expect((await readStoreColour(page, "saltwater", 0)).toLowerCase()).toBe(
        saltCustomColour,
      );

      // ── 5. Change slot 0 on the freshwater palette ────────────────────────
      const freshCustomColour = "#abcdef";
      await setZoneSlotColor(page, 0, freshCustomColour);
      await settingsSlot0Value(page).toBe(freshCustomColour);

      // Saltwater must be untouched by the freshwater mutation.
      expect((await readStoreColour(page, "saltwater", 0)).toLowerCase()).toBe(
        saltCustomColour,
      );

      // ── 6. Round-trip back to saltwater ───────────────────────────────────
      await setWaterType(page, "saltwater");
      await settingsSlot0Value(page).toBe(saltCustomColour);

      // Final store reads confirm both palettes are intact.
      expect((await readStoreColour(page, "saltwater", 0)).toLowerCase()).toBe(
        saltCustomColour,
      );
      expect((await readStoreColour(page, "freshwater", 0)).toLowerCase()).toBe(
        freshCustomColour,
      );

      // ── 7. Clean up ───────────────────────────────────────────────────────
      // Restore both palettes to defaults through the store (so any debounced
      // server sync also persists defaults), then re-seed localStorage.
      await setZoneSlotColor(page, 0, defaultColour); // active: saltwater
      await setWaterType(page, "freshwater");
      await settingsSlot0Value(page).toBe(freshCustomColour);
      await setZoneSlotColor(page, 0, defaultColour); // active: freshwater
      await page.evaluate((slotsJson: string) => {
        try {
          localStorage.setItem("bathyscan:zoneOverlaySlots:saltwater", slotsJson);
          localStorage.setItem("bathyscan:zoneOverlaySlots:freshwater", slotsJson);
        } catch {}
      }, DEFAULT_ZONE_SLOTS_JSON);
    },
  );
});
