import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractRunTierSteps,
  extractTestAllSteps,
  compareStepLists,
  findUncoveredChecks,
  findStaleAllowlistEntries,
  CI_COVERAGE_ALLOWLIST,
} from "../check-runner-step-sync.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// Fixtures — deliberately minimal runner sources
// ---------------------------------------------------------------------------

const runTierFixture = `
const ALL_STEPS = [
  { name: "typecheck", resource: "codegen", cmd: runTypecheckStep },
  { name: "lint", resource: null, cmd: "pnpm run lint" },
  { name: "check:foo", resource: null, cmd: "pnpm run check:foo" },
];
`;

const testAllFixtureInSync = `
const steps = [
  ["typecheck", runTypecheckStep],
  ["lint", "pnpm run lint"],
  ["check:foo", "pnpm run check:foo"],
];
`;

const testAllFixtureDiverged = `
const steps = [
  ["typecheck", runTypecheckStep],
  ["check:foo", "pnpm run check:foo"],
];
`;

// ---------------------------------------------------------------------------
// Step-list parsing and sync
// ---------------------------------------------------------------------------

test("extracts ordered step names from both runner formats", () => {
  assert.deepEqual(extractRunTierSteps(runTierFixture), ["typecheck", "lint", "check:foo"]);
  assert.deepEqual(extractTestAllSteps(testAllFixtureInSync), ["typecheck", "lint", "check:foo"]);
});

test("in-sync step lists produce no divergences", () => {
  const problems = compareStepLists(
    extractRunTierSteps(runTierFixture),
    extractTestAllSteps(testAllFixtureInSync),
  );
  assert.deepEqual(problems, []);
});

test("deliberately diverged step lists are detected", () => {
  const problems = compareStepLists(
    extractRunTierSteps(runTierFixture),
    extractTestAllSteps(testAllFixtureDiverged),
  );
  assert.ok(problems.length > 0, "expected at least one divergence");
  assert.match(problems[0], /position 1/);
  assert.match(problems[0], /"lint"/);
});

test("parser throws loudly if the array markers vanish (guards against parse typos passing quietly)", () => {
  assert.throws(() => extractRunTierSteps("const OTHER = [];"), /could not find/);
  assert.throws(() => extractTestAllSteps("const other = [];"), /could not find/);
  assert.throws(() => extractRunTierSteps("const ALL_STEPS = [\n];"), /zero step names/);
});

// ---------------------------------------------------------------------------
// CI coverage meta-check
// ---------------------------------------------------------------------------

test("check:* script missing from both CI sequence and allowlist is flagged", () => {
  const pkg = { scripts: { "check:foo": "x", "check:orphan": "y", lint: "z" } };
  const uncovered = findUncoveredChecks(pkg, ["typecheck", "lint", "check:foo"], {});
  assert.deepEqual(uncovered, ["check:orphan"]);
});

test("allowlisted check:* script is not flagged", () => {
  const pkg = { scripts: { "check:orphan": "y" } };
  const uncovered = findUncoveredChecks(pkg, [], { "check:orphan": "covered elsewhere" });
  assert.deepEqual(uncovered, []);
});

test("stale allowlist entries are flagged (removed script or now in CI)", () => {
  const pkg = { scripts: { "check:foo": "x" } };
  const stale = findStaleAllowlistEntries(pkg, ["check:foo"], {
    "check:foo": "now redundant — runs in CI",
    "check:gone": "script no longer exists",
  });
  assert.deepEqual(stale.sort(), ["check:foo", "check:gone"]);
});

// ---------------------------------------------------------------------------
// Real-tree assertions — the actual repo files must currently pass
// ---------------------------------------------------------------------------

test("actual runner files are currently in sync and all check:* scripts covered", () => {
  const runTierSource = readFileSync(resolve(root, "scripts/run-tier.mjs"), "utf8");
  const testAllSource = readFileSync(resolve(root, "scripts/test-all-steps.mjs"), "utf8");
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

  const a = extractRunTierSteps(runTierSource);
  const b = extractTestAllSteps(testAllSource);
  assert.deepEqual(compareStepLists(a, b), []);
  assert.deepEqual(findUncoveredChecks(pkg, a), []);
  assert.deepEqual(findStaleAllowlistEntries(pkg, a), []);
  assert.ok(Object.values(CI_COVERAGE_ALLOWLIST).every((r) => typeof r === "string" && r.length > 10));
});
