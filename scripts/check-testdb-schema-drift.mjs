#!/usr/bin/env node
/**
 * check-testdb-schema-drift.mjs
 *
 * Verifies that every column declared in lib/db/src/schema/*.ts for a table
 * that exists in lib/db/src/__tests__/test-db.ts is represented in that
 * table's hand-written CREATE TABLE DDL, and that the DDL has no extra
 * columns. It also checks uniqueIndex declarations against the DDL.
 *
 * This prevents constraint tests from silently using a different table shape
 * than production when either side gains or loses a column.
 *
 * Hardening (vs the original global-substring version):
 *   - The index-name search is scoped to the DDL slice of the matching table
 *     (from its `CREATE TABLE <name>` to the next `CREATE TABLE` or EOF),
 *     with SQL/TS comments stripped, and requires a UNIQUE keyword adjacent
 *     to the index name (`UNIQUE INDEX <name>` or `CONSTRAINT <name> UNIQUE`).
 *     An index name that appears only in a comment or in another table's
 *     block no longer satisfies the check.
 *   - Missing test-db.ts exits 1 with a clear, path-naming message.
 *   - Unreadable schema files emit a warning and are skipped.
 *
 * Scope: only uniqueIndex declarations whose table is listed in test-db.ts
 * (via `CREATE TABLE <name>`) are checked. Tables that have no presence in
 * test-db.ts are intentionally skipped because they have no constraint tests.
 *
 * Exit 1 if any mirrored table has missing or extra columns, or if any
 * uniqueIndex name is missing from its DDL; 0 otherwise.
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
// Helpers (exported for the regression test in scripts/__tests__/).
// ---------------------------------------------------------------------------

/**
 * Strip SQL (`-- …`, `/* … *​/`) and TS (`// …`) comments so commented-out
 * DDL can never satisfy the index check.
 */
export function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

/**
 * Parse a (lowercased, comment-stripped) DDL string into a map of
 * table name → DDL slice. Each slice runs from its `CREATE TABLE <name>`
 * to the start of the next `CREATE TABLE` (or EOF), so it includes the
 * table's column list plus any standalone CREATE [UNIQUE] INDEX statements
 * written immediately after the table block.
 */
export function extractTableSlices(content) {
  const slices = new Map();
  const matches = [
    ...content.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?(\w+)/g),
  ];
  for (let i = 0; i < matches.length; i++) {
    const name = matches[i][1];
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
    // A table name should not normally repeat; if it does, concatenate the
    // slices so nothing is silently dropped.
    const slice = content.slice(start, end);
    slices.set(name, (slices.get(name) ?? "") + "\n" + slice);
  }
  return slices;
}

/**
 * Extract the database column names from pgTable declarations. This is a
 * deliberately small parser rather than a TypeScript compiler dependency:
 * column declarations have the stable form `property: builder("db_name")`.
 */
export function extractDrizzleTableColumns(content) {
  content = stripComments(content);
  const tables = new Map();
  for (const match of content.matchAll(/pgTable\s*\(\s*["']([^"']+)["']/g)) {
    const open = content.indexOf("{", match.index + match[0].length);
    if (open < 0) continue;
    let depth = 0;
    let close = -1;
    let quote = null;
    for (let i = open; i < content.length; i++) {
      const ch = content[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}" && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close < 0) continue;
    const columns = new Set();
    const body = stripComments(content.slice(open + 1, close));
    for (const column of body.matchAll(/\b\w+\s*:\s*\w+\s*\(\s*["']([^"']+)["']/g)) {
      columns.add(column[1].toLowerCase());
    }
    tables.set(match[1].toLowerCase(), columns);
  }
  return tables;
}

/**
 * Extract only top-level column definitions from a CREATE TABLE statement.
 * Constraints and table-level indexes are intentionally excluded.
 */
export function extractDdlTableColumns(slice) {
  const open = slice.indexOf("(");
  if (open < 0) return new Set();
  let depth = 0;
  let quote = null;
  let close = -1;
  for (let i = open; i < slice.length; i++) {
    const ch = slice[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0) return new Set();
  const columns = new Set();
  let item = "";
  depth = 0;
  quote = null;
  const body = slice.slice(open + 1, close);
  const items = [];
  for (const ch of body) {
    if (quote) {
      item += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      item += ch;
    } else if (ch === "(") {
      depth++;
      item += ch;
    } else if (ch === ")") {
      depth--;
      item += ch;
    } else if (ch === "," && depth === 0) {
      items.push(item);
      item = "";
    } else {
      item += ch;
    }
  }
  items.push(item);
  for (const entry of items) {
    const first = entry.trim().match(/^(?:"([^"]+)"|`([^`]+)`|([a-z_]\w*))/i);
    if (!first || /^(constraint|primary|unique|check|foreign)\b/i.test(entry.trim())) continue;
    columns.add((first[1] ?? first[2] ?? first[3]).toLowerCase());
  }
  return columns;
}

/**
 * True when the (lowercased, comment-stripped) table slice contains a real
 * unique clause for the index name: `UNIQUE INDEX <name>` (covers
 * `CREATE UNIQUE INDEX`) or `CONSTRAINT <name> UNIQUE`.
 */
export function sliceHasUniqueClause(slice, indexName) {
  const escaped = indexName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const uniqueIndexRe = new RegExp(
    `unique\\s+index\\s+(?:if\\s+not\\s+exists\\s+)?(?:concurrently\\s+)?["'\`]?${escaped}\\b`,
  );
  const constraintRe = new RegExp(`constraint\\s+["'\`]?${escaped}["'\`]?\\s+unique\\b`);
  return uniqueIndexRe.test(slice) || constraintRe.test(slice);
}

// ---------------------------------------------------------------------------
// Read test-db.ts — normalise to lowercase for case-insensitive matching.
// ---------------------------------------------------------------------------

let testDbRaw;
try {
  testDbRaw = readFileSync(testDbPath, "utf8");
} catch (err) {
  console.error(
    `[check:testdb-schema-drift] FAIL — test-db.ts not found at ${testDbPath}\n` +
    `  (${err.code ?? err.message}). The schema-drift guard cannot run without it.`,
  );
  process.exit(1);
}

const testDbContent = stripComments(testDbRaw.toLowerCase());
const tableSlices = extractTableSlices(testDbContent);
const testDbTableNames = new Set(tableSlices.keys());

// ---------------------------------------------------------------------------
// Walk each schema file and collect (tableName, uniqueIndexName) pairs.
// ---------------------------------------------------------------------------

const schemaFiles = readdirSync(schemaDir)
  .filter((f) => f.endsWith(".ts") && f !== "index.ts")
  .sort();

/** @type {{ file: string; tables: string[]; indexName: string }[]} */
const violations = [];
/** @type {{ file: string; table: string; missing: string[]; extra: string[] }[]} */
const columnViolations = [];
let checkedCount = 0;
let checkedColumnCount = 0;

for (const file of schemaFiles) {
  const filePath = resolve(schemaDir, file);
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (err) {
    console.warn(
      `[check:testdb-schema-drift] WARN — could not read schema file ${filePath} ` +
      `(${err.code ?? err.message}); skipping.`,
    );
    continue;
  }

  const drizzleColumns = extractDrizzleTableColumns(content);

  // All pgTable("table_name", …) calls in this file, with their positions so
  // each uniqueIndex can be attributed to the nearest preceding table.
  const tableMatches = [...content.matchAll(/pgTable\s*\(\s*["']([^"']+)["']/g)];
  const tableNames = tableMatches.map((m) => m[1]);

  // All uniqueIndex("index_name") calls in this file, with positions.
  const indexMatches = [...content.matchAll(/uniqueIndex\s*\(\s*["']([^"']+)["']/g)];

  // Only check tables that are mirrored in test-db.ts.
  const relevantTables = tableNames.filter((t) => testDbTableNames.has(t));
  if (relevantTables.length === 0) continue;

  for (const table of relevantTables) {
    const expected = drizzleColumns.get(table.toLowerCase()) ?? new Set();
    const actual = extractDdlTableColumns(tableSlices.get(table.toLowerCase()) ?? "");
    const missing = [...expected].filter((column) => !actual.has(column)).sort();
    const extra = [...actual].filter((column) => !expected.has(column)).sort();
    checkedColumnCount += expected.size;
    if (missing.length > 0 || extra.length > 0) {
      columnViolations.push({
        file: `lib/db/src/schema/${file}`,
        table,
        missing,
        extra,
      });
    }
  }

  if (indexMatches.length === 0) continue;

  for (const idx of indexMatches) {
    const indexName = idx[1];

    // Attribute the index to the nearest preceding pgTable declaration.
    let owner = null;
    for (const tm of tableMatches) {
      if (tm.index < idx.index) owner = tm[1];
      else break;
    }

    // Tables to check: the owning table if we found one, otherwise every
    // relevant table in the file (conservative fallback).
    const candidates = owner ? [owner] : relevantTables;
    const mirrored = candidates.filter((t) => testDbTableNames.has(t));
    if (mirrored.length === 0) continue; // table not in test-db.ts → out of scope

    checkedCount++;
    const satisfied = mirrored.some((t) =>
      sliceHasUniqueClause(tableSlices.get(t) ?? "", indexName),
    );
    if (!satisfied) {
      violations.push({
        file: `lib/db/src/schema/${file}`,
        tables: mirrored,
        indexName,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (columnViolations.length > 0 || violations.length > 0) {
  console.error(
    "[check:testdb-schema-drift] FAIL — Drizzle schema and test-db.ts DDL differ:\n",
  );
  for (const v of columnViolations) {
    if (v.missing.length > 0) console.error(`  ${v.table}: missing from test-db.ts: ${v.missing.join(", ")}`);
    if (v.extra.length > 0) console.error(`  ${v.table}: extra in test-db.ts: ${v.extra.join(", ")}`);
    console.error(`    schema file : ${v.file}\n`);
  }
  for (const v of violations) {
    console.error(`  uniqueIndex("${v.indexName}")`);
    console.error(`    schema file : ${v.file}`);
    console.error(`    table(s)    : ${v.tables.join(", ")} (present in test-db.ts)`);
    console.error();
  }
  console.error(
    "  Fix: make the table columns match, and add a matching CREATE UNIQUE INDEX <name> … or\n" +
    "  CONSTRAINT <name> UNIQUE (…) clause to the appropriate CREATE TABLE\n" +
    "  block in lib/db/src/__tests__/test-db.ts. The name must appear inside\n" +
    "  that table's DDL block (comments don't count).",
  );
  process.exit(1);
}

console.log(
  `[check:testdb-schema-drift] OK — ${checkedColumnCount} columns and ${checkedCount} uniqueIndex declaration(s) ` +
  `for test-db.ts tables are present in the hand-written DDL.`,
);
