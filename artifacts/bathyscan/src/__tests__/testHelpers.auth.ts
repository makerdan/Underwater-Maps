/**
 * Shared Clerk mock helper for Vitest test files.
 *
 * Every test that renders an auth-dependent component needs to mock
 * `@/lib/clerkCompat`.  Without a shared helper each file copy-pastes the
 * same 4-6 line block, which means a clerkCompat API change requires editing
 * every file individually.
 *
 * Usage — async factory pattern required because vi.mock() factories are
 * hoisted before ES imports resolve, so a direct import cannot be referenced
 * inside a synchronous factory.  Async factories with dynamic import() work:
 *
 *   vi.mock("@/lib/clerkCompat", async () => {
 *     const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
 *     return mockClerkCompat();          // signed-in defaults
 *   });
 *
 * With hook-level overrides (signed-out auth, null user, dynamic state …):
 *
 *   vi.mock("@/lib/clerkCompat", async () => {
 *     const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
 *     return mockClerkCompat({
 *       useAuth: () => ({ isSignedIn: false, isLoaded: true }),
 *       useUser: () => ({ user: null, isSignedIn: false, isLoaded: true }),
 *     });
 *   });
 */

import { vi } from "vitest";

/** Test-time stand-in for an authenticated user. */
export const MOCK_AUTH_USER = {
  id: "user-test-id",
  primaryEmailAddress: { emailAddress: "test@example.com" },
  username: "test",
};

export type ClerkCompatOverrides = {
  useAuth?: () => Record<string, unknown>;
  useUser?: () => Record<string, unknown>;
  useClerk?: () => Record<string, unknown>;
};

/**
 * Returns a mock module object for `@/lib/clerkCompat`.
 *
 * Defaults to a fully signed-in session using `MOCK_AUTH_USER`.
 * Pass `overrides` to replace individual hooks for tests that need a
 * different auth state (signed-out, null user, or a mutable closure).
 */
export function mockClerkCompat(overrides: ClerkCompatOverrides = {}) {
  return {
    useAuth:
      overrides.useAuth ??
      (() => ({
        isSignedIn: true,
        isLoaded: true,
        userId: MOCK_AUTH_USER.id,
        sessionId: "test-session",
        orgId: null,
        getToken: async () => null,
      })),
    useUser:
      overrides.useUser ??
      (() => ({
        user: MOCK_AUTH_USER,
        isSignedIn: true,
        isLoaded: true,
      })),
    useClerk: overrides.useClerk ?? (() => ({ signOut: vi.fn() })),
    ClerkProvider: ({ children }: { children: unknown }) => children,
    Show: ({ when, children }: { when: string; children?: unknown }) =>
      when === "signed-in" ? children : null,
    SignIn: () => null,
    SignUp: () => null,
  };
}
