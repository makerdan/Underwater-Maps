/**
 * Self-test for scripts/check-trip-window-raw-units.mjs
 *
 * Run via:  node --test scripts/__tests__/check-trip-window-raw-units.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findViolations, FORBIDDEN_PATTERNS, GUARDED_FILE, repoRoot } from "../check-trip-window-raw-units.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Pattern coverage — every forbidden pattern fires on a matching fixture
// ---------------------------------------------------------------------------

describe("FORBIDDEN_PATTERNS", () => {
  it("detects single-quoted ' kn' suffix literal", () => {
    const hits = findViolations("return val + ' kn';");
    assert.ok(hits.length > 0, "expected a violation");
    assert.ok(hits[0].description.includes("formatSpeedFromKnots"));
  });

  it("detects double-quoted \" kn\" suffix literal", () => {
    const hits = findViolations('return val + " kn";');
    assert.ok(hits.length > 0, "expected a violation");
  });

  it("detects single-quoted ' m ' suffix literal", () => {
    const hits = findViolations("return val + ' m ';");
    assert.ok(hits.length > 0, "expected a violation");
    assert.ok(hits[0].description.includes("formatWaveHeight"));
  });

  it("detects double-quoted \" m \" suffix literal", () => {
    const hits = findViolations('return val + " m ";');
    assert.ok(hits.length > 0, "expected a violation");
  });

  it("detects maxWindKt.toFixed( direct call", () => {
    const hits = findViolations("const s = maxWindKt.toFixed(1) + ' kn';");
    // Both the toFixed and the ' kn' literal should fire
    assert.ok(hits.length >= 1);
    assert.ok(hits.some((v) => v.description.includes("maxWindKt.toFixed")));
  });

  it("detects maxWaveM.toFixed( direct call", () => {
    const hits = findViolations("const s = maxWaveM.toFixed(2) + 'm';");
    assert.ok(hits.some((v) => v.description.includes("maxWaveM.toFixed")));
  });
});

// ---------------------------------------------------------------------------
// findViolations returns line numbers correctly
// ---------------------------------------------------------------------------

describe("findViolations", () => {
  it("returns an empty array for compliant source", () => {
    const src = [
      "import { formatSpeedFromKnots, formatWaveHeight } from '@/lib/units';",
      "const wind = formatSpeedFromKnots(w.maxWindKt);",
      "const wave = formatWaveHeight(w.maxWaveM);",
      "return `${wind} · ${wave}`;",
    ].join("\n");
    assert.deepEqual(findViolations(src), []);
  });

  it("reports the correct line number for each violation", () => {
    const src = [
      "// compliant line",
      "const bad = maxWindKt.toFixed(1);",
      "// another compliant line",
      "const bad2 = maxWaveM.toFixed(2);",
    ].join("\n");
    const hits = findViolations(src);
    assert.ok(hits.some((v) => v.line === 2 && v.description.includes("maxWindKt")));
    assert.ok(hits.some((v) => v.line === 4 && v.description.includes("maxWaveM")));
  });

  it("does NOT flag 'kn' embedded in an identifier name", () => {
    // 'kn' inside a name like 'knots' must not trigger the ' kn' guard
    const src = "const knots = toKnots(ms);";
    assert.deepEqual(findViolations(src), []);
  });

  it("does NOT flag an 'm' that is not a standalone unit suffix", () => {
    // variable name containing 'm' must not trigger
    const src = "const maxM = someValue;";
    assert.deepEqual(findViolations(src), []);
  });

  it("does NOT flag formatSpeedFromKnots or formatWaveHeight calls", () => {
    const src = [
      "formatSpeedFromKnots(w.maxWindKt)",
      "formatWaveHeight(w.maxWaveM)",
    ].join("\n");
    assert.deepEqual(findViolations(src), []);
  });
});

// ---------------------------------------------------------------------------
// Real-file assertion — the post-#3726 TripWindowPanel.tsx must pass clean
// ---------------------------------------------------------------------------

describe("real TripWindowPanel.tsx", () => {
  it("exits 0 (no violations) against the current file", () => {
    const filePath = resolve(repoRoot, GUARDED_FILE);
    let src;
    try {
      src = readFileSync(filePath, "utf8");
    } catch (err) {
      assert.fail(`Could not read ${GUARDED_FILE}: ${err.message}`);
    }
    const hits = findViolations(src);
    if (hits.length > 0) {
      const details = hits.map((v) => `  line ${v.line}: ${v.description}\n    ${v.text}`).join("\n");
      assert.fail(`TripWindowPanel.tsx has ${hits.length} forbidden raw-unit pattern(s):\n${details}`);
    }
  });
});
