import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findUncoveredChecks,
  findStaleAllowlistEntries,
  CI_COVERAGE_ALLOWLIST,
} from "../check-runner-step-sync.mjs";
import { getValidationSteps } from "../validation-steps.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// Shared step-list module — both runners consume the same list, so the old
// parser-based sync check is gone; assert the shared module's shape instead.
// ---------------------------------------------------------------------------

test("shared step list has valid entries and no duplicate names", () => {
  const steps = getValidationSteps("test");
  assert.ok(steps.length > 0, "expected at least one step");
  for (const s of steps) {
    assert.equal(typeof s.name, "string");
    assert.ok(s.name.length > 0);
    assert.ok(
      typeof s.cmd === "string" || typeof s.cmd === "function",
      `step ${s.name}: cmd must be a string or function`,
    );
    assert.ok(
      s.resource === null || typeof s.resource === "string",
      `step ${s.name}: resource must be null or a string`,
    );
  }
  const names = steps.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, "duplicate step names in shared list");
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

test("all check:* scripts in package.json are covered by the shared step list or allowlist", () => {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const ciSteps = getValidationSteps("test").map((s) => s.name);

  assert.deepEqual(findUncoveredChecks(pkg, ciSteps), []);
  assert.deepEqual(findStaleAllowlistEntries(pkg, ciSteps), []);
  assert.ok(Object.values(CI_COVERAGE_ALLOWLIST).every((r) => typeof r === "string" && r.length > 10));
});
