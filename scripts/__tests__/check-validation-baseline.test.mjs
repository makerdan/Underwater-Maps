import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runValidationBaselineCheck,
  validateBaselineCatalog,
} from "../check-validation-baseline.mjs";

const root = resolve(fileURLToPath(import.meta.url), "../../..");
const catalogPath = resolve(root, "docs/validation/failure-baseline.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

function cloneCatalog() {
  return structuredClone(catalog);
}

function check(candidate, asOf = "2026-08-30") {
  return validateBaselineCatalog(candidate, { repoRoot: root, asOf });
}

test("the checked-in catalog is valid at its verification date", () => {
  const result = check(catalog);
  assert.deepEqual(result.errors, []);
  assert.equal(result.entryCount, 14);
  assert.equal(result.authoritativeActiveCount, 2);
});

test("the CLI validates the real catalog without changing it", () => {
  const before = readFileSync(catalogPath, "utf8");
  const result = runValidationBaselineCheck({
    catalog: catalogPath,
    repoRoot: root,
    asOf: "2026-08-30",
  });
  assert.deepEqual(result.errors, []);
  assert.equal(readFileSync(catalogPath, "utf8"), before);
});

test("malformed entries report actionable schema errors", () => {
  const candidate = cloneCatalog();
  delete candidate.entries[0].evidence;
  candidate.entries[1].affectedTiers = ["unknown-tier"];
  const result = check(candidate);
  assert.ok(result.errors.some((error) => error.includes("evidence must be an object")));
  assert.ok(result.errors.some((error) => error.includes("unknown tier")));
});

test("duplicate IDs are rejected", () => {
  const candidate = cloneCatalog();
  candidate.entries[1].id = candidate.entries[0].id;
  const result = check(candidate);
  assert.ok(result.errors.some((error) => error.includes("duplicate baseline id")));
});

test("expired active records are rejected using an injected date", () => {
  const candidate = cloneCatalog();
  const active = candidate.entries.find((entry) => entry.status === "active");
  assert.ok(active);
  active.reviewDeadline = "2026-08-29";
  const result = check(candidate, "2026-08-30");
  assert.ok(result.errors.some((error) => error.includes("active reviewDeadline 2026-08-29 has expired")));
});

test("missing repository references are rejected", () => {
  const candidate = cloneCatalog();
  candidate.entries[0].repositoryReferences.push("tests/does-not-exist.test.ts");
  const result = check(candidate);
  assert.ok(result.errors.some((error) => error.includes("missing repository file")));
});

test("resolved records require resolution evidence and remain terminal", () => {
  const candidate = cloneCatalog();
  const resolved = candidate.entries.find((entry) => entry.status === "resolved");
  assert.ok(resolved);
  assert.deepEqual(check(candidate).errors, []);
  resolved.status = "active";
  resolved.statusHistory.push({
    status: "active",
    date: "2026-08-27",
    note: "Invalid attempt to reopen a resolved record.",
  });
  resolved.evidence.authoritative = true;
  const result = check(candidate);
  assert.ok(result.errors.some((error) => error.includes("invalid lifecycle transition: resolved -> active")));
});

test("intermittent records require both sides of the observation", () => {
  const candidate = cloneCatalog();
  const entry = candidate.entries[0];
  entry.status = "intermittent";
  entry.statusHistory = [
    { status: "active", date: "2026-08-17", note: "Initial failure." },
    { status: "intermittent", date: "2026-08-26", note: "A retry passed." },
  ];
  entry.evidence.authoritative = false;
  entry.evidence.observations = entry.evidence.observations.map((observation) => ({
    ...observation,
    outcome: "fail",
  }));
  const result = check(candidate);
  assert.ok(result.errors.some((error) => error.includes("both pass and fail observations")));
});

test("catalog defects never become a test suppression mechanism", () => {
  const candidate = cloneCatalog();
  candidate.testResults = { failed: ["unrelated-test"] };
  const result = check(candidate);
  assert.ok(result.errors.some((error) => error.includes("unknown field(s): testResults")));
  assert.equal(result.skippedTests, undefined);
  assert.equal(result.filteredTests, undefined);
});