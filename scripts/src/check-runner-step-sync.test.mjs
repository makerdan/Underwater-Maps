import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findUncoveredChecks,
  findStaleAllowlistEntries,
  findOrphanCheckFiles,
  findStaleOrphanAllowlistEntries,
  listCheckFiles,
  buildReferenceText,
  CI_COVERAGE_ALLOWLIST,
  ORPHAN_FILE_ALLOWLIST,
} from "../check-runner-step-sync.mjs";
import { getValidationSteps, getStepsForTier, KNOWN_TIERS } from "../validation-steps.mjs";

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
// Tier-tag selection — every step must declare explicit tier membership
// ---------------------------------------------------------------------------

test("every step declares a non-empty, known tiers array", () => {
  const steps = getValidationSteps("test");
  for (const s of steps) {
    assert.ok(Array.isArray(s.tiers) && s.tiers.length > 0, `step ${s.name}: missing tiers`);
    for (const t of s.tiers) {
      assert.ok(KNOWN_TIERS.includes(t), `step ${s.name}: unknown tier ${t}`);
    }
  }
});

test("getStepsForTier throws on a step with no tier assignment", () => {
  const steps = [{ name: "ok", tiers: ["fast"] }, { name: "untagged" }];
  assert.throws(() => getStepsForTier(steps, "fast"), /untagged.*no tier assignment/s);
});

test("getStepsForTier throws on empty tiers array and unknown tier tag", () => {
  assert.throws(
    () => getStepsForTier([{ name: "empty", tiers: [] }], "fast"),
    /no tier assignment/,
  );
  assert.throws(
    () => getStepsForTier([{ name: "bad", tiers: ["turbo"] }], "fast"),
    /unknown tier tag/,
  );
  assert.throws(() => getStepsForTier([], "nope"), /unknown tier/);
});

test("getStepsForTier selects by tag preserving list order", () => {
  const steps = [
    { name: "a", tiers: ["fast", "standard", "full"] },
    { name: "b", tiers: ["standard", "full"] },
    { name: "c", tiers: ["full"] },
  ];
  assert.deepEqual(getStepsForTier(steps, "fast").map((s) => s.name), ["a"]);
  assert.deepEqual(getStepsForTier(steps, "standard").map((s) => s.name), ["a", "b"]);
  assert.deepEqual(getStepsForTier(steps, "full").map((s) => s.name), ["a", "b", "c"]);
});

test("tier structure obeys the fast⊂standard⊂full cumulative convention", () => {
  const steps = getValidationSteps("test");

  const fastNames = new Set(getStepsForTier(steps, "fast").map((s) => s.name));
  const standardNames = new Set(getStepsForTier(steps, "standard").map((s) => s.name));
  const fullNames = new Set(getStepsForTier(steps, "full").map((s) => s.name));

  // full tier must contain every step — no step may be invisible at the highest tier
  assert.deepEqual(
    getStepsForTier(steps, "full").map((s) => s.name),
    steps.map((s) => s.name),
    "full tier must contain every step",
  );

  // fast ⊆ standard: any step tagged "fast" must also be tagged "standard"
  for (const name of fastNames) {
    assert.ok(
      standardNames.has(name),
      `step "${name}" is in fast tier but not standard tier — ` +
        `fast-tier steps must also be tagged "standard" (and "full")`,
    );
  }

  // standard ⊆ full: any step tagged "standard" must also be tagged "full"
  for (const name of standardNames) {
    assert.ok(
      fullNames.has(name),
      `step "${name}" is in standard tier but not full tier — ` +
        `standard-tier steps must also be tagged "full"`,
    );
  }
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
// Orphaned check-file audit
// ---------------------------------------------------------------------------

test("a check file referenced nowhere is flagged as an orphan", () => {
  const files = ["check-used.sh", "check-orphan.sh"];
  const refText = 'scripts": "bash scripts/check-used.sh"';
  assert.deepEqual(findOrphanCheckFiles(files, refText, {}), ["check-orphan.sh"]);
});

test("an allowlisted orphan check file is not flagged", () => {
  const orphans = findOrphanCheckFiles(["check-manual.mjs"], "", {
    "check-manual.mjs": "manual-only tooling",
  });
  assert.deepEqual(orphans, []);
});

test("stale orphan allowlist entries are flagged (deleted file or now referenced)", () => {
  const stale = findStaleOrphanAllowlistEntries(
    ["check-now-used.sh"],
    "node scripts/check-now-used.sh",
    { "check-now-used.sh": "was manual", "check-deleted.mjs": "gone" },
  );
  assert.deepEqual(stale.sort(), ["check-deleted.mjs", "check-now-used.sh"]);
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

test("all check-* files on disk are referenced somewhere or allowlisted", () => {
  const scriptsDir = resolve(root, "scripts");
  const checkFiles = listCheckFiles(scriptsDir);
  assert.ok(checkFiles.length > 0, "expected check-* files in scripts/");
  const refText = buildReferenceText(root, scriptsDir);

  assert.deepEqual(findOrphanCheckFiles(checkFiles, refText), []);
  assert.deepEqual(findStaleOrphanAllowlistEntries(checkFiles, refText), []);
  assert.ok(Object.values(ORPHAN_FILE_ALLOWLIST).every((r) => typeof r === "string" && r.length > 10));
});
