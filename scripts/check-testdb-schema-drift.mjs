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
 * Exit 1 if any mirrored table has missing or extra columns, mismatched
 * column properties/foreign keys/check constraints, or if any uniqueIndex
 * name or definition is missing from or differs from its DDL; 0 otherwise.
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

function splitTopLevel(text) {
  const items = [];
  let item = "";
  let depth = 0;
  let quote = null;
  for (const ch of text) {
    if (quote) {
      item += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      item += ch;
    } else if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      item += ch;
    } else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      item += ch;
    } else if (ch === "," && depth === 0) {
      items.push(item);
      item = "";
    } else {
      item += ch;
    }
  }
  if (item.trim()) items.push(item);
  return items;
}

function matchingParen(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  return -1;
}

function normalizeIndexExpression(value) {
  return value
    .replace(/sql\s*`([\s\S]*?)`/g, "$1")
    .replace(/\$\{\s*(?:\w+\.)?(\w+)\s*\}/g, (_, name) =>
      name.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`),
    )
    .replace(/\b(?:table|t)\.(\w+)/g, (_, name) =>
      name.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`),
    )
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim()
    .toLowerCase();
}

/**
 * PostgreSQL index terms may carry modifiers after the expression. Drizzle
 * exposes sort/null ordering as chained methods on indexed columns, while the
 * hand-written DDL uses SQL keywords. Keep the expression representation
 * stable for existing callers and extract the supported modifiers separately.
 */
function extractIndexTermModifiers(value) {
  const source = value
    .replace(/sql\s*`([\s\S]*?)`/g, "$1")
    .replace(/\$\{\s*(?:\w+\.)?(\w+)\s*\}/g, (_, name) =>
      name.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`),
    )
    .replace(/\b(?:table|t)\.(\w+)/g, (_, name) =>
      name.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`),
    );
  const chain = {
    sort: /\.\s*(asc|desc)\s*\(\s*\)/i.exec(source)?.[1]?.toLowerCase() ?? null,
    nulls: /\.\s*nulls(First|Last)\s*\(\s*\)/i.exec(source)?.[1]?.toLowerCase() ?? null,
  };
  const chainCollation = source.match(/\.\s*collate\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/i)?.[1];
  const sqlCollation = source.match(/\bcollate\s+(?:"([^"]+)"|'([^']+)'|([a-z_][\w.$]*))/i);
  const chainOperatorClass = source.match(/\.\s*op\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/i)?.[1];
  // PostgreSQL's index grammar places the operator class after COLLATE and
  // before ASC/DESC (or NULLS). Operator classes are identifiers ending in
  // `_ops`, including schema-qualified and parameterized forms.
  const ddlOperatorClass = source.match(
    /(?:\bcollate\s+(?:"[^"]+"|'[^']+'|[a-z_][\w.$]*)\s+)?(?:"([^"]+_ops)"|'([^']+_ops)'|([a-z_][\w.$]*_ops))(?:\s*\([^)]*\))?(?=\s+(?:asc|desc|nulls)\b|$)/i,
  );
  const ddlSort = source.match(/\b(asc|desc)\b(?:\s+nulls\s+(?:first|last)\b)?\s*$/i)?.[1]?.toLowerCase();
  const ddlNulls = source.match(/\bnulls\s+(first|last)\b/i)?.[1]?.toLowerCase();
  return {
    sort: chain.sort ?? ddlSort ?? null,
    nulls: chain.nulls ?? ddlNulls ?? null,
    collation: (chainCollation ?? sqlCollation?.[1] ?? sqlCollation?.[2] ?? sqlCollation?.[3] ?? null)?.toLowerCase() ?? null,
    operatorClass: (chainOperatorClass ?? ddlOperatorClass?.[1] ?? ddlOperatorClass?.[2] ?? ddlOperatorClass?.[3] ?? null)?.toLowerCase() ?? null,
  };
}

function normalizeIndexTerm(value) {
  const modifiers = extractIndexTermModifiers(value);
  const expression = normalizeIndexExpression(
    value
      .replace(/\.\s*(?:asc|desc|nullsFirst|nullsLast)\s*\(\s*\)/gi, "")
      .replace(/\.\s*collate\s*\(\s*["'`][^"'`]+["'`]\s*\)/gi, "")
      .replace(/\.\s*op\s*\(\s*["'`][^"'`]+["'`]\s*\)/gi, "")
      .replace(/\s+\bcollate\s+(?:"[^"]+"|'[^']+'|[a-z_][\w.$]*)/gi, "")
      .replace(/\s+(?:"[^"]+"|'[^']+'|[a-z_][\w.$]*_ops)(?:\s*\([^)]*\))?(?=\s+(?:asc|desc|nulls)\b|$)/gi, "")
      .replace(/\s+\b(?:asc|desc)\b(?:\s+\bnulls\s+(?:first|last)\b)?\s*$/i, ""),
  );
  return { expression, modifiers };
}

function extractChainedCall(text, start, method) {
  let depth = 0;
  let quote = null;
  let chainEnd = text.length;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      chainEnd = i;
      break;
    }
  }
  const match = new RegExp(`\\.${method}\\s*\\(`, "g");
  match.lastIndex = start;
  const found = match.exec(text);
  if (!found || found.index >= chainEnd) return null;
  const open = text.indexOf("(", found.index);
  const close = matchingParen(text, open);
  if (close < 0) return null;
  return text.slice(open + 1, close);
}

/**
 * Extract uniqueIndex definitions from a schema file. The expressions are
 * canonicalized into the same simple SQL form used by the test DDL parser.
 */
export function extractDrizzleUniqueIndexes(content) {
  const indexes = new Map();
  for (const match of content.matchAll(/uniqueIndex\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    const callClose = content.indexOf(")", match.index + match[0].length - 1);
    const on = extractChainedCall(content, callClose + 1, "on");
    if (!on) continue;
    const where = extractChainedCall(content, callClose + 1, "where");
    indexes.set(match[1].toLowerCase(), {
      columns: splitTopLevel(on).map((term) => normalizeIndexTerm(term).expression),
      modifiers: splitTopLevel(on).map((term) => normalizeIndexTerm(term).modifiers),
      where: where == null ? null : normalizeIndexExpression(where),
    });
  }
  return indexes;
}

function extractDdlIndexCall(slice, indexName) {
  const escaped = indexName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const indexMatch = slice.match(new RegExp(
    `unique\\s+index\\s+(?:if\\s+not\\s+exists\\s+)?(?:concurrently\\s+)?["'\`]?${escaped}["'\`]?\\s+on\\s+\\w+\\s*\\(`,
  ));
  if (indexMatch) {
    const open = slice.indexOf("(", indexMatch.index + indexMatch[0].length - 1);
    const close = matchingParen(slice, open);
    if (close >= 0) {
      const where = slice.slice(close + 1).match(/\bwhere\b([\s\S]*?)(?=;|$)/i)?.[1] ?? null;
      return {
        columns: splitTopLevel(slice.slice(open + 1, close)).map((term) => normalizeIndexTerm(term).expression),
        modifiers: splitTopLevel(slice.slice(open + 1, close)).map((term) => normalizeIndexTerm(term).modifiers),
        where: where == null ? null : normalizeIndexExpression(where),
      };
    }
  }

  const constraintMatch = slice.match(new RegExp(
    `constraint\\s+["'\`]?${escaped}["'\`]?\\s+unique\\s*\\(`,
  ));
  if (constraintMatch) {
    const open = slice.indexOf("(", constraintMatch.index + constraintMatch[0].length - 1);
    const close = matchingParen(slice, open);
    if (close >= 0) {
      return {
        columns: splitTopLevel(slice.slice(open + 1, close)).map((term) => normalizeIndexTerm(term).expression),
        modifiers: splitTopLevel(slice.slice(open + 1, close)).map((term) => normalizeIndexTerm(term).modifiers),
        where: null,
      };
    }
  }
  return null;
}

export function compareUniqueIndexDefinitions(expected, actual, table, indexName) {
  if (!actual) return `${table} uniqueIndex("${indexName}") definition: missing from test-db.ts`;
  const differences = [];
  if (JSON.stringify(expected.columns) !== JSON.stringify(actual.columns)) {
    differences.push(
      `${table} uniqueIndex("${indexName}") columns: schema=${expected.columns.join(", ")}, test-db.ts=${actual.columns.join(", ")}`,
    );
  }
  const expectedModifiers = expected.modifiers ?? expected.columns.map(() => ({
    sort: null,
    nulls: null,
    collation: null,
    operatorClass: null,
  }));
  const actualModifiers = actual.modifiers ?? actual.columns.map(() => ({
    sort: null,
    nulls: null,
    collation: null,
    operatorClass: null,
  }));
  for (let i = 0; i < Math.max(expectedModifiers.length, actualModifiers.length); i++) {
    const e = expectedModifiers[i] ?? {
      sort: null,
      nulls: null,
      collation: null,
      operatorClass: null,
    };
    const a = actualModifiers[i] ?? {
      sort: null,
      nulls: null,
      collation: null,
      operatorClass: null,
    };
    const expression = expected.columns[i] ?? actual.columns[i] ?? `term ${i + 1}`;
    for (const [key, label] of [
      ["sort", "sort direction"],
      ["nulls", "NULL ordering"],
      ["collation", "collation"],
      ["operatorClass", "operator class"],
    ]) {
      if ((e[key] ?? null) !== (a[key] ?? null)) {
        differences.push(
          `${table} uniqueIndex("${indexName}") ${label} for ${expression}: ` +
          `schema=${e[key] ?? "default"}, test-db.ts=${a[key] ?? "default"}`,
        );
      }
    }
  }
  if (expected.where !== actual.where) {
    differences.push(
      `${table} uniqueIndex("${indexName}") WHERE: schema=${expected.where ?? "none"}, test-db.ts=${actual.where ?? "none"}`,
    );
  }
  return differences.length > 0 ? differences.join("; ") : null;
}

function normalizeType(type) {
  return type.toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/^timestamp without time zone$/, "timestamp")
    .replace(/^timestamp with time zone$/, "timestamptz")
    .replace(/^double precision$/, "double precision");
}

function normalizeDefault(value) {
  if (!value) return null;
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[()]/g, "").replace(/^['"]|['"]$/g, "").trim()
    .replace(/^current_timestamp$/, "now")
    .replace(/^now$/, "now")
    .replace(/^gen_random_uuid$/, "gen_random_uuid");
}

function normalizeIdentifier(value) {
  return value.replace(/Table$/, "").replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`).replace(/^_/, "");
}

function extractCreateBody(slice) {
  const open = slice.indexOf("(");
  if (open < 0) return "";
  let depth = 0;
  let quote = null;
  for (let i = open; i < slice.length; i++) {
    const ch = slice[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return slice.slice(open + 1, i);
  }
  return "";
}

function columnPropertyFromBuilder(entry) {
  const match = entry.trim().match(/^\w+\s*:\s*(\w+)\s*\(([\s\S]*?)\)/);
  if (!match) return null;
  const builder = match[1].toLowerCase();
  const args = match[2];
  const type = {
    text: "text", uuid: "uuid", real: "real", jsonb: "jsonb", integer: "integer",
    serial: "serial", bigint: "bigint", boolean: "boolean",
  }[builder];
  if (!type && builder !== "timestamp") return null;
  const property = {
    type: type ?? (/\bwithTimezone\s*:\s*true/.test(entry) ? "timestamptz" : "timestamp"),
    nullable: !/\.notNull\s*\(\s*\)/.test(entry),
    primaryKey: /\.primaryKey\s*\(\s*\)/.test(entry),
    default: null,
    references: null,
  };
  if (/\.defaultRandom\s*\(\s*\)/.test(entry)) property.default = "gen_random_uuid";
  else if (/\.defaultNow\s*\(\s*\)/.test(entry)) property.default = "now";
  else {
    const defaultMatch = entry.match(/\.default\s*\(\s*("[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|true|false|\[\]|\{\})\s*\)/);
    if (defaultMatch) property.default = normalizeDefault(defaultMatch[1].replace(/^['"]|['"]$/g, ""));
  }
  const target = entry.match(/\.references\s*\(\s*\(\s*[^)]*\)\s*(?::\s*[^=]+)?=>\s*([\w$]+)\s*\./)?.[1];
  const ref = entry.match(/\.references\s*\([\s\S]*?onDelete\s*:\s*["']([^"']+)["']/);
  if (target || /\.references\s*\(/.test(entry)) {
    property.references = {
      table: target ? normalizeIdentifier(target) : "unknown",
      onDelete: ref?.[1].toLowerCase() ?? "no action",
    };
  }
  return property;
}

/** Extract deterministic column properties from pgTable object literals. */
export function extractDrizzleTableDefinitions(content) {
  content = stripComments(content);
  const tables = new Map();
  for (const match of content.matchAll(/pgTable\s*\(\s*["']([^"']+)["']/g)) {
    const open = content.indexOf("{", match.index + match[0].length);
    if (open < 0) continue;
    let depth = 0, close = -1, quote = null;
    for (let i = open; i < content.length; i++) {
      const ch = content[i];
      if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) { close = i; break; }
    }
    if (close < 0) continue;
    const columns = new Map();
    for (const entry of splitTopLevel(content.slice(open + 1, close))) {
      const name = entry.trim().match(/^(\w+)\s*:/)?.[1];
      const property = columnPropertyFromBuilder(entry);
      const dbName = entry.trim().match(/^\w+\s*:\s*\w+\s*\(\s*["']([^"']+)["']/)?.[1];
      if (name && dbName && property) columns.set(dbName.toLowerCase(), property);
    }
    const nextTable = content.indexOf("pgTable", close + 1);
    const tableTail = content.slice(close, nextTable < 0 ? content.length : nextTable);
    const checks = [...tableTail.matchAll(/check\s*\(\s*["']([^"']+)["']/g)]
      .map((m) => m[1].toLowerCase());
    tables.set(match[1].toLowerCase(), { columns, checks });
  }
  return tables;
}

/** Extract deterministic column properties and named checks from CREATE TABLE DDL. */
export function extractDdlTableDefinitions(slice) {
  const columns = new Map();
  const checks = [];
  for (const entry of splitTopLevel(extractCreateBody(slice))) {
    const trimmed = entry.trim();
    const check = trimmed.match(/^constraint\s+["'`]?([\w]+)["'`]?\s+check\b/i);
    if (check) { checks.push(check[1].toLowerCase()); continue; }
    if (/^(constraint|primary|unique|foreign)\b/i.test(trimmed)) continue;
    const nameMatch = trimmed.match(/^(?:"([^"]+)"|`([^`]+)`|([a-z_]\w*))\s+/i);
    if (!nameMatch) continue;
    const name = (nameMatch[1] ?? nameMatch[2] ?? nameMatch[3]).toLowerCase();
    const afterName = trimmed.slice(nameMatch[0].length);
    const typeMatch = afterName.match(/^(timestamp\s+(?:with|without)\s+time\s+zone|[a-z]+)/i);
    if (!typeMatch) continue;
    const rest = afterName.slice(typeMatch[0].length);
    const property = {
      type: normalizeType(typeMatch[1]),
      nullable: !/\bnot\s+null\b/i.test(rest),
      primaryKey: /\bprimary\s+key\b/i.test(rest),
      default: normalizeDefault(trimmed.match(/\bdefault\s+(.+?)(?=\s+(?:not\s+null|primary\s+key|references|constraint|check)\b|$)/i)?.[1]),
      references: null,
    };
    const ref = rest.match(/\breferences\s+\w+\s*\([^)]*\)(?:\s+on\s+delete\s+([a-z ]+))?/i);
    if (ref) property.references = {
      table: normalizeIdentifier(ref[0].match(/\breferences\s+(\w+)/i)[1]),
      onDelete: (ref[1] ?? "no action").trim().toLowerCase(),
    };
    columns.set(name, property);
  }
  return { columns, checks };
}

function compareTableDefinitions(expected, actual, table) {
  const differences = [];
  for (const [column, e] of expected.columns) {
    const a = actual.columns.get(column);
    if (!a) continue;
    for (const property of ["type", "nullable", "default", "primaryKey"]) {
      if (e[property] !== a[property]) {
        differences.push(`${table}.${column} ${property}: schema=${String(e[property])}, test-db.ts=${String(a[property])}`);
      }
    }
    if (JSON.stringify(e.references) !== JSON.stringify(a.references)) {
      differences.push(`${table}.${column} references: schema=${e.references ? `${e.references.table}/${e.references.onDelete}` : "none"}, test-db.ts=${a.references ? `${a.references.table}/${a.references.onDelete}` : "none"}`);
    }
  }
  for (const check of expected.checks) {
    if (!actual.checks.includes(check)) differences.push(`${table} constraint ${check}: missing from test-db.ts`);
  }
  for (const check of actual.checks) {
    if (!expected.checks.includes(check)) differences.push(`${table} constraint ${check}: extra in test-db.ts`);
  }
  return differences;
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
/** @type {{ file: string; table: string; indexName: string; difference: string }[]} */
const indexDefinitionViolations = [];
/** @type {{ file: string; table: string; missing: string[]; extra: string[] }[]} */
const columnViolations = [];
/** @type {{ file: string; differences: string[] }[]} */
const propertyViolations = [];
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
  const drizzleDefinitions = extractDrizzleTableDefinitions(content);
  const drizzleIndexes = extractDrizzleUniqueIndexes(content);

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
    const expectedDefinition = drizzleDefinitions.get(table.toLowerCase());
    if (expectedDefinition) {
      const differences = compareTableDefinitions(
        expectedDefinition,
        extractDdlTableDefinitions(tableSlices.get(table.toLowerCase()) ?? ""),
        table,
      );
      if (differences.length > 0) propertyViolations.push({
        file: `lib/db/src/schema/${file}`,
        differences,
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
    const matchingTable = mirrored.find((t) =>
      sliceHasUniqueClause(tableSlices.get(t) ?? "", indexName),
    );
    if (!matchingTable) {
      violations.push({
        file: `lib/db/src/schema/${file}`,
        tables: mirrored,
        indexName,
      });
      continue;
    }
    const expected = drizzleIndexes.get(indexName.toLowerCase());
    const difference = expected
      ? compareUniqueIndexDefinitions(
        expected,
        extractDdlIndexCall(tableSlices.get(matchingTable) ?? "", indexName),
        matchingTable,
        indexName,
      )
      : null;
    if (difference) {
      indexDefinitionViolations.push({
        file: `lib/db/src/schema/${file}`,
        table: matchingTable,
        indexName,
        difference,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (
  columnViolations.length > 0 ||
  propertyViolations.length > 0 ||
  violations.length > 0 ||
  indexDefinitionViolations.length > 0
) {
  console.error(
    "[check:testdb-schema-drift] FAIL — Drizzle schema and test-db.ts DDL differ:\n",
  );
  for (const v of columnViolations) {
    if (v.missing.length > 0) console.error(`  ${v.table}: missing from test-db.ts: ${v.missing.join(", ")}`);
    if (v.extra.length > 0) console.error(`  ${v.table}: extra in test-db.ts: ${v.extra.join(", ")}`);
    console.error(`    schema file : ${v.file}\n`);
  }
  for (const v of propertyViolations) {
    for (const difference of v.differences) console.error(`  ${difference}`);
    console.error(`    schema file : ${v.file}\n`);
  }
  for (const v of violations) {
    console.error(`  uniqueIndex("${v.indexName}")`);
    console.error(`    schema file : ${v.file}`);
    console.error(`    table(s)    : ${v.tables.join(", ")} (present in test-db.ts)`);
    console.error();
  }
  for (const v of indexDefinitionViolations) {
    console.error(`  ${v.difference}`);
    console.error(`    schema file : ${v.file}\n`);
  }
  console.error(
    "  Fix: make the table columns and properties match, and add a matching CREATE UNIQUE INDEX <name> … or\n" +
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
