import test from "node:test";
import assert from "node:assert/strict";
import {
  checkedEnvironmentIdentity, withAcceptedTaskSource, withRunEnvironment,
} from "../failure-gate-v4/run-context.mjs";
import { canonicalJson, digestJson } from "../failure-gate-v4/canonical.mjs";

function snapshot() {
  const environment = { runtime: { nodeMajor: 24 } };
  return {
    manifest: { integrity: "unknown" }, manifestDigest: digestJson({ fixture: true }),
    environmentContent: canonicalJson(environment),
    environmentDigest: digestJson(environment),
  };
}

test("safe run context is deterministic without promoting input integrity", () => {
  const before = snapshot();
  const first = withRunEnvironment(before);
  const last = withRunEnvironment(snapshot());
  assert.equal(first.environmentDigest, last.environmentDigest);
  assert.equal(first.manifestDigest, before.manifestDigest);
  assert.equal(first.manifest.integrity, "unknown");
  assert.equal(first.environmentDigest, digestJson(JSON.parse(first.environmentContent)));
});

test("relevant environment drift changes final applicability", () => {
  const key = "E2E_FAILURE_GATE_CONTEXT_FLAG";
  const original = process.env[key];
  try {
    process.env[key] = "first";
    const first = withRunEnvironment(snapshot());
    process.env[key] = "second";
    assert.notEqual(first.environmentDigest, withRunEnvironment(snapshot()).environmentDigest);
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

test("credential-shaped configuration retains presence, never a value or value hash", () => {
  const key = "E2E_FAILURE_GATE_CONTEXT_CREDENTIAL";
  const original = process.env[key];
  try {
    process.env[key] = "synthetic-not-a-credential";
    assert.deepEqual(checkedEnvironmentIdentity().e2e[key], { present: true, valueRecorded: false });
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

test("accepted-source context is re-bound without altering manifest integrity", () => {
  const source = {
    policyId: "fixture-only",
    snapshot: { taskRef: "fixture", state: "IN_PROGRESS", updatedAt: "2026-01-01T00:00:00Z" },
    descriptionDigest: digestJson("fixture-description"), sourceDigest: digestJson("fixture-source"),
  };
  const first = withAcceptedTaskSource(withRunEnvironment(snapshot()), source);
  const last = withAcceptedTaskSource(withRunEnvironment(snapshot()), source);
  assert.equal(first.environmentDigest, last.environmentDigest);
  assert.equal(first.manifest.integrity, "unknown");
  assert.notEqual(first.environmentDigest, withAcceptedTaskSource(
    withRunEnvironment(snapshot()), { ...source, sourceDigest: digestJson("changed-source") },
  ).environmentDigest);
});