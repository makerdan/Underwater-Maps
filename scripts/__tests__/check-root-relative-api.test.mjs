/**
 * Self-test for scripts/check-root-relative-api.mjs.
 *
 * Exercises both phases of the guard against on-disk fixtures so a broken
 * detector (regex/parse typo) fails loudly instead of passing quietly.
 *
 * Run: node --test scripts/__tests__/check-root-relative-api.test.mjs
 * (wired into the `check:root-relative-api` npm script, which runs in the
 * test-fast validation tier.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  runPhase1,
  runPhase2,
  detectFetchWrappersInSource,
  FETCH_WRAPPERS,
  WRAPPER_DEF_SCAN_ROOTS,
} from "../check-root-relative-api.mjs";

/** Create a throwaway fixture tree and return its root dir. */
function makeFixtureTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rra-guard-fixture-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

test("Phase 2 config covers both bathyscan and api-server trees", () => {
  assert.ok(WRAPPER_DEF_SCAN_ROOTS.includes("artifacts/bathyscan/src"));
  assert.ok(WRAPPER_DEF_SCAN_ROOTS.includes("artifacts/api-server/src"));
});

// ── Phase 1 fixtures ───────────────────────────────────────────────────────

test("Phase 1: root-relative /api/ call through a registered wrapper is flagged", (t) => {
  const root = makeFixtureTree({
    "src/bad.ts": `export async function load() {\n  return fetch("/api/settings");\n}\n`,
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { violations } = runPhase1({ rootDir: root, scanRoots: ["src"] });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, "src/bad.ts");
  assert.equal(violations[0].line, 2);
});

test("Phase 1: root-relative call through a custom registered wrapper is flagged", (t) => {
  const root = makeFixtureTree({
    "src/bad.ts": `const r = authorizedFetch('/api/markers');\n`,
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { violations } = runPhase1({ rootDir: root, scanRoots: ["src"] });
  assert.equal(violations.length, 1);
});

test("Phase 1: base-path-prefixed calls, comments, and test files pass", (t) => {
  const root = makeFixtureTree({
    "src/good.ts": [
      "export async function load() {",
      "  return fetch(`${API_BASE}api/settings`);",
      "}",
      '// fetch("/api/commented-out")',
    ].join("\n"),
    "src/__tests__/whatever.ts": `fetch("/api/allowed-in-tests");\n`,
    "src/thing.test.ts": `fetch("/api/allowed-in-tests");\n`,
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { violations, totalFiles } = runPhase1({ rootDir: root, scanRoots: ["src"] });
  assert.deepEqual(violations, []);
  assert.equal(totalFiles, 1); // test files excluded from the scan
});

// ── Phase 2 fixtures ───────────────────────────────────────────────────────

const UNREGISTERED_FETCH_WRAPPER = `
export async function sneakyFetch(url: string, init?: RequestInit) {
  return fetch(url, init);
}
`;

const UNREGISTERED_AUTHORIZED_FETCH_WRAPPER = `
import { authorizedFetch } from "./authorizedFetch";
export const sneakyAuthedFetch = async (url: string) => {
  const res = await authorizedFetch(url);
  return res.json();
};
`;

test("Phase 2: unregistered wrapper around native fetch is detected", (t) => {
  const root = makeFixtureTree({ "src/lib/sneaky.ts": UNREGISTERED_FETCH_WRAPPER });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { unregisteredWrappers } = runPhase2({
    rootDir: root,
    wrapperDefScanRoots: ["src"],
  });
  assert.equal(unregisteredWrappers.length, 1);
  assert.equal(unregisteredWrappers[0].name, "sneakyFetch");
});

test("Phase 2: bathyscan-style helper wrapping authorizedFetch is detected", (t) => {
  const root = makeFixtureTree({
    "src/lib/sneakyAuthed.ts": UNREGISTERED_AUTHORIZED_FETCH_WRAPPER,
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { unregisteredWrappers } = runPhase2({
    rootDir: root,
    wrapperDefScanRoots: ["src"],
  });
  assert.equal(unregisteredWrappers.length, 1);
  assert.equal(unregisteredWrappers[0].name, "sneakyAuthedFetch");
});

test("Phase 2: registered wrapper passes", (t) => {
  const root = makeFixtureTree({
    "src/lib/registered.ts": `
export async function authorizedFetch(input: RequestInfo, init: RequestInit = {}) {
  return fetch(input, init);
}
`,
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { unregisteredWrappers } = runPhase2({
    rootDir: root,
    wrapperDefScanRoots: ["src"],
  });
  assert.deepEqual(unregisteredWrappers, []);
});

test("Phase 2: explicitly registered external-only wrapper passes", (t) => {
  const root = makeFixtureTree({
    "src/lib/external.ts": `
export async function fetchErddap(url: string) {
  return fetch(url);
}
`,
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { unregisteredWrappers } = runPhase2({
    rootDir: root,
    wrapperDefScanRoots: ["src"],
    knownExternalWrappers: new Set(["fetchErddap"]),
  });
  assert.deepEqual(unregisteredWrappers, []);
});

test("Phase 2: non-URL first param and fetch-free bodies are not flagged", (t) => {
  const root = makeFixtureTree({
    "src/lib/misc.ts": `
export async function fetchTides(stationId: string) {
  return fetch("https://example.com/" + stationId);
}
export function buildUrl(url: string) {
  return url + "?x=1";
}
export interface Thing {
  method(url: string): Promise<void>;
}
`,
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { unregisteredWrappers } = runPhase2({
    rootDir: root,
    wrapperDefScanRoots: ["src"],
  });
  assert.deepEqual(unregisteredWrappers, []);
});

// ── Detector unit checks (canary against regex/parse typos) ───────────────

test("detectFetchWrappersInSource canary: known-positive source must be detected", () => {
  const detected = detectFetchWrappersInSource(UNREGISTERED_FETCH_WRAPPER, FETCH_WRAPPERS);
  assert.ok(
    detected.has("sneakyFetch"),
    "detector failed to find a textbook fetch wrapper — Phase 2 is silently broken",
  );
});

test("detectFetchWrappersInSource detects arrow, function-expression, and input-param forms", () => {
  const src = `
export const arrowWrap = async (url: string) => fetch(url);
export const exprWrap = function (endpoint) { return fetch(endpoint); };
export async function inputWrap(input: RequestInfo | URL) {
  return fetch(input);
}
`;
  const detected = detectFetchWrappersInSource(src, FETCH_WRAPPERS);
  // Note: bodyless arrow (`=> fetch(url)`) has no braces; extractBody returns
  // null so arrowWrap is a known limitation — braces-bodied forms must match.
  assert.ok(detected.has("exprWrap"));
  assert.ok(detected.has("inputWrap"));
});
