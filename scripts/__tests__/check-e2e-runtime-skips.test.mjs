import test from "node:test";
import assert from "node:assert/strict";
import {
  compareRuntimeSkips,
  parseRuntimeBaseline,
  parseRuntimeOutcome,
} from "../check-e2e-runtime-skips.mjs";

const baseline = parseRuntimeBaseline({
  version: 1,
  suites: { "pr-smoke": { skipped: 2, tests: ["a", "b"] } },
});

function outcome(skipped, skips = []) {
  return {
    schemaVersion: 1,
    suite: "pr-smoke",
    counts: { passed: 4, failed: 0, skipped, interrupted: 0, flaky: 0 },
    skips,
  };
}

test("accepts a well-formed runtime outcome at its baseline", () => {
  const parsed = parseRuntimeOutcome(
    outcome(2, [
      { test: "a", reason: "WebGL unavailable" },
      { test: "b", reason: "Optional upstream unavailable" },
    ]),
  );
  assert.equal(compareRuntimeSkips(parsed, baseline, "pr-smoke").ok, true);
});

test("rejects an equal-count substitution of skipped test identities", () => {
  const identityBaseline = parseRuntimeBaseline({
    version: 1,
    suites: { "pr-smoke": { skipped: 2, tests: ["a", "b"] } },
  });
  const parsed = parseRuntimeOutcome(
    outcome(2, [
      { test: "a", reason: "WebGL unavailable" },
      { test: "new-test", reason: "Unexpected gate" },
    ]),
  );
  const result = compareRuntimeSkips(parsed, identityBaseline, "pr-smoke");
  assert.equal(result.ok, false);
  assert.match(result.message, /identities changed/);
  assert.match(result.message, /new-test/);
  assert.match(result.message, /b/);
});

test("rejects malformed outcome data before evaluating the ratchet", () => {
  assert.throws(
    () => parseRuntimeOutcome(outcome(1, [])),
    /skips length must equal counts\.skipped/,
  );
  assert.throws(
    () =>
      parseRuntimeOutcome(
        outcome(1, [{ test: "a", reason: "No skip reason was supplied by Playwright." }]),
      ),
    /generic missing-reason fallback/,
  );
  assert.throws(
    () => parseRuntimeBaseline({ version: 1, suites: { "pr-smoke": { skipped: -1 } } }),
    /non-negative integer/,
  );
  assert.throws(
    () => parseRuntimeBaseline({ version: 1, suites: { "pr-smoke": { skipped: 0 } } }),
    /tests must be an array/,
  );
  assert.throws(
    () => parseRuntimeBaseline({
      version: 1,
      suites: { "pr-smoke": { skipped: 1, tests: [] } },
    }),
    /tests length must equal skipped/,
  );
});

test("fails when runtime skipped coverage increases", () => {
  const parsed = parseRuntimeOutcome(
    outcome(3, [
      { test: "a", reason: "one" },
      { test: "b", reason: "two" },
      { test: "c", reason: "new gate" },
    ]),
  );
  const result = compareRuntimeSkips(parsed, baseline, "pr-smoke");
  assert.equal(result.ok, false);
  assert.match(result.message, /increased/);
});

test("rejects a result generated for a different workflow suite", () => {
  const parsed = parseRuntimeOutcome(outcome(0));
  assert.throws(
    () => compareRuntimeSkips(parsed, baseline, "main-full"),
    /does not match requested suite/,
  );
});

test("accepts a downward ratchet opportunity without silently rebasing it", () => {
  const parsed = parseRuntimeOutcome(outcome(1, [{ test: "a", reason: "one" }]));
  const result = compareRuntimeSkips(parsed, baseline, "pr-smoke");
  assert.equal(result.ok, true);
  assert.match(result.message, /Ratchet/);
});