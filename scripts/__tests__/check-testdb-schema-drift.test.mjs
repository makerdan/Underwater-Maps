/**
 * Self-test for scripts/check-testdb-schema-drift.mjs
 *
 * Run via:  node --test scripts/__tests__/check-testdb-schema-drift.test.mjs
 *
 * Covers the hardening for the scoped index search and I/O guards:
 *   (a) index name appearing only in a comment → violation;
 *   (b) index name appearing only in an unrelated table's DDL block → violation;
 *   (c) correctly placed CREATE UNIQUE INDEX clause → passes;
 *   (d) missing test-db.ts → exit 1 with a path-containing message;
 *   (e) unreadable schema file → warning emitted, scan continues;
 *   (f) missing or extra columns → named column diagnostics;
 *   (g) matching columns → passes.
 *   (h) type, nullability, default, foreign-key, and check drift → diagnostics.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  stripComments,
  extractTableSlices,
  extractDrizzleTableColumns,
  extractDdlTableColumns,
  sliceHasUniqueClause,
  extractDrizzleUniqueIndexes,
  compareUniqueIndexDefinitions,
} from "../check-testdb-schema-drift.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, "..", "check-testdb-schema-drift.mjs");

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "testdb-drift-test-"));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Copy the real script into a fake repo layout so its resolve(scriptDir, "..")
 * root points at the sandbox. This runs the genuine script end-to-end without
 * touching the real lib/db tree.
 */
function makeFakeRepo(name) {
  const repo = join(sandbox, name);
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "lib", "db", "src", "schema"), { recursive: true });
  mkdirSync(join(repo, "lib", "db", "src", "__tests__"), { recursive: true });
  copyFileSync(scriptPath, join(repo, "scripts", "check-testdb-schema-drift.mjs"));
  return repo;
}

function writeSchema(repo, fileName, content) {
  writeFileSync(join(repo, "lib", "db", "src", "schema", fileName), content);
}

function writeTestDb(repo, ddl) {
  writeFileSync(
    join(repo, "lib", "db", "src", "__tests__", "test-db.ts"),
    `export async function createTestDb() {\n  await client.query(\`\n${ddl}\n\`);\n}\n`,
  );
}

function runScript(repo) {
  const result = spawnSync(
    "node",
    [join(repo, "scripts", "check-testdb-schema-drift.mjs")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

const MARKERS_SCHEMA = `
import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
export const markers = pgTable(
  "markers",
  { id: text("id").primaryKey(), label: text("label").notNull() },
  (table) => [uniqueIndex("markers_label_uniq").on(table.label)],
);
`;

const SIMPLE_SCHEMA = `
import { pgTable, text } from "drizzle-orm/pg-core";
export const markers = pgTable("markers", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
});
`;

const PARTIAL_SCHEMA = `
import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
export const folders = pgTable("folders", {
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  parentId: text("parent_id"),
}, (table) => [
  uniqueIndex("folders_root_uniq")
    .on(table.userId, sql\`lower(\${table.name})\`)
    .where(sql\`\${table.parentId} IS NULL\`),
]);
`;

describe("scoped index search", () => {
  it("(a) index name only in a comment → violation", () => {
    const repo = makeFakeRepo("comment-only");
    writeSchema(repo, "markers.ts", MARKERS_SCHEMA);
    writeTestDb(
      repo,
      `
    CREATE TABLE markers (
      id    text PRIMARY KEY,
      label text NOT NULL
    );
    -- TODO: CREATE UNIQUE INDEX markers_label_uniq ON markers (label);
    `,
    );

    const result = runScript(repo);
    assert.equal(result.status, 1, `expected exit 1\nstderr: ${result.stderr}`);
    assert.ok(
      result.stderr.includes("markers_label_uniq"),
      `stderr should name the missing index.\nstderr: ${result.stderr}`,
    );
  });

  it("(b) index name only in an unrelated table's block → violation", () => {
    const repo = makeFakeRepo("wrong-table");
    writeSchema(repo, "markers.ts", MARKERS_SCHEMA);
    writeTestDb(
      repo,
      `
    CREATE TABLE markers (
      id    text PRIMARY KEY,
      label text NOT NULL
    );

    CREATE TABLE other_things (
      id text PRIMARY KEY
    );

    CREATE UNIQUE INDEX markers_label_uniq ON other_things (id);
    `,
    );

    const result = runScript(repo);
    assert.equal(result.status, 1, `expected exit 1\nstderr: ${result.stderr}`);
    assert.ok(
      result.stderr.includes("markers_label_uniq"),
      `stderr should name the missing index.\nstderr: ${result.stderr}`,
    );
  });

  it("(c) correctly placed UNIQUE INDEX clause → passes", () => {
    const repo = makeFakeRepo("correct");
    writeSchema(repo, "markers.ts", MARKERS_SCHEMA);
    writeTestDb(
      repo,
      `
    CREATE TABLE markers (
      id    text PRIMARY KEY,
      label text NOT NULL
    );

    CREATE UNIQUE INDEX markers_label_uniq ON markers (label);

    CREATE TABLE other_things (
      id text PRIMARY KEY
    );
    `,
    );

    const result = runScript(repo);
    assert.equal(result.status, 0, `expected exit 0\nstderr: ${result.stderr}`);
    assert.ok(
      result.stdout.includes("OK"),
      `stdout should report OK.\nstdout: ${result.stdout}`,
    );
  });

  it("accepts a CONSTRAINT <name> UNIQUE clause inside the table block", () => {
    const repo = makeFakeRepo("constraint-form");
    writeSchema(repo, "markers.ts", MARKERS_SCHEMA);
    writeTestDb(
      repo,
      `
    CREATE TABLE markers (
      id    text PRIMARY KEY,
      label text NOT NULL,
      CONSTRAINT markers_label_uniq UNIQUE (label)
    );
    `,
    );

    const result = runScript(repo);
    assert.equal(result.status, 0, `expected exit 0\nstderr: ${result.stderr}`);
  });

  it("bare (non-UNIQUE) index name in the right block → violation", () => {
    const repo = makeFakeRepo("non-unique");
    writeSchema(repo, "markers.ts", MARKERS_SCHEMA);
    writeTestDb(
      repo,
      `
    CREATE TABLE markers (
      id    text PRIMARY KEY,
      label text NOT NULL
    );

    CREATE INDEX markers_label_uniq ON markers (label);
    `,
    );

    const result = runScript(repo);
    assert.equal(result.status, 1, `expected exit 1\nstderr: ${result.stderr}`);
  });
});

describe("I/O guards", () => {
  it("(d) missing test-db.ts → exit 1 with a path-containing message", () => {
    const repo = makeFakeRepo("missing-testdb");
    writeSchema(repo, "markers.ts", MARKERS_SCHEMA);
    // No test-db.ts written.

    const result = runScript(repo);
    const expectedPath = join(repo, "lib", "db", "src", "__tests__", "test-db.ts");
    assert.equal(result.status, 1, `expected exit 1\nstderr: ${result.stderr}`);
    assert.ok(
      result.stderr.includes(expectedPath),
      `stderr should name the missing test-db.ts path.\nstderr: ${result.stderr}`,
    );
    // Guarded failure, not a raw uncaught ENOENT stack trace.
    assert.ok(
      !result.stderr.includes("Node.js v") && !result.stderr.includes("throw err"),
      `stderr should not contain a raw Node.js stack trace.\nstderr: ${result.stderr}`,
    );
  });

  it("(e) unreadable schema file → warning, scan continues", () => {
    const repo = makeFakeRepo("unreadable-schema");
    writeSchema(repo, "markers.ts", MARKERS_SCHEMA);
    // A directory named like a schema file makes readFileSync throw EISDIR.
    mkdirSync(join(repo, "lib", "db", "src", "schema", "broken.ts"));
    writeTestDb(
      repo,
      `
    CREATE TABLE markers (
      id    text PRIMARY KEY,
      label text NOT NULL
    );

    CREATE UNIQUE INDEX markers_label_uniq ON markers (label);
    `,
    );

    const result = runScript(repo);
    assert.equal(result.status, 0, `expected exit 0\nstderr: ${result.stderr}`);
    assert.ok(
      result.stderr.includes("WARN") && result.stderr.includes("broken.ts"),
      `stderr should warn about the unreadable file.\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stdout.includes("OK"),
      `remaining files should still be scanned.\nstdout: ${result.stdout}`,
    );
  });
});

describe("column parity", () => {
  it("(f) reports missing and extra DDL columns", () => {
    const repo = makeFakeRepo("column-drift");
    writeSchema(repo, "markers.ts", SIMPLE_SCHEMA);
    writeTestDb(
      repo,
      `
    CREATE TABLE markers (
      id text PRIMARY KEY,
      stale_column text
    );
    `,
    );

    const result = runScript(repo);
    assert.equal(result.status, 1, `expected exit 1\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /markers: missing from test-db\.ts: label/);
    assert.match(result.stderr, /markers: extra in test-db\.ts: stale_column/);
  });

  it("(g) accepts matching Drizzle and DDL columns", () => {
    const repo = makeFakeRepo("column-match");
    writeSchema(repo, "markers.ts", SIMPLE_SCHEMA);
    writeTestDb(
      repo,
      `
    CREATE TABLE markers (
      id text PRIMARY KEY,
      label text NOT NULL
    );
    `,
    );

    const result = runScript(repo);
    assert.equal(result.status, 0, `expected exit 0\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /columns and/);
  });

  it("(h) reports mismatched column properties and named checks", () => {
    const repo = makeFakeRepo("property-drift");
    writeSchema(
      repo,
      "children.ts",
      `
      import { pgTable, text, uuid, check } from "drizzle-orm/pg-core";
      import { sql } from "drizzle-orm";
      export const children = pgTable("children", {
        id: uuid("id").primaryKey().defaultRandom(),
        parentId: uuid("parent_id").references(() => parents.id, { onDelete: "cascade" }),
        label: text("label").notNull().default("ready"),
      }, (table) => [
        check("children_label_check", sql\`\${table.label} <> ''\`),
      ]);
      `,
    );
    writeTestDb(
      repo,
      `
      CREATE TABLE parents (id uuid PRIMARY KEY);
      CREATE TABLE children (
        id text PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_id uuid REFERENCES parents(id) ON DELETE SET NULL,
        label text DEFAULT 'wrong'
      );
      `,
    );

    const result = runScript(repo);
    assert.equal(result.status, 1, `expected exit 1\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /children\.id type: schema=uuid, test-db\.ts=text/);
    assert.match(result.stderr, /children\.label nullable: schema=false, test-db\.ts=true/);
    assert.match(result.stderr, /children\.label default: schema=ready, test-db\.ts=wrong/);
    assert.match(result.stderr, /children\.parent_id references: schema=parents\/cascade, test-db\.ts=parents\/set null/);
    assert.match(result.stderr, /children constraint children_label_check: missing from test-db\.ts/);
  });
});

describe("unique-index definition parity", () => {
  it("reports indexed-column drift with table and index names", () => {
    const repo = makeFakeRepo("unique-column-drift");
    writeSchema(repo, "folders.ts", PARTIAL_SCHEMA);
    writeTestDb(repo, `
      CREATE TABLE folders (
        user_id text NOT NULL,
        name text NOT NULL,
        parent_id text
      );
      CREATE UNIQUE INDEX folders_root_uniq ON folders (user_id, name)
        WHERE parent_id IS NULL;
    `);

    const result = runScript(repo);
    assert.equal(result.status, 1, `expected exit 1\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /folders uniqueIndex\("folders_root_uniq"\) columns:/);
    assert.match(result.stderr, /schema=user_id, lower\(name\), test-db\.ts=user_id, name/);
  });

  it("reports partial-index predicate drift with table and index names", () => {
    const repo = makeFakeRepo("unique-where-drift");
    writeSchema(repo, "folders.ts", PARTIAL_SCHEMA);
    writeTestDb(repo, `
      CREATE TABLE folders (
        user_id text NOT NULL,
        name text NOT NULL,
        parent_id text
      );
      CREATE UNIQUE INDEX folders_root_uniq ON folders (user_id, lower(name))
        WHERE parent_id IS NOT NULL;
    `);

    const result = runScript(repo);
    assert.equal(result.status, 1, `expected exit 1\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /folders uniqueIndex\("folders_root_uniq"\) WHERE:/);
    assert.match(result.stderr, /schema=parent_id is null, test-db\.ts=parent_id is not null/);
  });

  it("reports sort, NULL ordering, and collation drift with table and index names", () => {
    const repo = makeFakeRepo("unique-modifier-drift");
    writeSchema(
      repo,
      "folders.ts",
      `
      import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
      export const folders = pgTable("folders", {
        name: text("name").notNull(),
      }, (table) => [
        uniqueIndex("folders_name_uniq").on(
          table.name.desc().nullsLast(),
          sql\`\${table.name} COLLATE "C"\`,
        ),
      ]);
      `,
    );
    writeTestDb(repo, `
      CREATE TABLE folders (name text NOT NULL);
      CREATE UNIQUE INDEX folders_name_uniq ON folders
        (name ASC NULLS FIRST, name COLLATE "POSIX");
    `);

    const result = runScript(repo);
    assert.equal(result.status, 1, `expected exit 1\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /folders uniqueIndex\("folders_name_uniq"\) sort direction for name: schema=desc, test-db\.ts=asc/);
    assert.match(result.stderr, /folders uniqueIndex\("folders_name_uniq"\) NULL ordering for name: schema=last, test-db\.ts=first/);
    assert.match(result.stderr, /folders uniqueIndex\("folders_name_uniq"\) collation for name: schema=c, test-db\.ts=posix/);
  });

  it("accepts matching sort, NULL ordering, and collation modifiers", () => {
    const repo = makeFakeRepo("unique-modifier-match");
    writeSchema(
      repo,
      "folders.ts",
      `
      import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
      export const folders = pgTable("folders", {
        name: text("name").notNull(),
      }, (table) => [
        uniqueIndex("folders_name_uniq").on(table.name.desc().nullsLast()),
      ]);
      `,
    );
    writeTestDb(repo, `
      CREATE TABLE folders (name text NOT NULL);
      CREATE UNIQUE INDEX folders_name_uniq ON folders (name DESC NULLS LAST);
    `);

    const result = runScript(repo);
    assert.equal(result.status, 0, `expected exit 0\nstderr: ${result.stderr}`);
  });
});

describe("helper units", () => {
  it("stripComments removes SQL line, block, and TS line comments", () => {
    const out = stripComments(
      "keep1 -- gone sql\nkeep2 /* gone\nblock */ keep3 // gone ts\nkeep4",
    );
    assert.ok(out.includes("keep1") && out.includes("keep2"));
    assert.ok(out.includes("keep3") && out.includes("keep4"));
    assert.ok(!out.includes("gone"));
  });

  it("extractTableSlices maps each table to its own block", () => {
    const slices = extractTableSlices(
      "create table alpha (id text);\ncreate unique index a_uniq on alpha (id);\n" +
      "create table beta (id text);\ncreate unique index b_uniq on beta (id);",
    );
    assert.deepEqual([...slices.keys()].sort(), ["alpha", "beta"]);
    assert.ok(slices.get("alpha").includes("a_uniq"));
    assert.ok(!slices.get("alpha").includes("b_uniq"));
    assert.ok(slices.get("beta").includes("b_uniq"));
  });

  it("sliceHasUniqueClause requires UNIQUE adjacency", () => {
    assert.ok(sliceHasUniqueClause("create unique index foo_uniq on t (a);", "foo_uniq"));
    assert.ok(sliceHasUniqueClause("constraint foo_uniq unique (a)", "foo_uniq"));
    assert.ok(!sliceHasUniqueClause("create index foo_uniq on t (a);", "foo_uniq"));
    assert.ok(!sliceHasUniqueClause("mentions foo_uniq in passing", "foo_uniq"));
  });

  it("extracts Drizzle and DDL columns without table constraints", () => {
    const drizzle = extractDrizzleTableColumns(SIMPLE_SCHEMA);
    assert.deepEqual([...drizzle.get("markers")].sort(), ["id", "label"]);
    const ddl = extractDdlTableColumns(
      `CREATE TABLE markers (id text, label text, CONSTRAINT markers_pk PRIMARY KEY (id));`,
    );
    assert.deepEqual([...ddl].sort(), ["id", "label"]);
  });

  it("extracts unique-index columns and deterministic predicates", () => {
    const indexes = extractDrizzleUniqueIndexes(`
      uniqueIndex("folders_root").on(t.userId, sql\`lower(\${t.name})\`)
        .where(sql\`\${t.parentId} IS NULL\`)
    `);
    assert.deepEqual(indexes.get("folders_root"), {
      columns: ["user_id", "lower(name)"],
      modifiers: [
        { sort: null, nulls: null, collation: null },
        { sort: null, nulls: null, collation: null },
      ],
      where: "parent_id is null",
    });
  });

  it("reports unique-index column and WHERE definition drift", () => {
    const expected = {
      columns: ["user_id", "lower(name)"],
      where: "parent_id is null",
    };
    const actual = {
      columns: ["user_id", "name"],
      where: "parent_id is not null",
    };
    assert.match(
      compareUniqueIndexDefinitions(expected, actual, "dataset_folders", "folders_root"),
      /dataset_folders uniqueIndex\("folders_root"\) columns: schema=user_id, lower\(name\), test-db\.ts=user_id, name/,
    );
    assert.match(
      compareUniqueIndexDefinitions(expected, actual, "dataset_folders", "folders_root"),
      /WHERE: schema=parent_id is null, test-db\.ts=parent_id is not null/,
    );
  });
});
