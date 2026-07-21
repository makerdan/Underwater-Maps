/**
 * ManualConditionsChip — mobile viewport e2e test.
 *
 * Guards against the persistent sidebar "manual conditions" chip silently
 * clipping off-screen or overflowing on small phone widths after future
 * sidebar layout changes (the chip previously had a fixed 230–260px width
 * with no mobile variant).
 *
 * Verifies at a small phone viewport (390×740, below the 768px mobile
 * breakpoint AND at the 390px narrow breakpoint boundary):
 *   1. The chip is visible when manual conditions are active.
 *   2. Its bounding box fits fully inside the viewport (no horizontal clip).
 *   3. The label shows the compact mobile variant including the lake name.
 *
 * Strategy mirrors manual-conditions.spec.ts: localStorage is pre-seeded via
 * addInitScript (values passed as the second arg — closures are dropped),
 * then synthetic terrain is loaded via window.__bathyTest.seedTerrain().
 */
import { test, expect, API_URL, E2E_USER_ID } from "./fixtures";

const SYNTHETIC_ID = "e2e-chip-mobile";
const LAKE_NAME = "Lake Minnetonka";

interface ManualConditions {
  windSpeedKnots: number;
  windDirectionDeg: number;
  surfaceTempC: number | null;
  currentSpeedKnots: number;
  currentDirectionDeg: number;
  waterLevelM: number | null;
}

const SAMPLE_CONDITIONS: ManualConditions = {
  windSpeedKnots: 14,
  windDirectionDeg: 180,
  surfaceTempC: 20,
  currentSpeedKnots: 0.4,
  currentDirectionDeg: 90,
  waterLevelM: null,
};

type InitArgs = {
  manualConditions: Record<string, ManualConditions>;
  activeSource: Record<string, "real" | "manual">;
};

function seedSettingsScript(args: InitArgs): void {
  try {
    const raw = localStorage.getItem("bathyscan:settings");
    const parsed: { state?: Record<string, unknown>; version?: number } = raw
      ? JSON.parse(raw)
      : {};
    parsed.state = {
      ...(parsed.state ?? {}),
      datasetManualConditions: args.manualConditions,
      manualConditionsActiveSource: args.activeSource,
    };
    localStorage.setItem("bathyscan:settings", JSON.stringify(parsed));
  } catch { /* ignore */ }
  try {
    sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
  } catch { /* ignore */ }
}

test.describe("Manual conditions chip — mobile viewport", () => {
  test.use({ viewport: { width: 390, height: 740 } });

  test.beforeEach(async ({ page }) => {
    // Reset server-side settings so hydrateFromServer never overwrites the
    // localStorage seed with stale values from a previous test run.
    await page.request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: {
        datasetManualConditions: {},
        manualConditionsActiveSource: {},
      },
    });
  });

  test("chip is visible, non-overflowing, and shows compact lake label on a small phone width", async ({ page }) => {
    test.setTimeout(90_000);

    await page.addInitScript(seedSettingsScript, {
      manualConditions: { [SYNTHETIC_ID]: SAMPLE_CONDITIONS },
      activeSource: { [SYNTHETIC_ID]: "manual" },
    } satisfies InitArgs);

    await page.goto("/");

    // On a 390px viewport the water-type toggle (used by desktop specs as a
    // signed-in probe) may be hidden — wait for the test bridge instead.
    const bridgeReady = await page
      .waitForFunction(() => window.__bathyTest?.isTestBridgeReady?.() === true, undefined, {
        timeout: 30_000,
      })
      .then(() => true)
      .catch(() => false);
    if (!bridgeReady) {
      test.skip(true, "Test bridge not ready — app not signed in (VITE_DEV_AUTH_BYPASS not set)");
      return;
    }

    // Load synthetic terrain (with a display name) so the chip knows the
    // active datasetId and lake name.
    await page.evaluate(
      ({ id, name }) => {
        window.__bathyTest!.seedTerrain({ datasetId: id, name });
      },
      { id: SYNTHETIC_ID, name: LAKE_NAME },
    );

    const chip = page.locator('[data-testid="manual-conditions-chip"]');
    await expect(chip).toBeVisible({ timeout: 10_000 });

    // Compact mobile label includes the lake name.
    const label = page.locator('[data-testid="manual-conditions-chip-label"]');
    await expect(label).toContainText(LAKE_NAME);
    await expect(label).toContainText("Manual");

    // The chip must sit fully inside the viewport — not clipped off-screen
    // horizontally or vertically.
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const box = await chip.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 0.5);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 0.5);

    // The clear button must also be reachable (not pushed off-screen by the label).
    const clearBtn = page.locator('[data-testid="manual-conditions-chip-clear"]');
    await expect(clearBtn).toBeVisible();
    const clearBox = await clearBtn.boundingBox();
    expect(clearBox).not.toBeNull();
    expect(clearBox!.x + clearBox!.width).toBeLessThanOrEqual(viewport!.width + 0.5);
  });
});
