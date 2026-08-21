/**
 * Ensure every @workspace/api-zod symbol imported by an API route still
 * exists in the package source. This is intentionally source-based: it runs
 * before TypeScript/codegen and catches a route/schema rename at the point
 * where it is introduced.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const routesDir = fileURLToPath(new URL("../artifacts/api-server/src/routes", import.meta.url));
const apiZodDir = fileURLToPath(new URL("../lib/api-zod/src", import.meta.url));

export function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function resolveModule(fromFile, specifier, packageDir) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
  return candidates.find((candidate) => candidate.startsWith(`${packageDir}${path.sep}`) && fs.existsSync(candidate)) ?? null;
}

function declaredOrImportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/\b(?:export\s+)?(?:const|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/\bimport\s*\{([^}]+)\}\s*from\s*["'][^"']+["']/g)) {
    for (const part of match[1].split(",")) {
      const local = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[1] ?? part.trim().replace(/^type\s+/, "");
      if (/^[A-Za-z_$][\w$]*$/.test(local)) names.add(local);
    }
  }
  return names;
}

/**
 * Return the names exported by a TypeScript source package, following local
 * barrel re-exports. This deliberately scans source rather than resolving the
 * compiled package entrypoint.
 */
export function discoverExports(packageDir) {
  const packageRoot = path.resolve(packageDir);
  const files = walk(packageRoot).filter((file) => file.endsWith(".ts"));
  const fileSet = new Set(files);
  const cache = new Map();

  function exportsFor(file) {
    if (cache.has(file)) return cache.get(file);
    const result = new Set();
    cache.set(file, result);
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bexport\s+(?:const|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) {
      result.add(match[1]);
    }

    for (const match of source.matchAll(/\bexport\s+\*\s+from\s*["']([^"']+)["']/g)) {
      const target = resolveModule(file, match[1], packageRoot);
      if (target) for (const name of exportsFor(target)) result.add(name);
    }

    for (const match of source.matchAll(/\bexport\s*\{([^}]+)\}(?:\s*from\s*["']([^"']+)["'])?/g)) {
      const localNames = declaredOrImportedNames(source);
      const target = match[2] ? resolveModule(file, match[2], packageRoot) : null;
      const targetExports = target ? exportsFor(target) : null;
      for (const part of match[1].split(",")) {
        const pieces = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
        const sourceName = pieces[0]?.trim();
        const exportedName = pieces[1]?.trim() ?? sourceName;
        if (!sourceName || !exportedName) continue;
        if (targetExports ? targetExports.has(sourceName) : localNames.has(sourceName)) {
          result.add(exportedName);
        }
      }
    }
    return result;
  }

  const entry = path.join(packageRoot, "index.ts");
  if (fileSet.has(entry)) return exportsFor(entry);
  const exported = new Set();
  for (const file of files) for (const name of exportsFor(file)) exported.add(name);
  return exported;
}

function run() {
  for (const directory of [routesDir, apiZodDir]) {
    if (!fs.existsSync(directory)) {
      console.error(`check-api-route-schema-drift: directory not found: ${directory}`);
      process.exitCode = 1;
      return;
    }
  }

  const exported = discoverExports(apiZodDir);
  const missing = [];
  for (const file of walk(routesDir).filter((f) => f.endsWith(".ts") && !f.includes("__tests__"))) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/import\s*\{([^;{}]*?)\}\s*from\s*["']@workspace\/api-zod["']/g)) {
      const names = match[1]
        .split(",")
        .map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0])
        .filter(Boolean);
      for (const name of names) {
        if (!exported.has(name)) missing.push(`${path.relative(root, file)}: ${name}`);
      }
    }
  }

  if (missing.length) {
    console.error("[check:api-route-schema-drift] FAIL — missing api-zod exports:");
    for (const item of missing) console.error(`  ${item}`);
    process.exitCode = 1;
    return;
  }

  console.log("[check:api-route-schema-drift] OK — all route imports resolve to api-zod exports.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}