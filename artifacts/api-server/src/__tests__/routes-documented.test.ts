/**
 * routes-documented.test.ts
 *
 * CI guard: every route registered in src/routes/ must have a matching path
 * and HTTP method entry in lib/api-spec/openapi.yaml.
 *
 * ## Why this exists
 *
 * The /tidal/pack endpoint shipped in production code without a corresponding
 * OpenAPI entry and was only discovered through a manual audit.  This test
 * catches that class of gap automatically by comparing the live Express route
 * surface against the spec on every CI run.
 *
 * ## How it works
 *
 * 1. Parses openapi.yaml to collect every documented `METHOD /path` pair.
 * 2. Scans src/routes/*.ts with a line-level regex to collect every
 *    `router.METHOD("path", ...)` call (both inline and multi-line forms).
 * 3. Normalises path-parameter syntax: Express `:id` ↔ OpenAPI `{id}`.
 * 4. Fails with a clear list if any registered route is absent from the spec.
 *
 * ## How to fix a failure
 *
 * Option A (preferred): add the missing route to lib/api-spec/openapi.yaml
 * and run `pnpm run docs` so the generated docs stay in sync.
 *
 * Option B (intentionally internal endpoints only): add the route to
 * UNDOCUMENTED_ALLOWLIST below with a comment explaining why it is excluded.
 *
 * ## Mount prefixes
 *
 * Some routers are mounted under a sub-path in src/routes/index.ts:
 *   router.use("/poe",    poeRouter)
 *   router.use("/github", githubRouter)
 * Routes in those files have the mount prefix added before comparison.
 * All other routers are mounted with no prefix.
 */

import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROUTES_DIR = join(__dirname, "..", "routes");
const OPENAPI_PATH = resolve(__dirname, "../../../../lib/api-spec/openapi.yaml");

// ---------------------------------------------------------------------------
// Allowlist — intentionally undocumented routes
//
// Only add entries here for internal/admin routes that are deliberately
// excluded from the public API spec.  Each entry must include a comment.
// ---------------------------------------------------------------------------
const UNDOCUMENTED_ALLOWLIST = new Set([
  // Internal admin endpoint: clears the in-memory NOAA station cache.
  // Not part of the public API surface; only callable by admin user IDs.
  "POST /tidal/admin/refresh-stations",
  // Internal admin endpoint: returns per-key rate-limit usage counters.
  // Not part of the public API surface; only callable by admin user IDs.
  "GET /admin/rate-limit/usage",
  // Internal admin endpoint: returns in-process upscale cache hit/miss stats.
  // Not part of the public API surface; only callable by admin user IDs.
  "GET /admin/upscale-cache-stats",
  // Internal upload-session endpoint: returns which chunk indices are on disk
  // for a given uploadId.  Used by the frontend auto-resume logic after a
  // server reconnect; not part of the public OpenAPI surface.
  "GET /datasets/upload/chunk/status/{uploadId}",
]);

// ---------------------------------------------------------------------------
// Mount prefixes — routers mounted under a sub-path in routes/index.ts
// ---------------------------------------------------------------------------
const MOUNT_PREFIXES: Record<string, string> = {
  "poe.ts": "/poe",
  "github.ts": "/github",
};

// ---------------------------------------------------------------------------
// Files that do not define API endpoints
// ---------------------------------------------------------------------------
const EXCLUDED_FILES = new Set(["index.ts", "schemas.ts"]);

// ---------------------------------------------------------------------------
// OpenAPI path parser
// ---------------------------------------------------------------------------

/**
 * Parses lib/api-spec/openapi.yaml and returns every documented route as a
 * normalised string: "METHOD /path/with/{params}".
 *
 * Uses the same fixed-indentation line-scanner as generate-api-docs.mjs —
 * no YAML parser dependency required.
 */
function parseOpenApiRoutes(yamlText: string): Set<string> {
  const HTTP_METHODS = new Set([
    "get", "post", "put", "patch", "delete", "head", "options",
  ]);

  const documented = new Set<string>();
  let inPaths = false;
  let currentPath: string | null = null;

  for (const rawLine of yamlText.split("\n")) {
    const indent = rawLine.length - rawLine.trimStart().length;
    const content = rawLine.trim();

    if (!content || content.startsWith("#")) continue;

    if (indent === 0) {
      if (content === "paths:") {
        inPaths = true;
      } else if (inPaths) {
        inPaths = false;
      }
      continue;
    }

    if (!inPaths) continue;

    if (indent === 2) {
      const match = content.match(/^(\/[^:]+):/);
      if (match) currentPath = match[1] ?? null;
      continue;
    }

    if (indent === 4 && currentPath) {
      const methodKey = content.replace(/:.*$/, "").toLowerCase();
      if (HTTP_METHODS.has(methodKey)) {
        documented.add(`${methodKey.toUpperCase()} ${currentPath}`);
      }
    }
  }

  return documented;
}

// ---------------------------------------------------------------------------
// Route file scanner
// ---------------------------------------------------------------------------

/**
 * Converts an Express route path to the OpenAPI `{param}` style used in the
 * spec so the two can be compared with simple string equality.
 *
 * Handles both named params and Express 5 wildcard params:
 *   /markers/:id                            → /markers/{id}
 *   /github/repos/:owner/:repo/contents/*path
 *                                           → /github/repos/{owner}/{repo}/contents/{path}
 */
function expressToOpenApiPath(expressPath: string): string {
  return expressPath
    .replace(/\*([a-zA-Z_][a-zA-Z0-9_]*)/g, "{$1}")  // Express 5 wildcards: *path → {path}
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, "{$1}");   // named params:        :id   → {id}
}

interface ExtractedRoute {
  method: string;
  path: string;
  /** Source file base name, for diagnostic messages */
  sourceFile: string;
}

/**
 * Scans a single route TypeScript source file and extracts every
 * `router.METHOD(path, …)` call.
 *
 * Handles two common patterns:
 *
 *   Inline:
 *     router.get("/path", handler)
 *
 *   Multi-line (path on the next line):
 *     router.post(
 *       "/path",
 *       handler,
 *     )
 */
function extractRoutesFromFile(
  filePath: string,
  mountPrefix: string,
  sourceFile: string,
): ExtractedRoute[] {
  const source = readFileSync(filePath, "utf8");
  const lines = source.split("\n");
  const routes: ExtractedRoute[] = [];

  const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    for (const method of HTTP_METHODS) {
      // Pattern 1: router.get("/path", ...)  — path on same line as method call
      const inlineRe = new RegExp(
        `router\\.${method}\\s*\\(\\s*["'\`]([^"'\`]+)["'\`]`,
      );
      const inlineMatch = line.match(inlineRe);
      if (inlineMatch) {
        routes.push({
          method: method.toUpperCase(),
          path: mountPrefix + (inlineMatch[1] ?? ""),
          sourceFile,
        });
        break;
      }

      // Pattern 2: router.post(\n  "/path",  — path on the very next line
      const openRe = new RegExp(`router\\.${method}\\s*\\(\\s*$`);
      if (openRe.test(line) && i + 1 < lines.length) {
        const nextLine = (lines[i + 1] ?? "").trim();
        const pathMatch = nextLine.match(/^["'\`]([^"'\`]+)["'\`]/);
        if (pathMatch) {
          routes.push({
            method: method.toUpperCase(),
            path: mountPrefix + (pathMatch[1] ?? ""),
            sourceFile,
          });
        }
        break;
      }
    }
  }

  return routes;
}

function getRouteFiles(): Array<{ filePath: string; prefix: string; name: string }> {
  return readdirSync(ROUTES_DIR)
    .filter(
      (f) =>
        f.endsWith(".ts") &&
        !f.endsWith(".test.ts") &&
        !EXCLUDED_FILES.has(f),
    )
    .map((f) => ({
      filePath: join(ROUTES_DIR, f),
      prefix: MOUNT_PREFIXES[f] ?? "",
      name: f,
    }));
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("routes-documented", () => {
  it("every registered Express route must have a matching entry in openapi.yaml", () => {
    const yamlText = readFileSync(OPENAPI_PATH, "utf8");
    const documentedRoutes = parseOpenApiRoutes(yamlText);

    const routeFiles = getRouteFiles();

    const violations: string[] = [];

    for (const { filePath, prefix, name } of routeFiles) {
      const routes = extractRoutesFromFile(filePath, prefix, name);

      for (const route of routes) {
        const normalised = `${route.method} ${expressToOpenApiPath(route.path)}`;

        if (
          !documentedRoutes.has(normalised) &&
          !UNDOCUMENTED_ALLOWLIST.has(normalised)
        ) {
          violations.push(
            `  ${normalised}  (in ${route.sourceFile})`,
          );
        }
      }
    }

    if (violations.length > 0) {
      const list = violations.join("\n");
      throw new Error(
        `The following Express routes are not documented in openapi.yaml:\n\n` +
          `${list}\n\n` +
          `Fix options:\n` +
          `  A) Add the missing path+method to lib/api-spec/openapi.yaml, then run:\n` +
          `       pnpm run docs\n` +
          `     to regenerate the API route tables in README.md and replit.md.\n` +
          `  B) If the route is intentionally internal (admin-only, not public),\n` +
          `     add it to UNDOCUMENTED_ALLOWLIST in routes-documented.test.ts\n` +
          `     with a comment explaining why it is excluded.\n`,
      );
    }

    // Sanity-check: ensure we actually scanned some routes
    const totalScanned = routeFiles.flatMap(({ filePath, prefix, name }) =>
      extractRoutesFromFile(filePath, prefix, name),
    ).length;
    expect(totalScanned).toBeGreaterThan(0);
    expect(documentedRoutes.size).toBeGreaterThan(0);
  });
});
