#!/usr/bin/env node
/**
 * check-testdb-schema-drift.mjs
 *
 * Verifies that every `uniqueIndex(...)` declared in lib/db/src/schema/*.ts
 * for a table that exists in lib/db/src/__tests__/test-db.ts is also
 * represented (by name) as a CREATE UNIQUE INDEX or UNIQUE CONSTRAINT clause
 * in the test-db.ts DDL string.
 *
 * This guards against the class of drift discovered when a new uniqueIndex is
 * added to a Drizzle schema file but the corresponding hand-written DDL in
 * test-db.ts is not updated — causing DB-level constraint tests to silently
 * pass against a weaker schema than production.
 *
 * Scope: only uniqueIndex declarations whose table is listed in test-db.ts
 * (via `CREATE TABLE <name>`) are checked. Tables that have no presence in
 * test-db.ts are intentionally skipped because they have no constraint tests.
 *
 * Exit 1 if any uniqueIndex names are missing from test-db.ts DDL; 0 otherwise.
 *
 * Usage:
 *   node scripts/check-testdb-schema-drift.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const schemaDir = resolve(root, "lib/db/src/schema");
const testDbPath = resolve(root, "lib/db/src/__tests__/test-db.ts");

// ---------------------------------------------------------------------------
// Read test-db.ts — normalise to lowercase for case-insensitive matching.
// ---------------------------------------------------------------------------

const testDbContent = readFileSync(testDbPath, "utf8").toLowerCase();

// Extract table names from `CREATE TABLE <name>` lines in the DDL string.
const testDbTableNames = new Set();
for (const m of testDbContent.matchAll(/create\s+table\s+(\w+)/g)) {
  testDbTableNames.add(m[1]);
}

// ---------------------------------------------------------------------------
// Walk each schema file and collect (tableName[], uniqueIndexName) pairs.
// ---------------------------------------------------------------------------

const schemaFiles = readdirSync(schemaDir)
  .filter((f) => f.endsWith(".ts") && f !== "index.ts")
  .sort();

/** @type {{ file: string; tables: string[]; indexName: string }[]} */
const violations = [];
let checkedCount = 0;

for (const file of schemaFiles) {
  const filePath = resolve(schemaDir, file);
  const content = readFileSync(filePath, "utf8");

  // All pgTable("table_name", …) calls in this file.
  const tableNames = [...content.matchAll(/pgTable\s*\(\s*["']([^"']+)["']/g)].map(
    (m) => m[1],
  );

  // All uniqueIndex("index_name") calls in this file.
  const uniqueIndexNames = [...content.matchAll(/uniqueIndex\s*\(\s*["']([^"']+)["']/g)].map(
    (m) => m[1],
  );

  if (uniqueIndexNames.length === 0) continue;

  // Only check tables that are mirrored in test-db.ts.
  const relevantTables = tableNames.filter((t) => testDbTableNames.has(t));
  if (relevantTables.length === 0) continue;

  // For each uniqueIndex, verify the name appears literally in test-db.ts.
  for (const indexName of uniqueIndexNames) {
    checkedCount++;
    if (!testDbContent.includes(indexName.toLowerCase())) {
      violations.push({
        file: `lib/db/src/schema/${file}`,
        tables: relevantTables,
        indexName,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (violations.length > 0) {
  console.error(
    "[check:testdb-schema-drift] FAIL — uniqueIndex declaration(s) in the Drizzle schema\n" +
    "  are missing from lib/db/src/__tests__/test-db.ts:\n",
  );
  for (const v of violations) {
    console.error(`  uniqueIndex("${v.indexName}")`);
    console.error(`    schema file : ${v.file}`);
    console.error(`    table(s)    : ${v.tables.join(", ")} (present in test-db.ts)`);
    console.error();
  }
  console.error(
    "  Fix: add a matching CREATE UNIQUE INDEX <name> … or\n" +
    "  CONSTRAINT <name> UNIQUE (…) clause to the appropriate CREATE TABLE\n" +
    "  block in lib/db/src/__tests__/test-db.ts.",
  );
  process.exit(1);
}

console.log(
  `[check:testdb-schema-drift] OK — all ${checkedCount} uniqueIndex declaration(s) ` +
  `for test-db.ts tables are present in the hand-written DDL.`,
);
