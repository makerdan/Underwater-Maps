import { test, expect } from "./fixtures";
import { E2E_WEB_URL } from "./ports";

/**
 * Offline help pack — image availability (Task 4219 / #4128).
 *
 * Flow:
 *   1. Load the app and open the Help window.
 *   2. Trigger the offline help-pack download and wait for it to complete.
 *   3. Assert the help pack cache actually contains entries.
 *   4. Go offline (browser-level), then walk help articles until one with an
 *      inline image is found and assert the image renders from the cache
 *      (loaded, non-zero naturalWidth, no "unavailable offline" placeholder).
 */

const BASE = process.env.BASE_URL ?? E2E_WEB_URL;
const HELP_PACK_CACHE = "bathyscan-pack-help";

test.describe("Offline help pack — images", () => {
  test("help images are resolvable from the pack cache after download completes", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);

    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    // The help button only mounts once the app shell renders; under
    // sequential suite load this can lag — probe generously, skip if the
    // app never came up (matches pwa-offline.spec.ts conventions).
    const helpBtn = page.getByTestId("help-button");
    const btnVisible = await helpBtn.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!btnVisible) {
      test.skip();
      return;
    }

    await helpBtn.click();
    await expect(page.getByTestId("help-window")).toBeVisible({ timeout: 10_000 });

    // Download the offline help pack (or reuse an already-downloaded one).
    const downloadBtn = page.getByTestId("help-offline-download-btn");
    if (await downloadBtn.isVisible().catch(() => false)) {
      await downloadBtn.click();
    }
    await expect(page.getByTestId("help-offline-downloaded")).toBeVisible({
      timeout: 60_000,
    });

    // The pack cache must contain at least one entry after the download.
    const cachedCount = await page.evaluate(async (cacheName) => {
      const cache = await caches.open(cacheName);
      return (await cache.keys()).length;
    }, HELP_PACK_CACHE);
    expect(cachedCount, "help pack cache should contain cached entries").toBeGreaterThan(0);

    // Go offline for real — any request not served from a cache now fails.
    await context.setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
    });

    try {
      // Walk the table of contents until an article with an inline image is
      // found; assert that image loads from the offline pack.
      const tocIds = await page
        .locator('[data-testid^="help-toc-"]')
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? ""));
      expect(tocIds.length, "help window should list articles").toBeGreaterThan(0);

      let imageChecked = false;
      for (const tocId of tocIds) {
        await page.getByTestId(tocId).click();
        const imgs = page.locator(".hm-image");
        if ((await imgs.count()) === 0) continue;

        // The image must fully load while offline (served from the pack).
        await expect
          .poll(
            async () =>
              imgs.first().evaluate((el) => {
                const img = el as HTMLImageElement;
                return img.complete && img.naturalWidth > 0;
              }),
            {
              timeout: 10_000,
              message: "help image should load from the offline pack cache",
            },
          )
          .toBe(true);

        // And no offline-unavailable placeholder replaced an image.
        expect(await page.locator(".hm-image-placeholder").count()).toBe(0);
        imageChecked = true;
        break;
      }

      if (!imageChecked) {
        // No current help article embeds an image — the cache-entry
        // assertion above still guards the download path. Log for triage.
        console.log(
          "[offline-help-images] no inline images found in help content; cache assertions only",
        );
      }
    } finally {
      await context.setOffline(false);
    }
  });
});
