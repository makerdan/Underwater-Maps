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
import {
  findViolations,
  FORBIDDEN_PATTERNS,
  GENERAL_PATTERNS,
  TRIP_WINDOW_EXTRA_PATTERNS,
  GUARDED_FILE,
  GUARDED_FILES,
  repoRoot,
} from "../check-trip-window-raw-units.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Exports shape
// ---------------------------------------------------------------------------

describe("exports", () => {
  it("GUARDED_FILES is an array with at least 2 entries", () => {
    assert.ok(Array.isArray(GUARDED_FILES));
    assert.ok(GUARDED_FILES.length >= 2, "expected multiple guarded files");
  });

  it("GUARDED_FILE is the first entry of GUARDED_FILES (backward compat)", () => {
    assert.equal(GUARDED_FILE, GUARDED_FILES[0]);
    assert.ok(GUARDED_FILE.includes("TripWindowPanel"), "first file should be TripWindowPanel");
  });

  it("GUARDED_FILES includes the additional surface-condition panels", () => {
    const expected = [
      "ConditionsLegend.tsx",
      "DriftTimeline.tsx",
      "WeatherPanel.tsx",
      "CurrentsPanel.tsx",
      "ManualConditionsForm.tsx",
      "TidePanel.tsx",
    ];
    for (const name of expected) {
      assert.ok(
        GUARDED_FILES.some((f) => f.includes(name)),
        `GUARDED_FILES should include ${name}`,
      );
    }
  });

  it("FORBIDDEN_PATTERNS contains GENERAL_PATTERNS + TRIP_WINDOW_EXTRA_PATTERNS", () => {
    assert.equal(
      FORBIDDEN_PATTERNS.length,
      GENERAL_PATTERNS.length + TRIP_WINDOW_EXTRA_PATTERNS.length,
    );
    const allDesc = FORBIDDEN_PATTERNS.map((p) => p.description);
    for (const p of [...GENERAL_PATTERNS, ...TRIP_WINDOW_EXTRA_PATTERNS]) {
      assert.ok(allDesc.includes(p.description), `FORBIDDEN_PATTERNS missing: ${p.description}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Pattern coverage — every forbidden pattern fires on a matching fixture
// ---------------------------------------------------------------------------

describe("GENERAL_PATTERNS", () => {
  // ── quoted speed literals: kn ──────────────────────────────────────────────
  it("detects single-quoted ' kn' suffix literal", () => {
    const hits = findViolations("return val + ' kn';", GENERAL_PATTERNS);
    assert.ok(hits.length > 0, "expected a violation");
    assert.ok(hits[0].description.includes("formatSpeedFromKnots"));
  });

  it("detects double-quoted \" kn\" suffix literal", () => {
    const hits = findViolations('return val + " kn";', GENERAL_PATTERNS);
    assert.ok(hits.length > 0, "expected a violation");
  });

  // ── quoted speed literals: kt / KT (reviewer-verified cases) ──────────────
  it("detects double-quoted \" kt\" speed suffix at end of string", () => {
    // Reviewer verified this was missed before; must catch it.
    const hits = findViolations('return speed + " kt";', GENERAL_PATTERNS);
    assert.ok(hits.length > 0, "expected a violation — \" kt\" must be caught");
    assert.ok(hits[0].description.includes("formatSpeedFromKnots"));
  });

  it("detects single-quoted ' kt' speed suffix at end of string", () => {
    const hits = findViolations("return speed + ' kt';", GENERAL_PATTERNS);
    assert.ok(hits.length > 0, "expected a violation");
  });

  it("detects uppercase \" KT\" speed suffix in quoted string", () => {
    const hits = findViolations('return speed + " KT";', GENERAL_PATTERNS);
    assert.ok(hits.length > 0, "expected a violation");
  });

  // ── quoted metre literals ──────────────────────────────────────────────────
  it("detects single-quoted ' m ' suffix literal (mid-string)", () => {
    const hits = findViolations("return val + ' m ';", GENERAL_PATTERNS);
    assert.ok(hits.length > 0, "expected a violation");
  });

  it("detects double-quoted \" m \" suffix literal (mid-string)", () => {
    const hits = findViolations('return val + " m ";', GENERAL_PATTERNS);
    assert.ok(hits.length > 0, "expected a violation");
  });

  it("detects double-quoted \" m\" at end of string (reviewer-verified case)", () => {
    // Reviewer verified this was missed before; must catch it.
    const hits = findViolations('return depth + " m";', GENERAL_PATTERNS);
    assert.ok(hits.length > 0, "expected a violation — \" m\" at end of string must be caught");
  });

  it("detects single-quoted ' m' at end of string", () => {
    const hits = findViolations("return depth + ' m';", GENERAL_PATTERNS);
    assert.ok(hits.length > 0, "expected a violation");
  });

  // ── template-literal / JSX speed forms ────────────────────────────────────
  it("detects raw } kn in a template-literal interpolation", () => {
    const hits = findViolations("const s = `Wind ${speed} kn @ north`;", GENERAL_PATTERNS);
    assert.ok(hits.length > 0, "expected a violation");
    assert.ok(hits[0].description.includes("formatSpeedFromKnots"));
  });

  it("detects } kn at end of template string", () => {
    const hits = findViolations("const s = `Tidal ${tidalSpeedKnots} kn`;", GENERAL_PATTERNS);
    assert.ok(hits.length > 0, "expected a violation");
  });

  it("detects lowercase } kt in a template-literal interpolation", () => {
    const hits = findViolations(
      "const s = `WIND ${manualWindSpeedKnots} kt @ N`;",
      GENERAL_PATTERNS,
    );
    assert.ok(hits.length > 0, "expected a violation");
    assert.ok(hits[0].description.includes("formatSpeedFromKnots"));
  });

  it("detects uppercase } KT in a template-literal interpolation", () => {
    const hits = findViolations(
      "const s = `⛵ BTROLL @ ${boatSpeedKnots.toFixed(1)} KT`;",
      GENERAL_PATTERNS,
    );
    assert.ok(hits.length > 0, "expected a violation");
    assert.ok(hits[0].description.includes("formatSpeedFromKnots"));
  });

  it("detects no-space }kt in a JSX expression", () => {
    const hits = findViolations(
      "<div>{p.name} @ {p.speedKnots}kt</div>",
      GENERAL_PATTERNS,
    );
    assert.ok(hits.length > 0, "expected a violation");
  });

  // ── template-literal / JSX metre forms ────────────────────────────────────
  it("detects .toFixed() followed by } m in a template literal", () => {
    const hits = findViolations(
      "const s = `${waveHeightM.toFixed(2)} m`;",
      GENERAL_PATTERNS,
    );
    assert.ok(hits.length > 0, "expected a violation");
  });

  it("detects .toFixed() with zero decimals followed by } m", () => {
    const hits = findViolations(
      "const s = `${hookDepthM.toFixed(0)} m`;",
      GENERAL_PATTERNS,
    );
    assert.ok(hits.length > 0, "expected a violation");
  });

  it("detects .toFixed(1) followed by } m in JSX expression", () => {
    const hits = findViolations(
      "<span>{cond.tideHeightM.toFixed(1)} m</span>",
      GENERAL_PATTERNS,
    );
    assert.ok(hits.length > 0, "expected a violation");
  });

  it("detects Math.round() followed by } m in a template literal", () => {
    const hits = findViolations(
      "const s = `Snap to the ${Math.round(snapDepthM)} m contour`;",
      GENERAL_PATTERNS,
    );
    assert.ok(hits.length > 0, "expected a violation");
  });

  it("detects plain variable reference followed by } m (reviewer-verified case)", () => {
    // Reviewer verified `${depth} m` was missed before; must catch it.
    const hits = findViolations(
      "const s = `Depth ${depth} m`;",
      GENERAL_PATTERNS,
    );
    assert.ok(hits.length > 0, "expected a violation — `${depth} m` must be caught");
  });

  it("detects no-space }m suffix in a JSX expression", () => {
    const hits = findViolations(
      "<div>BOTTOM {lineLengthM}m LINE</div>",
      GENERAL_PATTERNS,
    );
    assert.ok(hits.length > 0, "expected a violation");
  });

  it("detects no-space }m in a saved-plan metadata label", () => {
    const hits = findViolations(
      "<div>{plan.lineLengthM}m</div>",
      GENERAL_PATTERNS,
    );
    assert.ok(hits.length > 0, "expected a violation");
  });

  // ── } kt IS flagged; suppression handles GPX and other legitimate uses ─────
  it("DOES flag } kt drift in a template literal (suppression exempts GPX lines)", () => {
    const hits = findViolations(
      "const desc = `Hour ${h}: ${speed.toFixed(1)} kt drift`;",
      GENERAL_PATTERNS,
    );
    assert.ok(hits.length > 0, "expected a violation — raw-unit-ok comment is what exempts GPX");
  });

  // ── suppression ───────────────────────────────────────────────────────────
  it("does NOT flag lines containing 'raw-unit-ok'", () => {
    const hits = findViolations(
      "const desc = `${speed.toFixed(1)} kt drift`; // raw-unit-ok: GPX SI units",
      GENERAL_PATTERNS,
    );
    assert.deepEqual(hits, []);
  });

  it("does NOT flag } m when the line is suppressed", () => {
    const hits = findViolations(
      "return `${h}h ${m}m`; // raw-unit-ok: m = minutes not metres",
      GENERAL_PATTERNS,
    );
    assert.deepEqual(hits, []);
  });

  // ── true negatives ────────────────────────────────────────────────────────
  it("does NOT flag } km (distance, not metre alone)", () => {
    const hits = findViolations(
      "const s = `${data.distanceKm.toFixed(1)} km away`;",
      GENERAL_PATTERNS,
    );
    assert.deepEqual(hits, []);
  });

  it("does NOT flag .toFixed() inside XML ele tag (no m suffix)", () => {
    const hits = findViolations(
      "xml += `<ele>${(-depth).toFixed(1)}</ele>`;",
      GENERAL_PATTERNS,
    );
    assert.deepEqual(hits, []);
  });

  it("does NOT flag formatSpeedFromKnots result in a template (no raw kn)", () => {
    const hits = findViolations(
      "const s = `Wind ${formatSpeedFromKnots(val, { units })} @ N`;",
      GENERAL_PATTERNS,
    );
    assert.deepEqual(hits, []);
  });

  it("does NOT flag formatWaveHeight result in a template (no raw m)", () => {
    const hits = findViolations(
      "<div>{formatWaveHeight(val, { units, decimals: 0 })}</div>",
      GENERAL_PATTERNS,
    );
    assert.deepEqual(hits, []);
  });

  it("does NOT flag degree suffix °", () => {
    const hits = findViolations(
      "const s = `${Math.round(deg)}° from vertical`;",
      GENERAL_PATTERNS,
    );
    assert.deepEqual(hits, []);
  });

  it("does NOT flag 'kn' embedded in an identifier name", () => {
    const hits = findViolations("const knots = toKnots(ms);", GENERAL_PATTERNS);
    assert.deepEqual(hits, []);
  });
});

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
  });

  it("detects double-quoted \" m \" suffix literal", () => {
    const hits = findViolations('return val + " m ";');
    assert.ok(hits.length > 0, "expected a violation");
  });

  it("detects maxWindKt.toFixed( direct call", () => {
    const hits = findViolations("const s = maxWindKt.toFixed(1) + ' kn';");
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
  it("returns an empty array for compliant source (default patterns)", () => {
    const src = [
      "import { formatSpeedFromKnots, formatWaveHeight } from '@/lib/units';",
      "const wind = formatSpeedFromKnots(w.maxWindKt);",
      "const wave = formatWaveHeight(w.maxWaveM);",
      "return `${wind} · ${wave}`;",
    ].join("\n");
    assert.deepEqual(findViolations(src), []);
  });

  it("returns an empty array for compliant source (GENERAL_PATTERNS)", () => {
    const src = [
      "import { formatSpeedFromKnots, formatWaveHeight } from '@/lib/units';",
      "const wind = formatSpeedFromKnots(w.maxWindKt);",
      "const wave = formatWaveHeight(w.maxWaveM);",
      "return `${wind} · ${wave}`;",
    ].join("\n");
    assert.deepEqual(findViolations(src, GENERAL_PATTERNS), []);
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
    const src = "const knots = toKnots(ms);";
    assert.deepEqual(findViolations(src), []);
  });

  it("does NOT flag an 'm' that is not a standalone unit suffix", () => {
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

  it("GENERAL_PATTERNS does NOT flag maxWindKt.toFixed (TripWindow-only pattern)", () => {
    const src = "const s = maxWindKt.toFixed(1);";
    assert.deepEqual(findViolations(src, GENERAL_PATTERNS), []);
  });

  it("GENERAL_PATTERNS does NOT flag maxWaveM.toFixed (TripWindow-only pattern)", () => {
    const src = "const s = maxWaveM.toFixed(2);";
    assert.deepEqual(findViolations(src, GENERAL_PATTERNS), []);
  });
});

// ---------------------------------------------------------------------------
// Real-file assertions — every guarded file must pass clean
// ---------------------------------------------------------------------------

describe("real TripWindowPanel.tsx", () => {
  it("exits 0 (no violations) against the current file (full FORBIDDEN_PATTERNS)", () => {
    const filePath = resolve(repoRoot, GUARDED_FILE);
    let src;
    try {
      src = readFileSync(filePath, "utf8");
    } catch (err) {
      assert.fail(`Could not read ${GUARDED_FILE}: ${err.message}`);
    }
    const hits = findViolations(src, FORBIDDEN_PATTERNS);
    if (hits.length > 0) {
      const details = hits.map((v) => `  line ${v.line}: ${v.description}\n    ${v.text}`).join("\n");
      assert.fail(`TripWindowPanel.tsx has ${hits.length} forbidden raw-unit pattern(s):\n${details}`);
    }
  });
});

describe("additional guarded surface-condition panels (GENERAL_PATTERNS)", () => {
  const additionalFiles = GUARDED_FILES.filter((f) => f !== GUARDED_FILE);

  for (const guardedFile of additionalFiles) {
    const fileName = guardedFile.split("/").pop();
    it(`${fileName} has no raw-unit literal violations`, () => {
      const filePath = resolve(repoRoot, guardedFile);
      let src;
      try {
        src = readFileSync(filePath, "utf8");
      } catch (err) {
        assert.fail(`Could not read ${guardedFile}: ${err.message}`);
      }
      const hits = findViolations(src, GENERAL_PATTERNS);
      if (hits.length > 0) {
        const details = hits
          .map((v) => `  line ${v.line}: ${v.description}\n    ${v.text}`)
          .join("\n");
        assert.fail(`${fileName} has ${hits.length} forbidden raw-unit pattern(s):\n${details}`);
      }
    });
  }
});
