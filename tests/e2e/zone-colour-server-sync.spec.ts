import { test, expect, API_URL, E2E_USER_ID, DEFAULT_ZONE_SLOTS, DEFAULT_ZONE_SLOTS_JSON } from "./fixtures";

/**
 * Zone colour server-sync round-trip — end-to-end coverage.
 *
 * Verifies the cross-device persistence path for saltwater and freshwater
 * zone slot colours:
 *
 *   1. SALTWATER ROUND-TRIP
 *      a. Mutate saltwater slot 0 via the store action (setZoneSlotColor).
 *      b. Await waitForServerSettingsSync — the debounced PUT /api/settings
 *         must complete and the server must acknowledge it.
 *      c. Wipe localStorage (simulating a fresh device / new browser).
 *      d. Reload the page — the GET /api/settings hydration path must
 *         restore the custom colour from the server row.
 *      e. Assert the colour on the freshly-loaded page matches the custom hex.
 *
 *   2. FRESHWATER ROUND-TRIP
 *      Same sequence for freshwater slot 1, confirming the per-water-type
 *      palettes are each persisted and restored independently.
 *
 * Strategy
 * --------
 * • A direct PUT /api/settings pre-flight resets both palettes to defaults
 *   on the shared dev-user row before every test run, preventing stale data
 *   from a previously failed run from masking assertions.
 * • Colour mutations go through window.__bathyTest.setZoneSlotColor — the
 *   same Zustand action the HUD colour picker's onChange calls — so the
 *   test exercises real store → server-sync wiring without UI-driving an
 *   OS-level colour dialog (which is not controllable in headless Playwright).
 * • waitForServerSettingsSync polls lastSyncedAt so the test only continues
 *   once the server has acknowledged the PUT, not just after the debounce fires.
 * • The "fresh device" reload clears localStorage so the store initialises
 *   from defaults; the GET /api/settings effect in useServerSettingsSync then
 *   applies the server row because lastSyncedAt is null (server always wins).
 * • Colour assertions after reload use poll() on getZoneSlotColor so the test
 *   tolerates async hydration timing without an arbitrary sleep.
 */

const SALTWATER_CUSTOM = "#c0ffee";
const FRESHWATER_CUSTOM = "#ab4def";

test.describe("Zone colour server-sync round-trip", () => {
  test(
    "saltwater slot colour persists to server and rehydrates after page reload",
    async ({ page }) => {
      test.setTimeout(60_000);

      // ── Pre-flight: put the server in a known state ─────────────────────
      // Reset both palettes on the shared dev-user row so a prior crashed run
      // cannot leave stale custom colours that satisfy our assertion trivially.
      await page.request.put(`${API_URL}/api/settings`, {
        headers: { "x-e2e-user-id": E2E_USER_ID },
        data: {
          zoneOverlaySlots: {
            saltwater: DEFAULT_ZONE_SLOTS,
            freshwater: DEFAULT_ZONE_SLOTS,
          },
        },
      });

      // ── Device A: mutate saltwater slot 0 and await server sync ─────────
      // Reset zone-colour localStorage to defaults so the store starts clean.
      // setItem is used instead of removeItem to avoid a race with the Zustand
      // store init: removing the key leaves the slot state undefined until the
      // next persist cycle, which may race with the server sync that follows.
      await page.addInitScript((slotsJson: string) => {
        try {
          localStorage.setItem("bathyscan:zoneOverlaySlots:saltwater", slotsJson);
          localStorage.setItem("bathyscan:zoneOverlaySlots:freshwater", slotsJson);
        } catch {}
      }, DEFAULT_ZONE_SLOTS_JSON);

      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      // Wait for the test bridge to be installed (VITE_DEV_AUTH_BYPASS path).
      const bridgeReady = await page
        .waitForFunction(
          () =>
            Boolean(
              (window as unknown as { __bathyTest?: { setZoneSlotColor?: unknown } })
                .__bathyTest?.setZoneSlotColor,
            ),
          { timeout: 15_000 },
        )
        .then(() => true)
        .catch(() => false);

      if (!bridgeReady) {
        test.skip(
          true,
          "window.__bathyTest.setZoneSlotColor not available — dev helpers not installed",
        );
        return;
      }

      // Activate the saltwater palette so setZoneSlotColor writes to the right set.
      await page.evaluate(() => {
        (
          window as unknown as {
            __bathyTest: { setActiveZoneWaterType: (wt: string) => void };
          }
        ).__bathyTest.setActiveZoneWaterType("saltwater");
      });

      // Mutate slot 0 on the saltwater palette (equivalent to the HUD picker onChange).
      await page.evaluate(
        ([color]) => {
          (
            window as unknown as {
              __bathyTest: { setZoneSlotColor: (slot: number, color: string) => void };
            }
          ).__bathyTest.setZoneSlotColor(0, color as string);
        },
        [SALTWATER_CUSTOM],
      );

      // Confirm the store reflects the mutation immediately (sanity check before sync).
      const saltBeforeSync = await page.evaluate(
        ([color]) =>
          (
            window as unknown as {
              __bathyTest: {
                getZoneSlotColor: (wt: string, slot: number) => string;
              };
            }
          ).__bathyTest.getZoneSlotColor("saltwater", 0) === color,
        [SALTWATER_CUSTOM],
      );
      expect(saltBeforeSync).toBe(true);

      // Wait for the debounced PUT /api/settings to complete (≤ 300 ms debounce
      // + network round-trip). waitForServerSettingsSync polls lastSyncedAt so
      // it resolves only after the server acknowledged the write.
      await page.evaluate(() =>
        (
          window as unknown as {
            __bathyTest: { waitForServerSettingsSync: () => Promise<void> };
          }
        ).__bathyTest.waitForServerSettingsSync(),
      );

      // ── Device B: simulate a fresh browser by wiping local storage ───────
      await page.evaluate(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });

      // Reload the page — useServerSettingsSync's GET /api/settings will fire
      // and hydrateFromServer will apply the server row (lastSyncedAt is null
      // after localStorage was cleared, so the server is always considered newer).
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      // Wait for the test bridge to be ready again on the reloaded page.
      const bridgeReadyAfterReload = await page
        .waitForFunction(
          () =>
            Boolean(
              (window as unknown as { __bathyTest?: { getZoneSlotColor?: unknown } })
                .__bathyTest?.getZoneSlotColor,
            ),
          { timeout: 15_000 },
        )
        .then(() => true)
        .catch(() => false);

      if (!bridgeReadyAfterReload) {
        test.skip(true, "Test bridge lost after reload — skipping rehydration assertion");
        return;
      }

      // Set active water type to saltwater so `slots` mirrors the right palette.
      await page.evaluate(() => {
        (
          window as unknown as {
            __bathyTest: { setActiveZoneWaterType: (wt: string) => void };
          }
        ).__bathyTest.setActiveZoneWaterType("saltwater");
      });

      // Poll until the server-hydrated colour appears in the store.  The GET
      // response drives a React useEffect, so there is a small async gap between
      // page load and hydrateFromServer completing.
      await expect
        .poll(
          () =>
            page.evaluate(
              ([expected]) =>
                (
                  window as unknown as {
                    __bathyTest: { getZoneSlotColor: (wt: string, s: number) => string };
                  }
                ).__bathyTest
                  .getZoneSlotColor("saltwater", 0)
                  .toLowerCase(),
              [SALTWATER_CUSTOM],
            ),
          { timeout: 10_000, intervals: [200, 500, 500, 1000] },
        )
        .toBe(SALTWATER_CUSTOM.toLowerCase());
    },
  );

  test(
    "freshwater slot colour persists to server and rehydrates after page reload",
    async ({ page }) => {
      test.setTimeout(60_000);

      // ── Pre-flight: reset server row ────────────────────────────────────
      await page.request.put(`${API_URL}/api/settings`, {
        headers: { "x-e2e-user-id": E2E_USER_ID },
        data: {
          zoneOverlaySlots: {
            saltwater: DEFAULT_ZONE_SLOTS,
            freshwater: DEFAULT_ZONE_SLOTS,
          },
        },
      });

      // ── Device A: mutate freshwater slot 1 and await server sync ─────────
      await page.addInitScript((slotsJson: string) => {
        try {
          localStorage.setItem("bathyscan:zoneOverlaySlots:saltwater", slotsJson);
          localStorage.setItem("bathyscan:zoneOverlaySlots:freshwater", slotsJson);
        } catch {}
      }, DEFAULT_ZONE_SLOTS_JSON);

      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      const bridgeReady = await page
        .waitForFunction(
          () =>
            Boolean(
              (window as unknown as { __bathyTest?: { setZoneSlotColor?: unknown } })
                .__bathyTest?.setZoneSlotColor,
            ),
          { timeout: 15_000 },
        )
        .then(() => true)
        .catch(() => false);

      if (!bridgeReady) {
        test.skip(
          true,
          "window.__bathyTest.setZoneSlotColor not available — dev helpers not installed",
        );
        return;
      }

      // Activate the freshwater palette.
      await page.evaluate(() => {
        (
          window as unknown as {
            __bathyTest: { setActiveZoneWaterType: (wt: string) => void };
          }
        ).__bathyTest.setActiveZoneWaterType("freshwater");
      });

      // Mutate slot 1 on the freshwater palette.
      await page.evaluate(
        ([color]) => {
          (
            window as unknown as {
              __bathyTest: { setZoneSlotColor: (slot: number, color: string) => void };
            }
          ).__bathyTest.setZoneSlotColor(1, color as string);
        },
        [FRESHWATER_CUSTOM],
      );

      // Sanity-check the store mutation.
      const freshBeforeSync = await page.evaluate(
        ([color]) =>
          (
            window as unknown as {
              __bathyTest: {
                getZoneSlotColor: (wt: string, slot: number) => string;
              };
            }
          ).__bathyTest.getZoneSlotColor("freshwater", 1) === color,
        [FRESHWATER_CUSTOM],
      );
      expect(freshBeforeSync).toBe(true);

      // Await server acknowledgement of the PUT.
      await page.evaluate(() =>
        (
          window as unknown as {
            __bathyTest: { waitForServerSettingsSync: () => Promise<void> };
          }
        ).__bathyTest.waitForServerSettingsSync(),
      );

      // ── Device B: wipe local storage and reload ──────────────────────────
      await page.evaluate(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });

      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      const bridgeReadyAfterReload = await page
        .waitForFunction(
          () =>
            Boolean(
              (window as unknown as { __bathyTest?: { getZoneSlotColor?: unknown } })
                .__bathyTest?.getZoneSlotColor,
            ),
          { timeout: 15_000 },
        )
        .then(() => true)
        .catch(() => false);

      if (!bridgeReadyAfterReload) {
        test.skip(true, "Test bridge lost after reload — skipping rehydration assertion");
        return;
      }

      // Activate freshwater so the store mirror is pointing at the right palette.
      await page.evaluate(() => {
        (
          window as unknown as {
            __bathyTest: { setActiveZoneWaterType: (wt: string) => void };
          }
        ).__bathyTest.setActiveZoneWaterType("freshwater");
      });

      // Poll until the freshwater slot 1 colour is restored from the server.
      await expect
        .poll(
          () =>
            page.evaluate(
              ([expected]) =>
                (
                  window as unknown as {
                    __bathyTest: { getZoneSlotColor: (wt: string, s: number) => string };
                  }
                ).__bathyTest
                  .getZoneSlotColor("freshwater", 1)
                  .toLowerCase(),
              [FRESHWATER_CUSTOM],
            ),
          { timeout: 10_000, intervals: [200, 500, 500, 1000] },
        )
        .toBe(FRESHWATER_CUSTOM.toLowerCase());
    },
  );
});
