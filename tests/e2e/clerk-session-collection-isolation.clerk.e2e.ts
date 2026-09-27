import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  createClerkE2ETestUser,
  deleteClerkE2ETestUser,
  type ClerkE2ETestUser,
} from "./clerkTestUsers";

type TestCollection = {
  id: string;
  name: string;
  collectionKind: "standard";
  defaultMemberId: null;
  members: Array<{
    id: string;
    kind: "dataset";
    refId: string;
    name: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

type CollectionRequestRecord = {
  userId: string | null;
  hasClerkBearerToken: boolean;
};

const CREATED_AT = "2026-01-01T00:00:00.000Z";
const EMPTY_SETTINGS = {
  units: "metric",
  waterType: "saltwater",
  colormapTheme: "ocean",
  showCompassMinimap: true,
  hasSeenOnboarding: true,
  hasSeenToolbarRelocationHint: true,
  autoStartTrailRecording: true,
  sidebarMode: "explore",
  panelCollapse: {},
  sidePaneCollapsed: false,
};

function makeCollection(account: "A" | "B", runId: string): TestCollection {
  const suffix = `${runId}-${account.toLowerCase()}`;
  return {
    id: `clerk-isolation-${suffix}`,
    name: `Account ${account} private collection`,
    collectionKind: "standard",
    defaultMemberId: null,
    members: [
      {
        id: `clerk-isolation-member-${suffix}`,
        kind: "dataset",
        refId: `clerk-isolation-dataset-${suffix}`,
        name: `Account ${account} private dataset`,
        createdAt: CREATED_AT,
      },
    ],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

async function getCurrentClerkUserId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const clerk = (
      window as Window & {
        Clerk?: { user?: { id?: string } | null };
      }
    ).Clerk;
    return clerk?.user?.id ?? null;
  });
}

async function getUserCollectionsCache(
  page: Page,
): Promise<Array<{ id: string; name: string }> | null> {
  return page.evaluate(() => {
    const testApi = (
      window as Window & {
        __bathyTest?: {
          getUserCollectionsCache?: () => Array<{ id: string; name: string }> | null;
        };
      }
    ).__bathyTest;
    return testApi?.getUserCollectionsCache?.() ?? null;
  });
}

async function fulfillJson(route: Route, json: unknown): Promise<void> {
  await route.fulfill({ status: 200, json });
}

test("real Clerk sign-out/sign-in clears old collections and keeps polling as the new user", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const createdUsers: ClerkE2ETestUser[] = [];
  const cleanupFailures: unknown[] = [];
  let testFailure: unknown;
  let activeClerkUserId: string | null = null;
  let accountBResponseHeld = false;
  let releaseAccountBResponse!: () => void;
  const accountBResponseGate = new Promise<void>((resolve) => {
    releaseAccountBResponse = resolve;
  });

  try {
    const accountA = await createClerkE2ETestUser();
    createdUsers.push(accountA);
    const accountB = await createClerkE2ETestUser();
    createdUsers.push(accountB);

    const runId = Date.now().toString(36);
    const collectionsByUserId = new Map<string, TestCollection[]>([
      [accountA.id, [makeCollection("A", runId)]],
      [accountB.id, [makeCollection("B", runId)]],
    ]);
    const collectionRequests: CollectionRequestRecord[] = [];

    await page.addInitScript(() => {
      localStorage.setItem(
        "bathyscan:settings",
        JSON.stringify({ state: { hasSeenOnboarding: true }, version: 0 }),
      );
    });

    // Keep app data isolated from the database: this regression is specifically
    // about the real Clerk listener and client query cache, not approval or
    // application persistence. Only Clerk's synthetic Development users use
    // the live Backend API, and they are deleted in the finally block.
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const method = request.method();

      if (pathname === "/api/user/collections" && method === "GET") {
        const headers = request.headers();
        collectionRequests.push({
          userId: activeClerkUserId,
          hasClerkBearerToken: /^Bearer\s+\S+$/.test(headers["authorization"] ?? ""),
        });

        if (activeClerkUserId === accountB.id && !accountBResponseHeld) {
          accountBResponseHeld = true;
          await accountBResponseGate;
        }

        await fulfillJson(
          route,
          activeClerkUserId
            ? (collectionsByUserId.get(activeClerkUserId) ?? [])
            : [],
        );
        return;
      }

      if (pathname === "/api/settings") {
        await fulfillJson(route, EMPTY_SETTINGS);
        return;
      }

      if (method === "DELETE") {
        await route.fulfill({ status: 204 });
        return;
      }

      await fulfillJson(route, method === "GET" ? [] : {});
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await clerk.loaded({ page });

    activeClerkUserId = accountA.id;
    await clerk.signIn({ page, emailAddress: accountA.emailAddress });
    await expect.poll(() => getCurrentClerkUserId(page), { timeout: 20_000 }).toBe(accountA.id);

    const accountACollection = makeCollection("A", runId);
    await expect(page.getByTestId(`collection-row-${accountACollection.id}`)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(accountACollection.name)).toBeVisible();
    await expect(page.getByText(`Account B private collection`)).toBeHidden();
    await expect
      .poll(() => getUserCollectionsCache(page))
      .toEqual([
        expect.objectContaining({
          id: accountACollection.id,
          name: accountACollection.name,
        }),
      ]);

    const accountARequests = collectionRequests.filter(
      (request) => request.userId === accountA.id,
    );
    expect(accountARequests.length).toBeGreaterThan(0);
    expect(accountARequests.every((request) => request.hasClerkBearerToken)).toBe(true);

    await clerk.signOut({ page });
    await expect.poll(() => getCurrentClerkUserId(page), { timeout: 15_000 }).toBeNull();
    await expect(page.getByTestId("collections-section")).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(accountACollection.name)).toBeHidden();
    await expect
      .poll(() => getUserCollectionsCache(page))
      .toBeNull();

    activeClerkUserId = accountB.id;
    const accountBRequestStart = collectionRequests.length;
    await clerk.signIn({ page, emailAddress: accountB.emailAddress });
    await expect.poll(() => getCurrentClerkUserId(page), { timeout: 20_000 }).toBe(accountB.id);
    await expect
      .poll(
        () =>
          collectionRequests
            .slice(accountBRequestStart)
            .filter((request) => request.userId === accountB.id).length,
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);

    // Hold B's first collections response until the empty-cache state is
    // observed, proving A's data cannot be displayed while B is loading.
    expect(accountBResponseHeld).toBe(true);
    await expect
      .poll(() => getUserCollectionsCache(page))
      .toBeNull();
    await expect(page.getByText(accountACollection.name)).toBeHidden();
    await expect(page.getByTestId(`collection-row-${makeCollection("B", runId).id}`)).toBeHidden();
    releaseAccountBResponse();

    const accountBCollection = makeCollection("B", runId);
    await expect(page.getByTestId(`collection-row-${accountBCollection.id}`)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(accountBCollection.name)).toBeVisible();
    await expect(page.getByText(accountACollection.name)).toBeHidden();
    await expect
      .poll(() => getUserCollectionsCache(page))
      .toEqual([
        expect.objectContaining({
          id: accountBCollection.id,
          name: accountBCollection.name,
        }),
      ]);

    await expect
      .poll(
        () =>
          collectionRequests
            .slice(accountBRequestStart)
            .filter((request) => request.userId === accountB.id).length,
        { timeout: 15_000, intervals: [250, 500, 1_000, 2_500] },
      )
      .toBeGreaterThan(1);

    const accountBRequests = collectionRequests
      .slice(accountBRequestStart)
      .filter((request) => request.userId === accountB.id);
    expect(accountBRequests.every((request) => request.hasClerkBearerToken)).toBe(true);
    expect(accountBRequests.every((request) => request.userId === accountB.id)).toBe(true);
  } catch (error) {
    testFailure = error;
  } finally {
    releaseAccountBResponse();
    activeClerkUserId = null;
    await clerk.signOut({ page }).catch(() => {
      // Deleting the user revokes any session if sign-out could not complete.
    });

    for (const user of createdUsers) {
      try {
        await deleteClerkE2ETestUser(user.id);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
  }

  if (cleanupFailures.length > 0) {
    const cleanupError = new Error(
      `Failed to delete ${cleanupFailures.length} ephemeral Clerk Development test user(s).`,
    );
    if (testFailure !== undefined) {
      throw new AggregateError([testFailure, cleanupError], "Clerk E2E failed and cleanup was incomplete.");
    }
    throw cleanupError;
  }
  if (testFailure !== undefined) throw testFailure;
});