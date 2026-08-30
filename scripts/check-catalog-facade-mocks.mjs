#!/usr/bin/env node
/**
 * Ensure catalog-related wholesale test doubles expose the runtime exports
 * their importing modules require. Keeping this check source-based avoids
 * importing the facade (and triggering Vitest mocks) just to validate test
 * setup.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const API_SRC = join(ROOT, "artifacts/api-server/src");
const FACADE_PATH = join(
  ROOT,
  "artifacts/api-server/src/domains/catalog-search/catalog-service.ts",
);
const SEEDER_PATH = join(ROOT, "artifacts/api-server/src/lib/catalogSeeder.ts");
const FETCH_STRATEGY_PATH = join(
  ROOT,
  "artifacts/api-server/src/lib/catalogFetchStrategy.ts",
);

function findModuleImportClauses(source, moduleName) {
  const clauses = [];
  const importRe = new RegExp(
    `\\bimport\\s+([^;]*?)\\s+from\\s*["'][^"']*${moduleName}["']`,
    "g",
  );

  for (const match of source.matchAll(importRe)) {
    clauses.push(match[1]);
  }
  return clauses;
}

function stripImportComments(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function parseNamedImportClause(clause) {
  const namedMatch = clause.match(/\{([\s\S]*?)\}/);
  if (!namedMatch) return [];

  const imports = [];
  for (const part of namedMatch[1].split(",")) {
    const cleaned = stripImportComments(part).trim();
    if (!cleaned || cleaned.startsWith("type ")) continue;
    imports.push(cleaned.split(/\s+as\s+/)[0].trim());
  }
  return imports;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Return runtime exports imported from a module, including properties read
 * through namespace aliases. A namespace import does not name an export until
 * code reads one of its properties, so only those properties become mock
 * requirements. Default imports always require the module's `default` key.
 */
export function parseRuntimeImports(source, moduleName) {
  const imports = new Set();
  const namespaceLocals = [];

  for (const rawClause of findModuleImportClauses(source, moduleName)) {
    const clause = stripImportComments(rawClause).trim();
    if (!clause || clause.startsWith("type ")) continue;

    for (const name of parseNamedImportClause(clause)) {
      imports.add(name);
    }

    const namespaceMatch = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (namespaceMatch) {
      namespaceLocals.push(namespaceMatch[1]);
    }

    const defaultPart = clause.split(",")[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(defaultPart)) {
      imports.add("default");
    }
  }

  for (const local of namespaceLocals) {
    const escapedLocal = escapeRegExp(local);
    const memberRe = new RegExp(
      `\\b${escapedLocal}\\s*(?:\\?\\.)?\\s*\\.\\s*([A-Za-z_$][\\w$]*)`,
      "g",
    );
    for (const match of source.matchAll(memberRe)) {
      imports.add(match[1]);
    }

    const indexedMemberRe = new RegExp(
      `\\b${escapedLocal}\\s*\\[\\s*(['"])([^'"]+)\\1\\s*\\]`,
      "g",
    );
    for (const match of source.matchAll(indexedMemberRe)) {
      if (/^[A-Za-z_$][\w$]*$/.test(match[2])) {
        imports.add(match[2]);
      }
    }
  }

  return [...imports];
}

export function parseNamedRuntimeImports(source, moduleName) {
  return parseRuntimeImports(source, moduleName).filter((name) => name !== "default");
}

/**
 * Return the top-level object literal bodies used by vi.mock factories.
 *
 * A regex that stops at the first `});` misreads nested fixture objects and
 * makes a future fixture shape change alter the guard's result. This small
 * scanner only needs to understand strings, comments, and balanced braces.
 */
export function findMockObjects(source, moduleSuffix) {
  const calls = [];
  const callRe = /vi\.mock\(\s*(['"])([^'"]+)\1\s*,/g;

  for (const call of source.matchAll(callRe)) {
    if (!call[2].endsWith(moduleSuffix)) continue;

    const nextCall = source.indexOf("vi.mock(", call.index + call[0].length);
    const callSource = source.slice(call.index, nextCall === -1 ? source.length : nextCall);
    const factoryStart = callSource.search(/=>\s*\(\s*\{/);
    if (factoryStart === -1) continue;

    const openBrace = call.index + factoryStart + callSource.slice(factoryStart).indexOf("{");
    const closeBrace = findMatchingBrace(source, openBrace);
    if (closeBrace === -1) continue;
    calls.push({ target: call[2], body: source.slice(openBrace + 1, closeBrace) });
  }
  return calls;
}

function findMatchingBrace(source, openBrace) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openBrace; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return i;
  }
  return -1;
}

export function parseTopLevelMockKeys(body) {
  const keys = new Set();
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    const next = body[i + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[" || char === "(") {
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]" || char === ")") {
      depth -= 1;
      continue;
    }
    if (depth !== 0 || !/[A-Za-z_$]/.test(char)) continue;

    const keyStart = i;
    i += 1;
    while (i < body.length && /[\w$]/.test(body[i])) i += 1;
    while (i < body.length && /\s/.test(body[i])) i += 1;
    const key = body.slice(keyStart, i).trim();
    if (body[i] === ":" || body[i] === "," || i === body.length) {
      keys.add(key);
    }
    i -= 1;
  }
  return keys;
}

function collectTestFiles(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      files.push(...collectTestFiles(path));
    } else if (name.endsWith(".test.ts") || name.endsWith(".spec.ts")) {
      files.push(path);
    }
  }
  return files;
}

const facadeRequired = parseNamedRuntimeImports(
  readFileSync(FACADE_PATH, "utf8"),
  "catalogSeeder\\.js",
);
const seederTerrainRequired = parseNamedRuntimeImports(
  readFileSync(SEEDER_PATH, "utf8"),
  "terrain\\.js",
);
const fetchStrategyTerrainRequired = parseNamedRuntimeImports(
  readFileSync(FETCH_STRATEGY_PATH, "utf8"),
  "terrain\\.js",
);
export function scanCatalogMockSource(
  source,
  {
    fileName = "<source>",
    facadeExports = facadeRequired,
    seederTerrainExports = seederTerrainRequired,
    fetchStrategyTerrainExports = fetchStrategyTerrainRequired,
  } = {},
) {
  const failures = [];
  for (const { body } of findMockObjects(source, "catalogSeeder.js")) {
    const mockKeys = parseTopLevelMockKeys(body);
    const required = new Set(facadeExports);
    for (const name of parseRuntimeImports(source, "catalogSeeder\\.js")) {
      required.add(name);
    }
    const missing = [...required].filter((name) => !mockKeys.has(name));
    if (missing.length > 0) {
      failures.push({
        kind: "catalogSeeder",
        fileName,
        missing,
      });
    }
  }

  const hasCatalogSeederImport = /from\s*["'][^"']*catalogSeeder\.js["']/.test(source);
  const hasFetchStrategyImport = /catalogFetchStrategy(?:\.js)?/.test(source);
  if (!hasCatalogSeederImport && !hasFetchStrategyImport) return failures;

  for (const { body } of findMockObjects(source, "terrain.js")) {
    const mockKeys = parseTopLevelMockKeys(body);
    const required = hasFetchStrategyImport
      ? fetchStrategyTerrainExports
      : seederTerrainExports;
    const missing = required.filter((name) => !mockKeys.has(name));
    if (missing.length > 0) {
      failures.push({
        kind: "terrain",
        fileName,
        missing,
      });
    }
  }
  return failures;
}

export function formatCatalogMockFailures(failures) {
  return [
    "Catalog-related test mock drift detected.",
    "Wholesale mocks are missing runtime-required exports:",
    ...failures.map(
      ({ kind, fileName, missing }) =>
        `  - ${fileName} (${kind}): missing ${missing.join(", ")}`,
    ),
    "",
    "Add inert/test-specific implementations for the missing exports, or use",
    "the shared terrain mock factory for terrain.js wholesale mocks.",
  ].join("\n");
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const failures = [];
  for (const filePath of collectTestFiles(API_SRC)) {
    failures.push(
      ...scanCatalogMockSource(readFileSync(filePath, "utf8"), {
        fileName: relative(ROOT, filePath),
      }),
    );
  }

  if (failures.length > 0) {
    console.error(formatCatalogMockFailures(failures));
    process.exit(1);
  }

  console.log(
    `Catalog-related test mocks cover ${facadeRequired.length} catalog facade export(s) ` +
      `and module-init terrain constants.`,
  );
}
