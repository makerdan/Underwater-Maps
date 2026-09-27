import { randomBytes, randomUUID } from "node:crypto";

const CLERK_API_BASE_URL = "https://api.clerk.com/v1";
const TEST_USER_METADATA_KEY = "bathyScanClerkE2E";
const TEST_USER_MARKER = "clerk-session-collection-isolation.v1";
const USER_PAGE_SIZE = 100;
export const CLERK_E2E_TEST_USER_RETENTION_MS = 24 * 60 * 60 * 1_000;

export type ClerkE2ETestUser = {
  id: string;
  emailAddress: string;
};

type ClerkApiUser = {
  id?: unknown;
  private_metadata?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getDevelopmentSecretKey(): string {
  const secretKey = process.env["CLERK_SECRET_KEY"];
  const publishableKey =
    process.env["VITE_CLERK_PUBLISHABLE_KEY"] ??
    process.env["CLERK_PUBLISHABLE_KEY"];

  if (!secretKey?.startsWith("sk_test_") || !publishableKey?.startsWith("pk_test_")) {
    throw new Error(
      "Real-Clerk E2E requires Clerk Development keys (sk_test_ and pk_test_). No users were created.",
    );
  }

  return secretKey;
}

export function assertClerkDevelopmentKeys(): void {
  getDevelopmentSecretKey();
}

async function clerkRequest(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const secretKey = getDevelopmentSecretKey();
  const response = await fetch(`${CLERK_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    // Deliberately omit response bodies and credentials from test output.
    throw new Error(`Clerk Development ${method} request failed (HTTP ${response.status}).`);
  }

  return response;
}

export async function createClerkE2ETestUser(): Promise<ClerkE2ETestUser> {
  const emailAddress = `bathy+clerk_test_${randomUUID()}@example.com`;
  const password = `Bathy!${randomBytes(32).toString("base64url")}9a`;
  const createdAt = new Date().toISOString();
  const response = await clerkRequest("POST", "/users", {
    email_address: [emailAddress],
    password,
    first_name: "BathyScan",
    last_name: "E2E",
    private_metadata: {
      [TEST_USER_METADATA_KEY]: {
        marker: TEST_USER_MARKER,
        createdAt,
      },
    },
  });
  const user = (await response.json()) as { id?: unknown };

  if (typeof user.id !== "string" || user.id.length === 0) {
    throw new Error("Clerk Development user creation returned no user ID.");
  }

  return { id: user.id, emailAddress };
}

export async function deleteClerkE2ETestUser(userId: string): Promise<void> {
  await clerkRequest("DELETE", `/users/${encodeURIComponent(userId)}`);
}

/**
 * Remove only this suite's marked users after they have exceeded the retention
 * window. Collect IDs before deleting so Clerk's offset pagination cannot skip
 * users when deleting an item shifts later pages.
 */
export async function cleanupStaleClerkE2ETestUsers(
  nowMs = Date.now(),
): Promise<number> {
  if (!Number.isFinite(nowMs)) {
    throw new Error("Clerk E2E cleanup requires a finite current time.");
  }

  const cutoff = nowMs - CLERK_E2E_TEST_USER_RETENTION_MS;
  const staleUserIds = new Set<string>();
  let offset = 0;

  while (true) {
    const response = await clerkRequest(
      "GET",
      `/users?limit=${USER_PAGE_SIZE}&offset=${offset}`,
    );
    const page: unknown = await response.json();

    if (!Array.isArray(page) || page.length > USER_PAGE_SIZE) {
      throw new Error("Clerk Development user list returned an invalid page.");
    }

    for (const candidate of page as ClerkApiUser[]) {
      if (
        !isRecord(candidate) ||
        typeof candidate.id !== "string" ||
        candidate.id.length === 0
      ) {
        continue;
      }

      const privateMetadata = isRecord(candidate.private_metadata)
        ? candidate.private_metadata
        : null;
      const suiteMetadata =
        privateMetadata && isRecord(privateMetadata[TEST_USER_METADATA_KEY])
          ? privateMetadata[TEST_USER_METADATA_KEY]
          : null;
      if (suiteMetadata?.["marker"] !== TEST_USER_MARKER) {
        continue;
      }

      const createdAt = suiteMetadata["createdAt"];
      if (typeof createdAt !== "string") {
        continue;
      }

      const createdAtMs = Date.parse(createdAt);
      if (Number.isFinite(createdAtMs) && createdAtMs < cutoff) {
        staleUserIds.add(candidate.id);
      }
    }

    if (page.length < USER_PAGE_SIZE) {
      break;
    }
    offset += page.length;
  }

  for (const userId of staleUserIds) {
    await deleteClerkE2ETestUser(userId);
  }

  return staleUserIds.size;
}
