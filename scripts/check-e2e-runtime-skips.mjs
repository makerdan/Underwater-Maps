#!/usr/bin/env node
/**
 * Ratchet GitHub-only Playwright runtime skips.
 *
 * This is intentionally separate from check-skip-count.mjs. The latter counts
 * source call sites and protects every environment; this script evaluates what
 * actually skipped on a GitHub runner after dynamic environment gates ran.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readJson(path, label) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`${label} not found at ${path}: ${error?.message ?? error}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON at ${path}: ${error?.message ?? error}`);
  }
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

export function parseRuntimeOutcome(input, source = "runtime result") {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${source} must be a JSON object.`);
  }
  if (input.schemaVersion !== 1) {
    throw new Error(`${source}.schemaVersion must be 1.`);
  }
  if (typeof input.suite !== "string" || !input.suite.trim()) {
    throw new Error(`${source}.suite must be a non-empty string.`);
  }
  if (!input.counts || typeof input.counts !== "object" || Array.isArray(input.counts)) {
    throw new Error(`${source}.counts must be an object.`);
  }
  for (const field of ["passed", "failed", "skipped", "interrupted", "flaky"]) {
    if (!nonNegativeInteger(input.counts[field])) {
      throw new Error(`${source}.counts.${field} must be a non-negative integer.`);
    }
  }
  if (!Array.isArray(input.skips)) throw new Error(`${source}.skips must be an array.`);
  if (input.skips.length !== input.counts.skipped) {
    throw new Error(`${source}.skips length must equal counts.skipped.`);
  }
  for (const [index, skip] of input.skips.entries()) {
    if (!skip || typeof skip.test !== "string" || !skip.test.trim()) {
      throw new Error(`${source}.skips[${index}].test must be a non-empty string.`);
    }
    if (!skip || typeof skip.reason !== "string" || !skip.reason.trim()) {
      throw new Error(`${source}.skips[${index}].reason must be a non-empty string.`);
    }
  }
  return input;
}

export function parseRuntimeBaseline(input, source = "runtime-skip baseline") {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${source} must be a JSON object.`);
  }
  if (input.version !== 1) throw new Error(`${source}.version must be 1.`);
  if (!input.suites || typeof input.suites !== "object" || Array.isArray(input.suites)) {
    throw new Error(`${source}.suites must be an object.`);
  }
  for (const [suite, entry] of Object.entries(input.suites)) {
    if (!entry || !nonNegativeInteger(entry.skipped)) {
      throw new Error(`${source}.suites.${suite}.skipped must be a non-negative integer.`);
    }
  }
  return input;
}

export function compareRuntimeSkips(outcome, baseline, suite) {
  if (outcome.suite !== suite) {
    throw new Error(
      `runtime result suite ${JSON.stringify(outcome.suite)} does not match requested suite ${JSON.stringify(suite)}.`,
    );
  }
  const entry = baseline.suites[suite];
  if (!entry) throw new Error(`runtime-skip baseline has no suite named ${JSON.stringify(suite)}.`);
  const actual = outcome.counts.skipped;
  if (actual > entry.skipped) {
    return {
      ok: false,
      message:
        `runtime skips increased for ${suite}: ${actual}, baseline ${entry.skipped}. ` +
        "Do not turn failures into skips. If a GitHub-only gate is genuinely expected, " +
        "review its emitted test/reason and update tests/e2e/runtime-skip-baseline.json deliberately.",
    };
  }
  if (actual < entry.skipped) {
    return {
      ok: true,
      message:
        `runtime skips decreased for ${suite}: ${actual}, baseline ${entry.skipped}. ` +
        "Ratchet the checked-in baseline down in the same change to preserve the improvement.",
    };
  }
  return { ok: true, message: `runtime skips match ${suite} baseline: ${actual}.` };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  const resultsPath = option("--results");
  const baselinePath = option("--baseline");
  const suite = option("--suite");
  if (!resultsPath || !baselinePath || !suite) {
    throw new Error(
      "usage: node scripts/check-e2e-runtime-skips.mjs --results <file> --baseline <file> --suite <name>",
    );
  }
  const outcome = parseRuntimeOutcome(readJson(resolve(resultsPath), "runtime result"));
  const baseline = parseRuntimeBaseline(readJson(resolve(baselinePath), "runtime-skip baseline"));
  const result = compareRuntimeSkips(outcome, baseline, suite);
  console.log(`[check-e2e-runtime-skips] ${result.ok ? "OK" : "FAIL"} — ${result.message}`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try {
    main();
  } catch (error) {
    console.error(`[check-e2e-runtime-skips] FAIL — ${error.message}`);
    process.exitCode = 1;
  }
}