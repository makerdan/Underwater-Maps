/**
 * db-pool-mock-guard.test.ts — mock-completeness guard for `@workspace/db`.
 *
 * Why: the rate-limit prune tests broke when production code moved from
 * pool.query() to pool.connect() for advisory locks while the hand-rolled
 * `@workspace/db` mock only stubbed `query`. Tests failed with an opaque
 * "pool.connect is not a function" at run time instead of a clear drift
 * message.
 *
 * This test scans every production source file under src/ (tests excluded)
 * for `pool.<prop>` member accesses and verifies the shared factory in
 * helpers/dbPoolMock.ts stubs each one. It fails FIRST, with an actionable
 * message naming the missing pool member and the files that use it.
 *
 * It also verifies the client shape returned by pool.connect() covers every
 * `client.<prop>` access in files that check out a client.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDbPoolMock } from "./helpers/dbPoolMock.js";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Recursively list production .ts files under src/, excluding tests. */
function listProductionSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...listProductionSources(full));
    } else if (
      name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Collect `<ident>.<prop>` member accesses per file for a given identifier. */
function collectMemberAccesses(
  files: string[],
  ident: string,
): Map<string, string[]> {
  const usage = new Map<string, string[]>(); // prop -> files using it
  const re = new RegExp(`\\b${ident}\\.([a-zA-Z_$][\\w$]*)`, "g");
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // Strip comments so prose like "pool.query() may route..." doesn't count.
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      // Strip string/template literals (catalog descriptions mention "pool").
      .replace(/`(?:\\.|[^`\\])*`/g, "``")
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/'(?:\\.|[^'\\])*'/g, "''");
    for (const m of code.matchAll(re)) {
      const prop = m[1];
      if (!prop) continue;
      const rel = file.slice(SRC_ROOT.length + 1);
      const list = usage.get(prop) ?? [];
      if (!list.includes(rel)) list.push(rel);
      usage.set(prop, list);
    }
  }
  return usage;
}

describe("shared @workspace/db pool mock completeness", () => {
  const files = listProductionSources(SRC_ROOT);
  // Only consider files that actually import pool from @workspace/db.
  const poolFiles = files.filter((f) => {
    const t = readFileSync(f, "utf8");
    return /from\s+["']@workspace\/db["']/.test(t) && /\bpool\b/.test(t);
  });

  it("stubs every pool member that production code uses", () => {
    const usage = collectMemberAccesses(poolFiles, "pool");
    const { pool } = createDbPoolMock();

    const missing = [...usage.keys()].filter((prop) => !(prop in pool));

    expect(
      missing,
      `Production code under src/ uses pool member(s) not stubbed by ` +
        `createDbPoolMock() in src/__tests__/helpers/dbPoolMock.ts: ` +
        missing
          .map((p) => `pool.${p} (used in ${usage.get(p)!.join(", ")})`)
          .join("; ") +
        `. Add stub(s) for them to the factory — otherwise every suite ` +
        `mocking @workspace/db via the factory will fail at run time with ` +
        `"pool.${missing[0]} is not a function", exactly the drift that ` +
        `broke rate-limit-prune.test.ts when advisory locks moved to ` +
        `pool.connect().`,
    ).toEqual([]);
  });

  it("connect() returns a client covering every client member used in src/", async () => {
    // Files that check out a client via pool.connect() conventionally name
    // it `client`; scan those files for client.<prop> accesses.
    const clientFiles = poolFiles.filter((f) =>
      /pool\.connect\(\)/.test(readFileSync(f, "utf8")),
    );
    const usage = collectMemberAccesses(clientFiles, "client");
    const { pool } = createDbPoolMock();
    const client = (await (
      pool.connect as () => Promise<Record<string, unknown>>
    )()) as Record<string, unknown>;

    const missing = [...usage.keys()].filter((prop) => !(prop in client));

    expect(
      missing,
      `Production code uses pool-client member(s) not stubbed on the ` +
        `client returned by createDbPoolMock().pool.connect(): ` +
        missing
          .map((p) => `client.${p} (used in ${usage.get(p)!.join(", ")})`)
          .join("; ") +
        `. Add them to the connect() client stub in ` +
        `src/__tests__/helpers/dbPoolMock.ts.`,
    ).toEqual([]);
  });

  it("sanity: the scan actually finds known pool usages", () => {
    // Guard the guard — if the scanner regressed to finding nothing, the
    // completeness checks above would pass vacuously.
    const usage = collectMemberAccesses(poolFiles, "pool");
    expect(usage.has("query")).toBe(true);
    expect(usage.has("connect")).toBe(true);
  });
});
