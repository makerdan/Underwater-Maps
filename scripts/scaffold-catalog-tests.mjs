#!/usr/bin/env node
/**
 * scaffold-catalog-tests.mjs
 *
 * Reads every id in EXTRA_CATALOG_ENTRIES from catalogSeeder.ts and compares
 * it against the test coverage already present in catalog-search.test.ts.
 * For every id not yet referenced in the test file it prints a ready-to-paste
 * stub it() block to stdout.
 *
 * Usage:
 *   node scripts/scaffold-catalog-tests.mjs           # print stubs for uncovered ids
 *   node scripts/scaffold-catalog-tests.mjs --check   # exit 1 if any ids are uncovered (CI gate)
 *
 * How to use the stubs:
 *   1. Run without --check — copy the printed stubs.
 *   2. Paste them into the "searchCatalog — additional entry coverage" describe
 *      block inside catalog-search.test.ts.
 *   3. Replace the <QUERY> placeholder with a keyword that actually matches the
 *      entry's `keywords` field (verified with: pnpm run test:unit).
 *   4. Add the catalog entry to catalogSeeder.ts (or confirm it is already there).
 *   5. Re-run: node scripts/scaffold-catalog-tests.mjs --check   (should exit 0).
 *
 * Pre-commit hook (optional):
 *   Add this line to .husky/pre-commit (or your equivalent hook script):
 *     node scripts/scaffold-catalog-tests.mjs --check
 *   This blocks a commit if any EXTRA_CATALOG_ENTRIES id is missing a test.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const CHECK_MODE = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const SEEDER_PATH = resolve(
  ROOT,
  'artifacts/api-server/src/lib/catalogSeeder.ts',
);
const TEST_PATH = resolve(
  ROOT,
  'artifacts/api-server/src/__tests__/catalog-search.test.ts',
);

// ---------------------------------------------------------------------------
// 1. Parse id+name pairs from catalogSeeder.ts
//
// The seeder uses consistent object-literal formatting:
//   {
//     id: "some-id",
//     name: "Some Human Name",
//     ...
//   }
//
// We scan for every `id: "..."` occurrence and then look for the `name: "..."`
// field within the next few lines of the same object literal.
// ---------------------------------------------------------------------------

function parseSeedEntries(src) {
  const entries = [];

  // Match `id: "..."` lines (with optional leading whitespace)
  const idRe = /^\s*id:\s*"([^"]+)"/gm;
  let idMatch;

  while ((idMatch = idRe.exec(src)) !== null) {
    const id = idMatch[1];
    const afterId = src.slice(idMatch.index + idMatch[0].length);

    // Look for `name: "..."` within the next ~300 characters (same object)
    const nameMatch = afterId.match(/^\s*,?\s*\n\s*name:\s*"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : id;

    entries.push({ id, name });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// 2. Derive a human-readable query hint from the entry name.
//
// Rules (in order):
//   a) If the name contains "—", use the segment after the last "—" and
//      strip any trailing " (Geographic Qualifier)" parenthetical.
//   b) Otherwise use the first three words of the name.
//
// The result is a *hint* only — the developer must verify it actually matches
// the entry's keywords field before committing.
// ---------------------------------------------------------------------------

function deriveQueryHint(name) {
  let segment = name;

  const dashIdx = name.lastIndexOf('—');
  if (dashIdx !== -1) {
    segment = name.slice(dashIdx + 1).trim();
  }

  // Strip trailing parenthetical geographic qualifier, e.g. "(Gulf of Alaska)"
  segment = segment.replace(/\s*\([^)]+\)\s*$/, '').trim();

  // If we ended up with something too short, fall back to the full name's first 3 words
  if (segment.length < 3) {
    segment = name.split(/\s+/).slice(0, 3).join(' ');
  }

  return segment;
}

// ---------------------------------------------------------------------------
// 3. Build a stub it() block for one entry
// ---------------------------------------------------------------------------

function buildStub(id, name) {
  const hint = deriveQueryHint(name);
  const descHint = hint.toLowerCase();

  return [
    `  it("returns ${id} for '${descHint}' query", async () => {`,
    `    // TODO: replace <QUERY> with a term present in this entry's keywords field`,
    `    // Entry name: ${name}`,
    `    const results = await searchCatalog({ q: "${hint}" }, EXTRA_CATALOG_ENTRIES);`,
    `    const ids = results.map((r) => r.id);`,
    `    expect(ids).toContain("${id}");`,
    `  });`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 4. Main
// ---------------------------------------------------------------------------

const seederSrc = readFileSync(SEEDER_PATH, 'utf8');
const testSrc = readFileSync(TEST_PATH, 'utf8');

const allEntries = parseSeedEntries(seederSrc);

if (allEntries.length === 0) {
  console.error(
    'ERROR: No catalog entries found in catalogSeeder.ts — ' +
      'check that EXTRA_CATALOG_ENTRIES is still exported from that file.',
  );
  process.exit(1);
}

const uncovered = allEntries.filter(({ id }) => !testSrc.includes(id));

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (uncovered.length === 0) {
  console.log(
    `All ${allEntries.length} EXTRA_CATALOG_ENTRIES ids have coverage in catalog-search.test.ts.`,
  );
  process.exit(0);
}

if (CHECK_MODE) {
  console.error(
    `ERROR: ${uncovered.length} of ${allEntries.length} catalog ids have no test coverage:\n` +
      uncovered.map(({ id }) => `  - ${id}`).join('\n') +
      '\n\n' +
      'Run without --check to generate stub tests, then add them to\n' +
      'the "searchCatalog — additional entry coverage" describe block in\n' +
      'artifacts/api-server/src/__tests__/catalog-search.test.ts.',
  );
  process.exit(1);
}

// Default mode — print stubs to stdout
console.log(
  `Found ${uncovered.length} uncovered id(s). ` +
    `Paste the stub(s) below into the "searchCatalog — additional entry coverage"\n` +
    `describe block in artifacts/api-server/src/__tests__/catalog-search.test.ts.\n` +
    `Replace the generated query with a term from the entry's keywords field and\n` +
    `verify with: pnpm run test:unit\n`,
);

const stubs = uncovered.map(({ id, name }) => buildStub(id, name));
console.log(stubs.join('\n\n'));
