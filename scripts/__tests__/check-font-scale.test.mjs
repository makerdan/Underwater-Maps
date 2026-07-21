/**
 * Self-test for scripts/check-font-scale.mjs
 *
 * Run via:  node --test scripts/__tests__/check-font-scale.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BARE_FONT_SIZE_RE, findViolations, isTestFile } from "../check-font-scale.mjs";

describe("BARE_FONT_SIZE_RE", () => {
  it("matches bare integer fontSize object property", () => {
    assert.ok(BARE_FONT_SIZE_RE.test("fontSize: 14"));
    assert.ok(BARE_FONT_SIZE_RE.test("  fontSize: 14,"));
    assert.ok(BARE_FONT_SIZE_RE.test("{ fontSize: 14 }"));
    assert.ok(BARE_FONT_SIZE_RE.test("fontSize:14"));
    assert.ok(BARE_FONT_SIZE_RE.test("fontSize : 14"));
  });

  it("does NOT match the compliant calc() form", () => {
    assert.ok(!BARE_FONT_SIZE_RE.test('fontSize: "calc(14px * var(--bs-font-scale, 1))"'));
    assert.ok(!BARE_FONT_SIZE_RE.test("fontSize: `calc(${n}px * var(--bs-font-scale, 1))`"));
  });

  it("does NOT match JSX / TSX attribute syntax (fontSize={N})", () => {
    assert.ok(!BARE_FONT_SIZE_RE.test("<Text fontSize={14} />"));
    assert.ok(!BARE_FONT_SIZE_RE.test('fontSize={14}'));
    assert.ok(!BARE_FONT_SIZE_RE.test("<svg fontSize={12}>"));
  });

  it("does NOT match non-literal (variable) values", () => {
    assert.ok(!BARE_FONT_SIZE_RE.test("fontSize: scale"));
    assert.ok(!BARE_FONT_SIZE_RE.test("fontSize: someFontSize"));
  });

  it("does NOT match TypeScript type annotations", () => {
    assert.ok(!BARE_FONT_SIZE_RE.test("fontSize?: number"));
    assert.ok(!BARE_FONT_SIZE_RE.test("fontSize: number;"));
  });
});

describe("findViolations", () => {
  it("returns empty array for compliant source", () => {
    const src = [
      'const styles = { fontSize: "calc(14px * var(--bs-font-scale, 1))" };',
      '<Text fontSize={14} />',
    ].join("\n");
    assert.deepEqual(findViolations(src), []);
  });

  it("finds bare numeric fontSize violations", () => {
    const src = [
      "const styles = {",
      "  fontSize: 14,",
      "  color: 'red',",
      "};",
    ].join("\n");
    const hits = findViolations(src);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 2);
    assert.ok(hits[0].text.includes("fontSize: 14"));
  });

  it("reports the correct 1-based line number", () => {
    const src = "const a = 1;\nconst b = { fontSize: 22 };\nconst c = 3;\n";
    const hits = findViolations(src);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 2);
  });

  it("skips comment-only lines", () => {
    const src = [
      "// fontSize: 14  — bad example",
      "/* fontSize: 14 */",
      'const ok = { fontSize: "calc(14px * var(--bs-font-scale, 1))" };',
    ].join("\n");
    assert.deepEqual(findViolations(src), []);
  });

  it("finds multiple violations in one file", () => {
    const src = [
      "const a = { fontSize: 10 };",
      "const b = { fontSize: 12 };",
    ].join("\n");
    const hits = findViolations(src);
    assert.equal(hits.length, 2);
  });
});

describe("isTestFile", () => {
  it("flags __tests__ directory paths", () => {
    assert.ok(isTestFile("artifacts/bathyscan/src/__tests__/Foo.ts"));
  });

  it("flags .test. files", () => {
    assert.ok(isTestFile("artifacts/bathyscan/src/components/Foo.test.tsx"));
  });

  it("flags .spec. files", () => {
    assert.ok(isTestFile("artifacts/bathyscan/src/components/Foo.spec.ts"));
  });

  it("does not flag normal source files", () => {
    assert.ok(!isTestFile("artifacts/bathyscan/src/components/Foo.tsx"));
    assert.ok(!isTestFile("artifacts/bathyscan/src/lib/settings.ts"));
  });
});
