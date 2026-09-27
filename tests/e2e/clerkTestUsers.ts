import { randomBytes, randomUUID } from "node:crypto";

const CLERK_API_BASE_URL = "https://api.clerk.com/v1";

export type ClerkE2ETestUser = {
  id: string;
  emailAddress: string;
};

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
  method: "POST" | "DELETE",
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
  const response = await clerkRequest("POST", "/users", {
    email_address: [emailAddress],
    password,
    first_name: "BathyScan",
    last_name: "E2E",
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