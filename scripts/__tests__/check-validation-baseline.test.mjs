import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findBaselineMaintenanceFindings,
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

test("maintenance report returns no findings when active records are outside both windows", () => {
  const candidate = cloneCatalog();
  const result = findBaselineMaintenanceFindings(candidate, {
    asOf: "2026-08-30",
    withinDays: 0,
    staleAfterDays: 100,
  });
  assert.deepEqual(result.actionable, []);
  assert.equal(result.informationalInactive.length, 12);
});

test("maintenance report includes the inclusive deadline boundary", () => {
  const candidate = cloneCatalog();
  const result = findBaselineMaintenanceFindings(candidate, {
    asOf: "2026-08-30",
    withinDays: 16,
    staleAfterDays: 0,
  });
  const finding = result.actionable.find((entry) => entry.id === "BASE-OVERVIEW-ZOOM-GEO");
  assert.ok(finding);
  assert.ok(finding.reasons.includes("review-deadline"));
  assert.equal(finding.daysUntilDeadline, 16);
});

test("maintenance report identifies expired deadlines and stale reviews", () => {
  const candidate = cloneCatalog();
  const active = candidate.entries.find((entry) => entry.id === "BASE-OVERVIEW-ZOOM-GEO");
  assert.ok(active);
  active.reviewDeadline = "2026-08-29";
  active.lastVerifiedDate = "2026-07-01";
  const report = findBaselineMaintenanceFindings(candidate, {
    asOf: "2026-08-30",
    withinDays: 0,
    staleAfterDays: 30,
  });
  const finding = report.actionable.find((entry) => entry.id === active.id);
  assert.ok(finding);
  assert.deepEqual(finding.reasons, ["review-deadline", "stale-review"]);
  assert.equal(finding.daysUntilDeadline, -1);
});

test("maintenance validation can report expired active records while strict validation rejects them", () => {
  const candidate = cloneCatalog();
  const active = candidate.entries.find((entry) => entry.status === "active");
  assert.ok(active);
  active.reviewDeadline = "2026-08-29";

  const strict = check(candidate, "2026-08-30");
  assert.ok(strict.errors.some((error) => error.includes("reviewDeadline 2026-08-29 has expired")));
  const maintenance = validateBaselineCatalog(candidate, {
    repoRoot: root,
    asOf: "2026-08-30",
    allowExpiredActive: true,
  });
  assert.deepEqual(maintenance.errors, []);
});

test("maintenance report treats inactive records as informational", () => {
  const candidate = cloneCatalog();
  const result = findBaselineMaintenanceFindings(candidate, {
    asOf: "2026-08-30",
    withinDays: 365,
    staleAfterDays: 0,
  });
  assert.equal(result.actionable.length, 2);
  assert.equal(result.informationalInactive.length, 12);
  assert.ok(result.informationalInactive.some((entry) => entry.status === "resolved"));
  assert.ok(result.informationalInactive.some((entry) => entry.status === "needs-review"));
});

test("maintenance CLI exits cleanly with no findings and nonzero for findings or invalid options", () => {
  const tempDir = mkdtempSync(resolve(tmpdir(), "baseline-maintenance-"));
  const tempCatalog = resolve(tempDir, "failure-baseline.json");
  const script = resolve(root, "scripts/check-validation-baseline.mjs");
  try {
    writeFileSync(tempCatalog, JSON.stringify(cloneCatalog()));
    const clean = spawnSync(
      process.execPath,
      [
        script,
        "--maintenance",
        "--catalog",
        tempCatalog,
        "--repo-root",
        root,
        "--as-of",
        "2026-08-30",
        "--within-days",
        "0",
        "--stale-after-days",
        "100",
      ],
      { encoding: "utf8" },
    );
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /MAINTENANCE OK/);
    assert.match(clean.stdout, /BASE-E2E-PUZZLE-POLL: status resolved/);

    const actionableCatalog = cloneCatalog();
    const active = actionableCatalog.entries.find((entry) => entry.status === "active");
    assert.ok(active);
    active.reviewDeadline = "2026-08-29";
    writeFileSync(tempCatalog, JSON.stringify(actionableCatalog));
    const actionable = spawnSync(
      process.execPath,
      [
        script,
        "--maintenance",
        "--catalog",
        tempCatalog,
        "--repo-root",
        root,
        "--as-of",
        "2026-08-30",
        "--within-days",
        "0",
        "--stale-after-days",
        "100",
      ],
      { encoding: "utf8" },
    );
    assert.equal(actionable.status, 1);
    assert.match(actionable.stderr, /MAINTENANCE ACTION NEEDED/);
    assert.match(actionable.stdout, /inactive record\(s\) not counted as actionable/);

    const invalid = spawnSync(process.execPath, [script, "--maintenance", "--within-days", "-1"], {
      encoding: "utf8",
    });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /--within-days must be a non-negative integer/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});