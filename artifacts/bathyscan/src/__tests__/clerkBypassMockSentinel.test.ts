/**
 * clerkBypassMockSentinel.test.ts — mock/contract drift sentinel.
 *
 * The dev-auth bypass in lib/clerkCompat.tsx replaces Clerk's useClerk /
 * useAuth / useUser hooks with hand-written stubs. Past incident: App.tsx
 * started calling `useClerk().session.getToken()` and the bypass session had
 * no `getToken`, so every request in bypass mode threw a TypeError that unit
 * tests never caught.
 *
 * This sentinel does two things:
 *   1. Scans all production source files for members consumed from these
 *      hooks (destructuring, direct `useX().member` access, and members
 *      accessed via a `const foo = useX()` variable).
 *   2. Asserts every consumed member actually exists on the bypass stub
 *      objects, plus a hardcoded baseline of nested requirements
 *      (session.getToken).
 *
 * WHEN THIS FAILS: a component started using a Clerk hook member the bypass
 * stubs do not provide — add it to the corresponding bypass object in
 * src/lib/clerkCompat.tsx.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@clerk/react", () => ({
  ClerkProvider: () => null,
  SignIn: () => null,
  SignUp: () => null,
  Show: () => null,
  useUser: () => ({}),
  useClerk: () => ({}),
  useAuth: () => ({}),
}));

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const HOOKS = ["useClerk", "useAuth", "useUser"] as const;
type HookName = (typeof HOOKS)[number];

/** members consumed per hook, discovered by static scan */
function scanConsumedMembers(): Record<HookName, Set<string>> {
  const consumed: Record<HookName, Set<string>> = {
    useClerk: new Set(),
    useAuth: new Set(),
    useUser: new Set(),
  };

  for (const file of collectSourceFiles(srcRoot)) {
    const src = readFileSync(file, "utf8");
    // Skip the shim itself.
    if (file.endsWith("clerkCompat.tsx")) continue;

    for (const hook of HOOKS) {
      // Pattern 1: const { a, b: alias, c } = useX(...)
      for (const m of src.matchAll(
        new RegExp(`(?:const|let)\\s*\\{([^}]*)\\}\\s*=\\s*${hook}\\s*\\(`, "g"),
      )) {
        for (const part of m[1].split(",")) {
          const key = part.split(":")[0].trim();
          if (key && /^[A-Za-z_$][\w$]*$/.test(key)) consumed[hook].add(key);
        }
      }
      // Pattern 2: useX().member
      for (const m of src.matchAll(new RegExp(`${hook}\\s*\\(\\s*\\)\\s*\\.\\s*(\\w+)`, "g"))) {
        consumed[hook].add(m[1]);
      }
      // Pattern 3: const foo = useX(); … foo.member
      for (const m of src.matchAll(
        new RegExp(`(?:const|let)\\s+(\\w+)\\s*=\\s*${hook}\\s*\\(\\s*\\)`, "g"),
      )) {
        const varName = m[1];
        for (const use of src.matchAll(new RegExp(`\\b${varName}\\s*\\.\\s*(\\w+)`, "g"))) {
          consumed[hook].add(use[1]);
        }
      }
    }
  }
  return consumed;
}

describe("Clerk bypass stubs ↔ real hook-member usage sentinel", () => {
  it("every hook member consumed in src/ exists on the bypass stubs", async () => {
    vi.stubEnv("VITE_DEV_AUTH_BYPASS", "1");
    vi.resetModules();
    const compat = await import("../lib/clerkCompat.js");
    const { DEV_AUTH_BYPASS } = await import("../lib/devAuth.js");
    expect(DEV_AUTH_BYPASS, "bypass must be active for this sentinel").toBe(true);

    const stubs: Record<HookName, Record<string, unknown>> = {
      useClerk: compat.useClerk() as unknown as Record<string, unknown>,
      useAuth: compat.useAuth() as unknown as Record<string, unknown>,
      useUser: compat.useUser() as unknown as Record<string, unknown>,
    };

    const consumed = scanConsumedMembers();
    const missing: string[] = [];
    for (const hook of HOOKS) {
      for (const member of consumed[hook]) {
        if (!(member in stubs[hook])) missing.push(`${hook}().${member}`);
      }
    }

    expect(missing, [
      "",
      `${missing.length} Clerk hook member(s) are consumed in src/ but missing from the`,
      "dev-bypass stubs in src/lib/clerkCompat.tsx:",
      "",
      missing.map((m) => `  • ${m}`).join("\n"),
      "",
      "Add each missing member to the corresponding bypass object",
      "(bypassUseClerk / bypassUseAuth / bypassUseUser) in clerkCompat.tsx.",
      "",
    ].join("\n")).toEqual([]);

    vi.unstubAllEnvs();
  });

  it("baseline nested contract: bypass session exposes getToken (past regression)", async () => {
    vi.stubEnv("VITE_DEV_AUTH_BYPASS", "1");
    vi.resetModules();
    const compat = await import("../lib/clerkCompat.js");

    const clerk = compat.useClerk() as unknown as {
      session?: { getToken?: () => Promise<string | null> };
    };
    expect(clerk.session, "bypass useClerk() must expose a session object").toBeTruthy();
    expect(
      typeof clerk.session?.getToken,
      "bypass session must expose getToken() — App.tsx calls session.getToken() on every request",
    ).toBe("function");
    await expect(clerk.session!.getToken!()).resolves.toBeNull();

    const auth = compat.useAuth() as unknown as { getToken?: () => Promise<string | null> };
    expect(typeof auth.getToken, "bypass useAuth() must expose getToken()").toBe("function");

    vi.unstubAllEnvs();
  });
});
