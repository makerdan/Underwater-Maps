#!/usr/bin/env node
/**
 * Ensure route-test catalog seeder doubles expose every runtime export used by
 * the catalog facade. Keeping this check source-based avoids importing the
 * facade (and triggering Vitest mocks) just to validate test setup.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FACADE_PATH = join(
  ROOT,
  "artifacts/api-server/src/domains/catalog-search/catalog-service.ts",
);
const TEST_DIR = join(ROOT, "artifacts/api-server/src/routes/__tests__");
const MOCK_RE =
  /vi\.mock\(\s*["']\.\.\/\.\.\/lib\/catalogSeeder\.js["']\s*,\s*\(\)\s*=>\s*\(\{([\s\S]*?)\}\)\s*\);/g;

function parseRuntimeFacadeExports(source) {
  const importMatch = source.match(
    /import\s*\{([\s\S]*?)\}\s*from\s*["']\.\.\/\.\.\/lib\/catalogSeeder\.js["']/,
  );
  if (!importMatch) {
    throw new Error(
      `Could not find the catalogSeeder import in ${FACADE_PATH}`,
    );
  }

  return importMatch[1]
    .split(",")
    .map((part) => part.replace(/\/\/.*$/g, "").trim())
    .filter((part) => part && !part.startsWith("type "))
    .map((part) => part.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim());
}

function parseMockKeys(source) {
  return new Set(
    [...source.matchAll(MOCK_RE)].flatMap((match) => {
      const body = match[1];
      return [...body.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:/gm)].map(
        (property) => property[1],
      );
    }),
  );
}

const required = parseRuntimeFacadeExports(readFileSync(FACADE_PATH, "utf8"));
const failures = [];

for (const fileName of readdirSync(TEST_DIR).filter((name) =>
  name.endsWith(".test.ts"),
)) {
  const filePath = join(TEST_DIR, fileName);
  const source = readFileSync(filePath, "utf8");
  if (!source.includes('vi.mock("../../lib/catalogSeeder.js"')) continue;

  const mockKeys = parseMockKeys(source);
  const missing = required.filter((name) => !mockKeys.has(name));
  if (missing.length > 0) failures.push({ fileName, missing });
}

if (failures.length > 0) {
  console.error(
    [
      "Catalog facade route-test mock drift detected.",
      "Each catalogSeeder mock must expose the catalog facade's runtime exports:",
      ...failures.map(
        ({ fileName, missing }) =>
          `  - ${fileName}: missing ${missing.join(", ")}`,
      ),
      "",
      "Add only inert/test-specific implementations needed by the mounted route.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `Catalog facade route-test mocks cover ${required.length} runtime export(s).`,
);