/**
 * Ensure every @workspace/api-zod symbol imported by an API route still
 * exists in the package source. This is intentionally source-based: it runs
 * before TypeScript/codegen and catches a route/schema rename at the point
 * where it is introduced.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const routesDir = path.join(root, "artifacts/api-server/src/routes");
const apiZodDir = path.join(root, "lib/api-zod/src");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const exported = new Set();
for (const file of walk(apiZodDir).filter((f) => f.endsWith(".ts"))) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bexport\s+(?:const|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    exported.add(match[1]);
  }
}

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
  process.exit(1);
}

console.log("[check:api-route-schema-drift] OK — all route imports resolve to api-zod exports.");