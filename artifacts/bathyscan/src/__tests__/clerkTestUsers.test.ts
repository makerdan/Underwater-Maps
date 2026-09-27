import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLERK_E2E_TEST_USER_RETENTION_MS,
  assertClerkDevelopmentKeys,
  cleanupStaleClerkE2ETestUsers,
  createClerkE2ETestUser,
} from "../../../../tests/e2e/clerkTestUsers";

const TEST_NOW = Date.parse("2026-09-01T12:00:00.000Z");
const TEST_SECRET_KEY = "sk_test_unit-test";
const TEST_PUBLISHABLE_KEY = "pk_test_unit-test";
const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function markedUser(id: string, createdAt: string) {
  return {
    id,
    private_metadata: {
      bathyScanClerkE2E: {
        marker: "clerk-session-collection-isolation.v1",
        createdAt,
      },
    },
  };
}

beforeEach(() => {
  vi.stubEnv("CLERK_SECRET_KEY", TEST_SECRET_KEY);
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", TEST_PUBLISHABLE_KEY);
  vi.useFakeTimers();
  vi.setSystemTime(TEST_NOW);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Clerk E2E test users", () => {
  it("marks each created account with a private suite marker and creation time", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "user_new_test" }));

    await createClerkE2ETestUser();

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body["private_metadata"]).toEqual({
      bathyScanClerkE2E: {
        marker: "clerk-session-collection-isolation.v1",
        createdAt: new Date(TEST_NOW).toISOString(),
      },
    });
  });

  it("deletes only old, exactly marked users, including users on later pages", async () => {
    const oldCreatedAt = new Date(
      TEST_NOW - CLERK_E2E_TEST_USER_RETENTION_MS - 1,
    ).toISOString();
    const recentCreatedAt = new Date(
      TEST_NOW - CLERK_E2E_TEST_USER_RETENTION_MS + 1,
    ).toISOString();
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `unmarked-${index}`,
      private_metadata: {},
    }));
    firstPage[0] = markedUser("stale-first-page-user", oldCreatedAt);
    const secondPage = [
      markedUser("stale-suite-user", oldCreatedAt),
      markedUser("recent-suite-user", recentCreatedAt),
      {
        id: "other-suite-user",
        private_metadata: {
          bathyScanClerkE2E: {
            marker: "different-suite.v1",
            createdAt: oldCreatedAt,
          },
        },
      },
      { id: "unmarked-old-user", private_metadata: {} },
      markedUser("malformed-date-user", "not-a-date"),
      markedUser("future-date-user", new Date(TEST_NOW + 1).toISOString()),
    ];

    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      return jsonResponse(offset === 0 ? firstPage : secondPage);
    });

    const deletedCount = await cleanupStaleClerkE2ETestUsers(TEST_NOW);

    expect(deletedCount).toBe(2);
    const calls = fetchMock.mock.calls;
    expect(calls.slice(0, 2).map(([url]) => new URL(String(url)).searchParams.get("offset")))
      .toEqual(["0", "100"]);
    const deletions = calls
      .filter(([, init]) => init?.method === "DELETE")
      .map(([url]) => String(url));
    expect(deletions).toEqual([
      "https://api.clerk.com/v1/users/stale-first-page-user",
      "https://api.clerk.com/v1/users/stale-suite-user",
    ]);
  });

  it("stops before any API request unless both Clerk keys are test keys", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_live_not-for-tests");

    expect(() => assertClerkDevelopmentKeys()).toThrow(
      /Development keys \(sk_test_ and pk_test_\)/,
    );
    await expect(cleanupStaleClerkE2ETestUsers(TEST_NOW)).rejects.toThrow(
      /Development keys \(sk_test_ and pk_test_\)/,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("CLERK_SECRET_KEY", TEST_SECRET_KEY);
    vi.stubEnv("CLERK_PUBLISHABLE_KEY", "pk_live_not-for-tests");
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");

    await expect(cleanupStaleClerkE2ETestUsers(TEST_NOW)).rejects.toThrow(
      /Development keys \(sk_test_ and pk_test_\)/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});