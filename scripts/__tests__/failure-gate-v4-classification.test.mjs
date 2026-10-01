import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyFailure, FAILURE_CLASSIFICATION,
} from "../failure-gate-v4/classification.mjs";

const observed = Object.freeze({
  suite: "Unit suite",
  test: "sample.test.mjs — exact assertion",
  failureSignature: "Expected 3 but received 4 at assertion A",
  environment: { node: "22.4.1", database: "fixture-v2" },
});

function baseline(overrides = {}) {
  return {
    id: "BASE-1",
    ...observed,
    evidence: { authoritative: true },
    reviewDeadline: "2026-10-31",
    status: "active",
    ...overrides,
  };
}

function retries(outcomes = ["fail", "fail", "fail"]) {
  return outcomes.map((outcome, index) => ({
    retryId: `retry-${index + 1}`,
    recordReference: `stored-retry:${index + 1}`,
    authorized: true,
    safeIsolation: true,
    trustworthyResult: true,
    trustworthyDiscovery: true,
    discovered: true,
    outcome,
    ...observed,
  }));
}

function preTaskEvidence(overrides = {}) {
  return {
    sourceId: "snapshot-run-1",
    recordReference: "stored-run:snapshot-1",
    verified: true,
    trustworthyResult: true,
    trustworthyDiscovery: true,
    discovered: true,
    outcome: "fail",
    ...observed,
    ...overrides,
  };
}

function corroboration(overrides = {}) {
  return {
    sourceId: "independent-run-2",
    recordReference: "stored-run:independent-2",
    verified: true,
    trustworthyResult: true,
    trustworthyDiscovery: true,
    discovered: true,
    outcome: "fail",
    ...observed,
    ...overrides,
  };
}

test("declared exact baseline is ignored only when authoritative, active, and unexpired", () => {
  const good = classifyFailure({
    observed,
    catalogEntries: [baseline()],
    ignoredBaselineIds: ["BASE-1"],
    now: "2026-10-31",
  });
  assert.equal(good.outcome, FAILURE_CLASSIFICATION.IGNORED);
  assert.equal(good.accepted, true);

  for (const entry of [
    baseline({ evidence: { authoritative: false } }),
    baseline({ status: "resolved" }),
    baseline({ reviewDeadline: "2026-10-30" }),
  ]) {
    const result = classifyFailure({
      observed, catalogEntries: [entry], ignoredBaselineIds: ["BASE-1"], now: "2026-10-31",
    });
    assert.equal(result.outcome, FAILURE_CLASSIFICATION.BLOCKED);
    assert.equal(result.accepted, false);
  }
});

test("baseline matching preserves exact suite, test, signature, and environment distinctions", () => {
  const variations = [
    { ...observed, test: "sample.test.mjs — other assertion" },
    { ...observed, failureSignature: "Expected 3 but received 5 at assertion A" },
    { ...observed, environment: { node: "22.4.1", database: "fixture-v3" } },
    { ...observed, suite: "Other suite" },
  ];
  for (const changed of variations) {
    const result = classifyFailure({
      observed: changed,
      catalogEntries: [baseline()],
      ignoredBaselineIds: ["BASE-1"],
      now: "2026-10-01",
    });
    assert.equal(result.outcome, FAILURE_CLASSIFICATION.BLOCKED);
  }
  assert.equal(classifyFailure({
    observed, catalogEntries: [baseline()], ignoredBaselineIds: ["BASE-1"], now: "2026-10-01",
  }).outcome, FAILURE_CLASSIFICATION.IGNORED);
});

test("actual catalog-shaped records require an explicit exact applicable variant", () => {
  const actualShape = {
    id: "BASE-CATALOG-SHAPE",
    suite: observed.suite,
    test: observed.test,
    failureSignature: observed.failureSignature,
    classification: "test",
    evidence: { authoritative: true },
    ownership: { owner: "test maintenance", rationale: "Repair the test contract." },
    firstVerifiedDate: "2026-09-01",
    lastVerifiedDate: "2026-09-01",
    affectedTiers: ["standard"],
    reviewDeadline: "2026-10-31",
    status: "active",
    statusHistory: [{ status: "active", date: "2026-09-01", note: "Verified." }],
    repositoryReferences: ["tests/sample.test.mjs"],
    resolution: null,
    applicableVariants: ["node22-linux"],
  };
  const variantObserved = {
    ...observed,
    environment: { variant: "node22-linux" },
  };
  const classifyActualShape = (entry, identity = variantObserved) => classifyFailure({
    observed: identity,
    catalogEntries: [entry],
    ignoredBaselineIds: ["BASE-CATALOG-SHAPE"],
    now: "2026-10-01",
  });

  assert.equal(classifyActualShape(actualShape).outcome, FAILURE_CLASSIFICATION.IGNORED);
  assert.equal(classifyActualShape({
    ...actualShape, applicableVariants: ["node20-linux"],
  }).outcome, FAILURE_CLASSIFICATION.BLOCKED);
  assert.equal(classifyActualShape({
    ...actualShape, applicableVariants: undefined,
  }).outcome, FAILURE_CLASSIFICATION.BLOCKED);
  assert.equal(classifyActualShape({
    ...actualShape, applicableVariants: [],
  }).outcome, FAILURE_CLASSIFICATION.BLOCKED);
  assert.equal(classifyActualShape(actualShape, {
    ...variantObserved,
    environment: {},
  }).outcome, FAILURE_CLASSIFICATION.BLOCKED);
});

test("catalog records without applicableVariants match only an exact affected tier", () => {
  const actualShape = {
    id: "BASE-RAW-PNPM-AUDIT",
    suite: "Dependency audit",
    test: "pnpm audit --audit-level=moderate",
    failureSignature: "Raw dependency audit reports six test-only vulnerabilities through jsdom and postcss even though the registered check:audit exception is green.",
    classification: "dependency",
    evidence: { authoritative: true },
    ownership: { owner: "Dependency maintenance", rationale: "Revisit compatible releases." },
    firstVerifiedDate: "2026-08-17",
    lastVerifiedDate: "2026-08-17",
    affectedTiers: ["standalone"],
    reviewDeadline: "2026-10-17",
    status: "active",
    statusHistory: [{ status: "active", date: "2026-08-17", note: "Verified." }],
    repositoryReferences: ["pnpm-lock.yaml", "scripts/check-audit.mjs"],
    resolution: null,
  };
  const auditFailure = {
    suite: actualShape.suite,
    test: actualShape.test,
    failureSignature: actualShape.failureSignature,
    environment: { tier: "standalone" },
  };
  const classifyForTier = (tier) => classifyFailure({
    observed: { ...auditFailure, environment: { tier } },
    catalogEntries: [actualShape],
    ignoredBaselineIds: [actualShape.id],
    now: "2026-10-01",
  });

  assert.equal(classifyForTier("standalone").outcome, FAILURE_CLASSIFICATION.IGNORED);
  assert.equal(classifyForTier("heavy").outcome, FAILURE_CLASSIFICATION.BLOCKED);
  assert.equal(classifyFailure({
    observed: { ...auditFailure, environment: {} },
    catalogEntries: [actualShape],
    ignoredBaselineIds: [actualShape.id],
    now: "2026-10-01",
  }).outcome, FAILURE_CLASSIFICATION.BLOCKED);
});

test("owned repair obligation survives expiry and is cleared only by verified discovered pass proof", () => {
  const entry = baseline({
    status: "resolved",
    reviewDeadline: "2025-01-01",
    evidence: { authoritative: false },
  });
  const result = classifyFailure({
    observed,
    catalogEntries: [entry],
    ownedBaselineIds: ["BASE-1"],
    now: "2026-10-01",
  });
  assert.equal(result.outcome, FAILURE_CLASSIFICATION.OWNED_REQUIRED);
  assert.equal(result.accepted, false);
  assert.match(result.reason, /expiry/);

  const proof = {
    recordReference: "stored-run:repair-proof",
    verified: true,
    trustworthyResult: true,
    trustworthyDiscovery: true,
    discovered: true,
    outcome: "pass",
    ...observed,
  };
  const repaired = classifyFailure({
    observed,
    catalogEntries: [entry],
    ownedBaselineIds: ["BASE-1"],
    repairProof: proof,
    now: "2026-10-01",
  });
  assert.equal(repaired.outcome, FAILURE_CLASSIFICATION.OWNED_PROVEN);
  assert.equal(repaired.accepted, true);

  for (const invalidProof of [
    { ...proof, recordReference: undefined },
    { ...proof, trustworthyDiscovery: false },
    { ...proof, discovered: false },
    { ...proof, outcome: "skip" },
    { ...proof, test: "different test" },
  ]) {
    assert.equal(classifyFailure({
      observed, catalogEntries: [entry], ownedBaselineIds: ["BASE-1"],
      repairProof: invalidProof, now: "2026-10-01",
    }).outcome, FAILURE_CLASSIFICATION.OWNED_REQUIRED);
  }
});

test("unlisted failures require three distinct authorized safe trustworthy retries and provenance", () => {
  const args = {
    observed,
    catalogEntries: [],
    now: "2026-10-01",
    retries: retries(),
    preTaskEvidence: preTaskEvidence(),
    corroboration: corroboration(),
  };
  const result = classifyFailure(args);
  assert.equal(result.outcome, FAILURE_CLASSIFICATION.PREEXISTING);
  assert.equal(result.accepted, true);
  assert.equal(result.baselineId, null);
  assert.equal(result.intermittent, false);

  for (const invalidRetries of [
    retries().slice(0, 2),
    [...retries(), { ...retries()[0], retryId: "retry-4" }],
    retries().map((retry, index) => ({ ...retry, retryId: index === 2 ? "retry-2" : retry.retryId })),
    retries().map((retry, index) => index === 1 ? { ...retry, authorized: false } : retry),
    retries().map((retry, index) => index === 1 ? { ...retry, safeIsolation: false } : retry),
    retries().map((retry, index) => index === 1 ? { ...retry, trustworthyResult: false } : retry),
    retries().map((retry, index) => index === 1 ? { ...retry, trustworthyDiscovery: false } : retry),
    retries().map((retry, index) => index === 1 ? { ...retry, discovered: false } : retry),
    retries().map((retry, index) => index === 1 ? { ...retry, environment: { node: "other" } } : retry),
  ]) {
    assert.equal(classifyFailure({ ...args, retries: invalidRetries }).outcome, FAILURE_CLASSIFICATION.BLOCKED);
  }

  assert.equal(classifyFailure({
    ...args,
    preTaskEvidence: preTaskEvidence({ verified: false }),
  }).outcome, FAILURE_CLASSIFICATION.BLOCKED);
  assert.equal(classifyFailure({
    ...args,
    preTaskEvidence: preTaskEvidence({ recordReference: undefined }),
  }).outcome, FAILURE_CLASSIFICATION.BLOCKED);
  assert.equal(classifyFailure({
    ...args,
    retries: retries().map((retry) => ({ ...retry, recordReference: undefined })),
  }).outcome, FAILURE_CLASSIFICATION.BLOCKED);
  assert.equal(classifyFailure({
    ...args,
    corroboration: corroboration({ sourceId: "snapshot-run-1" }),
  }).outcome, FAILURE_CLASSIFICATION.BLOCKED);
});

test("passing isolation retries report intermittency only and do not stand in for pre-task provenance", () => {
  const intermittentRetries = retries(["pass", "pass", "fail"]);
  const args = {
    observed,
    catalogEntries: [],
    now: "2026-10-01",
    retries: intermittentRetries,
    preTaskEvidence: preTaskEvidence(),
    corroboration: corroboration(),
  };
  const result = classifyFailure(args);
  assert.equal(result.outcome, FAILURE_CLASSIFICATION.PREEXISTING);
  assert.equal(result.intermittent, true);
  assert.match(result.reason, /passing retries establish intermittency only/);

  const noPreTaskProof = classifyFailure({
    ...args,
    preTaskEvidence: undefined,
    corroboration: undefined,
  });
  assert.equal(noPreTaskProof.outcome, FAILURE_CLASSIFICATION.BLOCKED);
  assert.equal(noPreTaskProof.intermittent, true);
});

test("unknown, ambiguous, malformed, or conflicting declarations fail closed without catalog promotion", () => {
  assert.equal(classifyFailure({
    observed, catalogEntries: [], ignoredBaselineIds: ["MISSING"], now: "2026-10-01",
  }).outcome, FAILURE_CLASSIFICATION.BLOCKED);
  assert.equal(classifyFailure({
    observed, catalogEntries: [baseline(), { ...baseline(), id: "BASE-2" }],
    ignoredBaselineIds: ["BASE-1", "BASE-2"], now: "2026-10-01",
  }).outcome, FAILURE_CLASSIFICATION.BLOCKED);
  assert.equal(classifyFailure({
    observed, catalogEntries: [baseline()], ignoredBaselineIds: ["BASE-1"],
    ownedBaselineIds: ["BASE-1"], now: "2026-10-01",
  }).outcome, FAILURE_CLASSIFICATION.BLOCKED);
  assert.equal(classifyFailure({
    observed, catalogEntries: [], now: "2026-10-01", retries: retries(),
  }).outcome, FAILURE_CLASSIFICATION.BLOCKED);
  assert.equal(classifyFailure({
    observed, catalogEntries: [], now: "2026-10-01",
    retries: retries(), preTaskEvidence: preTaskEvidence(),
    corroboration: corroboration(),
  }).baselineId, null);
});