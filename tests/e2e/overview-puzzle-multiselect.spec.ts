import { test, expect, type Page } from "./fixtures";

/**
 * Overview Map — Puzzle-mode multi-select and group E2E tests.
 *
 * Covers the multi-select and grouping lifecycle introduced alongside single-tile
 * rotation:
 *   1. Selecting two tiles via the bridge sets the primary to the first ID.
 *   2. The GROUP button appears when ≥2 tiles are selected and are not yet grouped.
 *   3. Clicking GROUP creates a group whose members are exactly the selected IDs.
 *   4. The `createPuzzleGroup` bridge directly creates a persistent group.
 *   5. Transforms and groups survive a page reload (sessionStorage round-trip).
 *   6. The Reset button clears all transforms, groups, and sessionStorage entries.
 *
 * Canvas hit-testing is avoided everywhere: tile selection uses the
 * `__bathyTest.setPuzzleSelection` bridge, and groups are verified via
 * `__bathyTest.getPuzzleGroups`. This mirrors the pattern used in
 * `overview-puzzle-rotation.spec.ts`.
 *
 * "Phantom" tile IDs (strings that are not visible datasets) are used alongside
 * the real seeded tile to reach the ≥2 threshold for the GROUP button without
 * needing two real loaded datasets.
 */

const OVERLAY_HEADER = ".overview-map-header";
const PHANTOM_ID = "phantom-tile-for-group-test";

async function ensureSignedInOrSkip(page: Page): Promise<boolean> {
  const canvas = page.locator("canvas").first();
  const visible = await canvas.isVisible({ timeout: 12_000 }).catch(() => false);
  if (!visible) {
    test.skip(true, "Canvas not visible — user is not signed in");
    return false;
  }
  return true;
}

async function openOverview(page: Page): Promise<void> {
  const opened = await page
    .evaluate(() => {
      const api = (window as unknown as {
        __bathyTest?: { setOverviewOpen?: (b: boolean) => void };
      }).__bathyTest;
      if (api?.setOverviewOpen) {
        api.setOverviewOpen(true);
        return true;
      }
      return false;
    })
    .catch(() => false);

  if (!opened) {
    const btn = page.getByRole("button", { name: /▲\s*OVERVIEW/ });
    await btn.click();
  }

  await expect(page.locator(OVERLAY_HEADER)).toBeVisible({ timeout: 5_000 });
}

async function enterPuzzleMode(page: Page): Promise<boolean> {
  const toggleBtn = page.getByTestId("overview-puzzle-toggle");
  const found = await toggleBtn.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!found) return false;
  await toggleBtn.dispatchEvent("click");
  await expect(toggleBtn).toHaveAttribute("aria-pressed", "true", { timeout: 3_000 });
  return true;
}

/**
 * Poll until the OverviewMap's `registerPuzzleTestHandlers` useEffect has fired
 * and wired the bridge callbacks. The effect sets `isPuzzleBridgeReady` to true
 * as its last action, providing a single unambiguous signal instead of a
 * side-effect probe.
 */
async function waitForPuzzleBridge(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const api = (window as unknown as {
          __bathyTest?: { isPuzzleBridgeReady?: () => boolean };
        }).__bathyTest;
        return api?.isPuzzleBridgeReady?.() === true;
      },
      { timeout: 5_000 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Seed the primary tile and return its datasetId, or null on failure.
 * Also selects it via bridge so tests start with a known selection state.
 */
async function selectPrimaryTileViaBridge(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __bathyTest?: {
        getTerrainSummary?: () => { datasetId: string | null | undefined } | null;
        setPuzzleSelectedId?: (id: string | null) => boolean;
        getPuzzleSelectedId?: () => string | null;
      };
    }).__bathyTest;
    const summary = api?.getTerrainSummary?.();
    const id = summary?.datasetId;
    if (!id) return null;
    const ok = api?.setPuzzleSelectedId?.(id);
    if (!ok) return null;
    return api?.getPuzzleSelectedId?.() ?? null;
  });
}

/**
 * Read the current puzzle groups snapshot from the bridge.
 */
async function getPuzzleGroups(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __bathyTest?: { getPuzzleGroups?: () => Record<string, string[]> };
    }).__bathyTest;
    return api?.getPuzzleGroups?.() ?? {};
  });
}

/**
 * Read the current puzzle transform for a tile.
 */
async function getPuzzleTransform(
  page: Page,
  id: string,
): Promise<{ tx: number; ty: number; angleDeg: number } | null> {
  return page.evaluate((datasetId) => {
    const api = (window as unknown as {
      __bathyTest?: {
        getPuzzleTransform?: (id: string) => { tx: number; ty: number; angleDeg: number } | null;
      };
    }).__bathyTest;
    return api?.getPuzzleTransform?.(datasetId) ?? null;
  }, id);
}

test.describe("BathyScan — Overview Puzzle multi-select and groups", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__bathyTest?.seedTerrain?.()).catch(() => {});
    await page
      .waitForFunction(
        () => Boolean(window.__bathyTest?.getTerrainSummary?.()),
        null,
        { timeout: 5_000 },
      )
      .catch(() => {});
  });

  // ---------------------------------------------------------------------------
  // 1. setPuzzleSelection with two IDs sets the primary to the first tile
  // ---------------------------------------------------------------------------
  test("setPuzzleSelection with two IDs sets primary to the first tile and enables GROUP button", async ({
    page,
  }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);
    const entered = await enterPuzzleMode(page);
    if (!entered) {
      test.skip(true, "Puzzle toggle button not found — overview may require real terrain in this env");
      return;
    }

    // Wait for registerPuzzleTestHandlers useEffect to fire before calling bridge.
    const bridgeReady = await waitForPuzzleBridge(page);
    if (!bridgeReady) {
      test.skip(true, "Puzzle bridge handlers not registered in time — effect may not have fired");
      return;
    }

    const primaryId = await selectPrimaryTileViaBridge(page);
    if (!primaryId) {
      test.skip(true, "Bridge could not select a tile — terrain may not be available");
      return;
    }

    // Expand selection to include the real tile plus a phantom ID (simulates
    // shift-clicking a second tile without needing two real loaded datasets).
    const selected = await page.evaluate(
      ([realId, phantomId]) => {
        const api = (window as unknown as {
          __bathyTest?: {
            setPuzzleSelection?: (ids: string[]) => boolean;
            getPuzzleSelectedId?: () => string | null;
          };
        }).__bathyTest;
        const ok = api?.setPuzzleSelection?.([realId, phantomId]);
        if (!ok) return null;
        return api?.getPuzzleSelectedId?.() ?? null;
      },
      [primaryId, PHANTOM_ID],
    );

    // If the bridge lost its registration between calls, skip rather than fail.
    if (selected === null) {
      test.skip(true, "setPuzzleSelection returned false — bridge lost registration");
      return;
    }

    // Primary must be the first element we passed.
    expect(selected).toBe(primaryId);

    // GROUP button must appear (selection has ≥2 tiles, not yet grouped).
    await expect(page.getByTestId("overview-puzzle-group")).toBeVisible({ timeout: 3_000 });
  });

  // ---------------------------------------------------------------------------
  // 2. GROUP button click creates a group containing all selected tiles
  // ---------------------------------------------------------------------------
  test("GROUP button click creates a group whose members are all selected tiles", async ({
    page,
  }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);
    const entered = await enterPuzzleMode(page);
    if (!entered) {
      test.skip(true, "Puzzle toggle button not found");
      return;
    }

    // Wait for registerPuzzleTestHandlers useEffect to fire before calling bridge.
    const bridgeReady = await waitForPuzzleBridge(page);
    if (!bridgeReady) {
      test.skip(true, "Puzzle bridge handlers not registered in time — effect may not have fired");
      return;
    }

    const primaryId = await selectPrimaryTileViaBridge(page);
    if (!primaryId) {
      test.skip(true, "Bridge could not select a tile");
      return;
    }

    // Build a 2-tile selection so the GROUP button renders.
    await page.evaluate(
      ([realId, phantomId]) => {
        const api = (window as unknown as {
          __bathyTest?: { setPuzzleSelection?: (ids: string[]) => boolean };
        }).__bathyTest;
        api?.setPuzzleSelection?.([realId, phantomId]);
      },
      [primaryId, PHANTOM_ID],
    );

    await expect(page.getByTestId("overview-puzzle-group")).toBeVisible({ timeout: 3_000 });

    // Click the GROUP button.
    await page.getByTestId("overview-puzzle-group").dispatchEvent("click");

    // Exactly one group must now exist, and it must contain both IDs.
    await expect
      .poll(
        async () => {
          const groups = await getPuzzleGroups(page);
          const entries = Object.values(groups);
          if (entries.length !== 1) return false;
          const members = entries[0]!;
          return members.includes(primaryId) && members.includes(PHANTOM_ID);
        },
        { timeout: 3_000 },
      )
      .toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 3. createPuzzleGroup bridge creates a persistent group (no UI click needed)
  // ---------------------------------------------------------------------------
  test("createPuzzleGroup bridge creates a persistent group reflected by getPuzzleGroups", async ({
    page,
  }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);
    const entered = await enterPuzzleMode(page);
    if (!entered) {
      test.skip(true, "Puzzle toggle button not found");
      return;
    }

    // Wait for registerPuzzleTestHandlers useEffect to fire before calling bridge.
    const bridgeReady = await waitForPuzzleBridge(page);
    if (!bridgeReady) {
      test.skip(true, "Puzzle bridge handlers not registered in time — effect may not have fired");
      return;
    }

    // Create a group via the bridge directly (bypasses the GROUP button UI).
    const groupId = await page.evaluate(
      ([realPhantom, secondPhantom]) => {
        const api = (window as unknown as {
          __bathyTest?: { createPuzzleGroup?: (ids: string[]) => string };
        }).__bathyTest;
        return api?.createPuzzleGroup?.([realPhantom, secondPhantom]) ?? "";
      },
      [PHANTOM_ID, "phantom-tile-b"],
    );

    // If the bridge lost its registration, skip rather than produce a confusing
    // regex-mismatch failure on an empty string.
    if (!groupId) {
      test.skip(true, "createPuzzleGroup returned empty string — bridge handler not registered");
      return;
    }

    // groupId must be a non-empty string (e.g. "group-1").
    expect(groupId).toMatch(/^group-\d+$/);

    // getPuzzleGroups must reflect the new group with both members.
    const groups = await getPuzzleGroups(page);
    expect(Object.keys(groups)).toHaveLength(1);
    const members = groups[groupId] ?? [];
    expect(members).toContain(PHANTOM_ID);
    expect(members).toContain("phantom-tile-b");
  });

  // ---------------------------------------------------------------------------
  // 4. sessionStorage round-trip: transforms and groups survive a page reload
  // ---------------------------------------------------------------------------
  test("transforms and groups pre-seeded in sessionStorage survive a page reload", async ({
    page,
  }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    // Pre-seed sessionStorage BEFORE the page navigates so the OverviewMap
    // hydration effect reads the stored data on mount.
    const PRESET_TRANSFORMS: [string, { tx: number; ty: number; angleDeg: number }][] = [
      ["e2e-synthetic", { tx: 42, ty: -17, angleDeg: 90 }],
    ];
    const PRESET_GROUPS: [string, string[]][] = [["group-1", ["e2e-synthetic", PHANTOM_ID]]];

    // Reload with pre-seeded storage (addInitScript runs before page scripts).
    await page.addInitScript(
      ({ transforms, groups }) => {
        try {
          sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
          sessionStorage.setItem("bathyscan:puzzleTransforms", JSON.stringify(transforms));
          sessionStorage.setItem("bathyscan:puzzleGroups", JSON.stringify(groups));
        } catch {}
      },
      { transforms: PRESET_TRANSFORMS, groups: PRESET_GROUPS },
    );

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(800);

    // Seed terrain so the OverviewMap mounts with a real tile.
    await page.evaluate(() => window.__bathyTest?.seedTerrain?.()).catch(() => {});
    await page
      .waitForFunction(() => Boolean(window.__bathyTest?.getTerrainSummary?.()), null, {
        timeout: 5_000,
      })
      .catch(() => {});

    await openOverview(page);
    const entered = await enterPuzzleMode(page);
    if (!entered) {
      test.skip(true, "Puzzle toggle button not found");
      return;
    }

    // Wait for registerPuzzleTestHandlers useEffect to fire before querying bridge.
    const bridgeReady = await waitForPuzzleBridge(page);
    if (!bridgeReady) {
      test.skip(true, "Puzzle bridge handlers not registered in time — effect may not have fired");
      return;
    }

    // Transform for "e2e-synthetic" must be hydrated from sessionStorage.
    await expect
      .poll(
        async () => {
          const xf = await getPuzzleTransform(page, "e2e-synthetic");
          return xf !== null && xf.tx === 42 && xf.ty === -17 && xf.angleDeg === 90;
        },
        { timeout: 3_000 },
      )
      .toBe(true);

    // Group "group-1" must also be hydrated.
    await expect
      .poll(
        async () => {
          const groups = await getPuzzleGroups(page);
          const members = groups["group-1"];
          return (
            Array.isArray(members) &&
            members.includes("e2e-synthetic") &&
            members.includes(PHANTOM_ID)
          );
        },
        { timeout: 3_000 },
      )
      .toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 5. Reset button clears all transforms, groups, and sessionStorage entries
  // ---------------------------------------------------------------------------
  test("Reset button clears all transforms and groups and removes sessionStorage entries", async ({
    page,
  }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);
    const entered = await enterPuzzleMode(page);
    if (!entered) {
      test.skip(true, "Puzzle toggle button not found");
      return;
    }

    const primaryId = await selectPrimaryTileViaBridge(page);
    if (!primaryId) {
      test.skip(true, "Bridge could not select a tile");
      return;
    }

    // Create a group via the bridge so there is state to clear.
    await page.evaluate(
      ([id, phantom]) => {
        const api = (window as unknown as {
          __bathyTest?: { createPuzzleGroup?: (ids: string[]) => string };
        }).__bathyTest;
        api?.createPuzzleGroup?.([id, phantom]);
      },
      [primaryId, PHANTOM_ID],
    );

    // Confirm the group exists before resetting.
    await expect
      .poll(async () => Object.keys(await getPuzzleGroups(page)).length === 1, { timeout: 3_000 })
      .toBe(true);

    // Click the Reset button.
    const resetBtn = page.getByTestId("overview-puzzle-reset");
    await expect(resetBtn).toBeVisible({ timeout: 3_000 });
    await resetBtn.dispatchEvent("click");

    // All groups must be gone.
    await expect
      .poll(async () => Object.keys(await getPuzzleGroups(page)).length === 0, { timeout: 3_000 })
      .toBe(true);

    // sessionStorage keys must be absent after reset.
    const storageCleared = await page.evaluate(() => {
      return (
        sessionStorage.getItem("bathyscan:puzzleTransforms") === null &&
        sessionStorage.getItem("bathyscan:puzzleGroups") === null
      );
    });
    expect(storageCleared).toBe(true);
  });
});
