import { execSync } from "node:child_process";
import { existsSync, statSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(__dirname, "..", "..");
const apiServerDir = resolve(root, "artifacts/api-server");

// ---------------------------------------------------------------------------
// Codegen check — skip if generated API files are already present
// ---------------------------------------------------------------------------

const requiredFiles = [
  "lib/api-client-react/src/generated/api.ts",
  "lib/api-client-react/src/generated/api.schemas.ts",
  "lib/api-zod/src/generated/api.ts",
];

const codegenMissing = requiredFiles.some((p) => !existsSync(resolve(root, p)));

// ---------------------------------------------------------------------------
// Build-freshness helpers
// ---------------------------------------------------------------------------

/** Walk a directory recursively and return the newest mtime (ms) found. */
function newestMtimeInDir(dir: string): number {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = newestMtimeInDir(full);
      if (sub > newest) newest = sub;
    } else if (entry.isFile()) {
      try {
        const mt = statSync(full).mtimeMs;
        if (mt > newest) newest = mt;
      } catch {
        // ignore unreadable files
      }
    }
  }
  return newest;
}

/** Return the mtime (ms) of a file, or 0 if it does not exist. */
function mtimeMs(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// E2E build check — skip if dist-e2e/index.mjs is newer than all source files
// ---------------------------------------------------------------------------

const distEntry = resolve(apiServerDir, "dist-e2e/index.mjs");

function isBuildStale(): boolean {
  const distMtime = mtimeMs(distEntry);
  if (distMtime === 0) return true; // dist doesn't exist yet

  // Source inputs that should trigger a rebuild when changed.
  // Also include workspace lib packages that api-server depends on so that a
  // change in a shared library is not silently ignored.
  const workspaceLibs = [
    "lib/api-zod",
    "lib/db",
    "lib/integrations-openai-ai-server",
    "lib/poe",
  ];

  const sourceRoots = [
    resolve(apiServerDir, "src"),
    resolve(apiServerDir, "build.mjs"),
    resolve(apiServerDir, "package.json"),
    resolve(apiServerDir, "tsconfig.json"),
    ...workspaceLibs.map((lib) => resolve(root, lib, "src")),
  ];

  for (const src of sourceRoots) {
    let srcMtime: number;
    try {
      const stat = statSync(src);
      srcMtime = stat.isDirectory() ? newestMtimeInDir(src) : stat.mtimeMs;
    } catch {
      continue;
    }
    if (srcMtime > distMtime) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Global setup entry point
// ---------------------------------------------------------------------------

export default function globalSetup() {
  // --- Codegen ---
  if (codegenMissing) {
    console.log("[global-setup] Generated API files missing — running codegen…");
    execSync("pnpm --filter @workspace/api-spec run codegen", {
      cwd: root,
      stdio: "inherit",
    });
    console.log("[global-setup] Codegen complete.");
  } else {
    console.log("[global-setup] Generated API files present — skipping codegen.");
  }

  // --- E2E server build ---
  if (isBuildStale()) {
    console.log("[global-setup] dist-e2e/ is missing or stale — building api-server…");
    // Call build.mjs directly (not via `pnpm run build`) so that DIST_DIR is
    // unambiguously inherited by the Node.js process and not at risk of being
    // dropped or overridden by pnpm's script runner.
    execSync("node ./build.mjs", {
      cwd: apiServerDir,
      stdio: "inherit",
      env: { ...process.env, DIST_DIR: "dist-e2e" },
    });
    console.log("[global-setup] api-server build complete.");
  } else {
    console.log("[global-setup] dist-e2e/index.mjs is current — skipping build.");
  }
}
