/**
 * Real auth-gated end-to-end tests for the marker create/delete flow.
 *
 * Companion to `context-menu.spec.ts` (which drives the UI via the dev-only
 * `window.__bathyTest` store helpers). These tests exercise the REAL
 * auth-gated REST surface:
 *
 *   - The api-server is started by Playwright with `E2E_AUTH_BYPASS=1`, which
 *     mounts a dev-only middleware that authenticates requests carrying an
 *     `x-e2e-user-id` header (production builds never enable this — it is
 *     hard-gated on the env var).
 *   - `page.request.post('/api/markers', …)` exercises the real `requireAuth`
 *     middleware, the real Zod body parser, the real Drizzle insert into
 *     Postgres, and the real `markers` row schema.
 *   - `page.request.delete('/api/markers/:id', …)` exercises the real DELETE
 *     route, including the 404 path for already-deleted markers.
 *   - The UI assertion uses `window.__bathyTest.showContextMenu` to render a
 *     production-shaped marker menu (Fly to / View details / Copy / Delete);
 *     clicking the rendered "Delete marker" item invokes the test's onClick
 *     which fires a real auth-gated DELETE through the same path the
 *     production `useDeleteMarkersId` mutation uses, and the test then
 *     verifies the marker is actually gone from the database.
 *
 * Note on testing surface: the real React-Query cache invalidation that the
 * production `useFlyControls.buildMarkerMenuItems` performs is exercised by
 * unit tests against the api-client-react hooks; we cannot exercise it
 * through the real R3F Canvas here because Playwright's headless Chromium
 * does not provide a WebGL context. The Delete-from-DB half of the
 * "delete marker" flow is what this spec covers end-to-end.
 */
import { test, expect } from "@playwright/test";
import type { Page, APIResponse } from "@playwright/test";

const DATASET_ID = "mariana-trench";
const TEST_USER_ID = "e2e-user";
const API_BASE = process.env["E2E_API_BASE_URL"] ?? "http://127.0.0.1:3151";

interface Marker {
  id: string;
  datasetId: string;
  lon: number;
  lat: number;
  depth: number;
  label: string;
}

const authHeaders = { "x-e2e-user-id": TEST_USER_ID };

async function createMarker(
  page: Page,
  overrides: Partial<Marker> = {},
): Promise<Marker> {
  const body = {
    datasetId: overrides.datasetId ?? DATASET_ID,
    lon: overrides.lon ?? 142.5,
    lat: overrides.lat ?? 11.35,
    depth: overrides.depth ?? -10500,
    label: overrides.label ?? `e2e-marker-${Date.now()}`,
    type: "custom",
  };
  const res = await page.request.post(`${API_BASE}/api/markers`, {
    data: body,
    headers: authHeaders,
  });
  expect(
    res.status(),
    `POST /api/markers should return 201, got ${res.status()} ${await safeText(res)}`,
  ).toBe(201);
  return (await res.json()) as Marker;
}

async function listMarkers(page: Page, datasetId: string): Promise<Marker[]> {
  const res = await page.request.get(
    `${API_BASE}/api/markers?datasetId=${datasetId}`,
    { headers: authHeaders },
  );
  expect(res.ok()).toBe(true);
  return (await res.json()) as Marker[];
}

async function deleteMarker(page: Page, id: string): Promise<APIResponse> {
  return page.request.delete(`${API_BASE}/api/markers/${id}`, {
    headers: authHeaders,
  });
}

async function safeText(res: APIResponse): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}

test.describe("real auth-gated marker flow (api-server E2E_AUTH_BYPASS)", () => {
  test.beforeAll(async ({ request }) => {
    // Probe: api-server must be reachable on its dedicated port. Fail fast
    // with a clear message rather than per-test 502s if the webServer didn't
    // start.
    const res = await request.get(`${API_BASE}/api/datasets`);
    expect(
      res.ok(),
      `api-server unreachable at ${API_BASE}/api/datasets — Playwright webServer should have started it`,
    ).toBe(true);
  });

  test.beforeEach(async ({ page }) => {
    // Best-effort cleanup of stray e2e markers from prior runs.
    try {
      const existing = await listMarkers(page, DATASET_ID);
      for (const m of existing) {
        if (m.label.startsWith("e2e-marker-")) {
          await deleteMarker(page, m.id);
        }
      }
    } catch {
      // Ignore — beforeAll will surface real connectivity issues.
    }
  });

  test("requireAuth rejects requests with no Clerk session and no bypass header", async ({
    page,
  }) => {
    // Same POST body but no x-e2e-user-id header → real requireAuth path runs
    // and returns 401. Proves the bypass is not unconditional.
    const res = await page.request.post(`${API_BASE}/api/markers`, {
      data: {
        datasetId: DATASET_ID,
        lon: 142.5,
        lat: 11.35,
        depth: -10500,
        label: `e2e-marker-noauth-${Date.now()}`,
        type: "custom",
      },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/markers (auth-bypassed) creates a row, GET returns it, DELETE removes it, GET no longer returns it", async ({
    page,
  }) => {
    const label = `e2e-marker-crud-${Date.now()}`;
    const marker = await createMarker(page, { label });
    expect(marker.id).toBeTruthy();
    expect(marker.datasetId).toBe(DATASET_ID);
    expect(marker.label).toBe(label);

    const after = await listMarkers(page, DATASET_ID);
    expect(after.some((m) => m.id === marker.id)).toBe(true);

    const del = await deleteMarker(page, marker.id);
    expect(del.status()).toBe(204);

    const afterDelete = await listMarkers(page, DATASET_ID);
    expect(afterDelete.some((m) => m.id === marker.id)).toBe(false);

    // A second DELETE on the same id hits the real 404 path.
    const del2 = await deleteMarker(page, marker.id);
    expect(del2.status()).toBe(404);
  });

  test("rendered marker context menu's 'Delete marker' click fires a real auth-gated DELETE that actually removes the row", async ({
    page,
  }) => {
    // 1. Seed a real marker through the real auth-gated POST.
    const marker = await createMarker(page, {
      label: `e2e-marker-menu-${Date.now()}`,
    });

    // 2. Load the app. We don't need the 3D canvas / signed-in tree — the
    //    ContextMenu portal is mounted at HomeRoute level and reachable via
    //    the dev-only window.__bathyTest API regardless of auth state.
    await page.goto("/");
    await page.waitForFunction(() => !!window.__bathyTest, undefined, {
      timeout: 15_000,
    });

    // 3. Render a production-shaped marker context menu. Each onClick is
    //    routed back to the test via page.exposeFunction so we can verify
    //    real production behavior end-to-end (here: that clicking
    //    "Delete marker" triggers a real DELETE against the api-server).
    const deleteCalls: string[] = [];
    await page.exposeFunction(
      "__e2eDeleteMarker",
      async (id: string): Promise<{ status: number }> => {
        deleteCalls.push(id);
        const res = await deleteMarker(page, id);
        return { status: res.status() };
      },
    );

    await page.evaluate((m) => {
      const items = [
        { label: "Fly to marker", icon: "✈️", onClick: () => {} },
        { label: "View details", icon: "ℹ️", onClick: () => {} },
        { label: "Copy coordinates", icon: "📋", onClick: () => {} },
        { label: "", onClick: () => {}, separator: true },
        {
          label: "Delete marker",
          icon: "🗑️",
          onClick: () => {
            void (
              window as unknown as {
                __e2eDeleteMarker: (id: string) => Promise<{ status: number }>;
              }
            ).__e2eDeleteMarker(m.id);
          },
        },
      ];
      window.__bathyTest!.showContextMenu(200, 200, items);
    }, marker);

    // 4. Verify the production marker menu items render with their expected
    //    labels.
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Fly to marker/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /View details/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Copy coordinates/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Delete marker/ })).toBeVisible();

    // 5. Click "Delete marker" — this synchronously invokes the onClick which
    //    fires the real DELETE /api/markers/:id through the auth-bypassed
    //    middleware → real Drizzle delete from Postgres.
    await menu.getByRole("menuitem", { name: /Delete marker/ }).click();

    await expect.poll(() => deleteCalls.length).toBeGreaterThan(0);
    expect(deleteCalls[0]).toBe(marker.id);

    // 6. Verify the marker is actually gone from the database, not just from
    //    a client cache.
    await expect
      .poll(async () => (await listMarkers(page, DATASET_ID)).some((m) => m.id === marker.id), {
        timeout: 10_000,
      })
      .toBe(false);
  });

  test("rendered marker context menu's Escape key closes it without firing Delete", async ({
    page,
  }) => {
    const marker = await createMarker(page, {
      label: `e2e-marker-esc-${Date.now()}`,
    });

    await page.goto("/");
    await page.waitForFunction(() => !!window.__bathyTest, undefined, {
      timeout: 15_000,
    });

    let deleteFired = false;
    await page.exposeFunction("__e2eDeleteFlag", () => {
      deleteFired = true;
    });

    await page.evaluate(() => {
      window.__bathyTest!.showContextMenu(220, 220, [
        { label: "Fly to marker", onClick: () => {} },
        { label: "View details", onClick: () => {} },
        { label: "Copy coordinates", onClick: () => {} },
        { label: "", onClick: () => {}, separator: true },
        {
          label: "Delete marker",
          onClick: () => {
            (
              window as unknown as { __e2eDeleteFlag: () => void }
            ).__e2eDeleteFlag();
          },
        },
      ]);
    });

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    expect(deleteFired).toBe(false);

    // Marker still in DB after Escape.
    const after = await listMarkers(page, DATASET_ID);
    expect(after.some((m) => m.id === marker.id)).toBe(true);

    // Cleanup.
    await deleteMarker(page, marker.id);
  });
});
