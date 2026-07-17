// @vitest-environment node
/**
 * Guard against duplicate hook-variable declarations in large component files.
 *
 * These files are touched by many parallel tasks.  A merge collision can
 * introduce two identical `const X = useStore(…)` lines in the same component
 * scope, which causes a white-screen "cannot redeclare block-scoped variable"
 * runtime crash even though TypeScript and ESLint may miss it under certain
 * tooling states.
 *
 * This test:
 *   1. Reads each target file as plain text (no full AST parse needed).
 *   2. Splits the file into per-top-level-function scopes by tracking { } depth.
 *   3. Within each scope collects every `const <name> = use<Hook>(` declaration.
 *   4. Fails loudly with the file name, component name, duplicate variable name,
 *      and the first two conflicting line numbers when any name appears more
 *      than once.
 *
 * A discovery sentinel test auto-scans src/ and fails when any .tsx file
 * outside __tests__ directories meets the threshold (>500 lines, ≥10 hook
 * declarations) but is not listed in SCANNED_FILES — so new qualifying files
 * cannot be silently omitted after a merge.
 */

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Discovery helpers — used by the sentinel test
// ---------------------------------------------------------------------------

/** Minimum line count for a file to be considered "large". */
const MIN_LINES = 500;

/** Minimum hook declarations for a file to be considered "high risk". */
const MIN_HOOKS = 10;

/** Regex to count hook declarations (same as HOOK_DECL_RE but applied globally). */
const HOOK_COUNT_RE = /^\s*const\s+\w+\s*=\s*use[A-Z]/gm;

/** Walk a directory tree and return all .tsx paths not under __tests__ dirs. */
function collectTsxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      results.push(...collectTsxFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Files to scan — relative to artifacts/bathyscan/src/.
 * Criteria: >500 lines AND ≥10 hook declarations (both true for all entries).
 *
 * The "SCANNED_FILES must stay complete" test below will fail if any file in
 * src/ meets the criteria but is absent from this list, so you do not need to
 * remember to add new files manually — the test will tell you.
 */
const SCANNED_FILES: string[] = [
  "App.tsx",
  "pages/Settings.tsx",
  "pages/TourScene.tsx",
  "components/CurrentsPanel.tsx",
  "components/DatasetPanel.tsx",
  "components/DatasetFolderTree.tsx",
  "components/DriftBoat.tsx",
  "components/DriftPath.tsx",
  "components/FindDataPanel.tsx",
  "components/GpsImportDialog.tsx",
  "components/HabitatPanel.tsx",
  "components/HUD.tsx",
  "components/MarkerForm.tsx",
  "components/Minimap.tsx",
  "components/OverlaysToolsPanel.tsx",
  "components/OverviewMap.tsx",
  "components/DepthProfilePanel.tsx",
  "components/SubstrateLayer.tsx",
  "components/ThrottlePanel.tsx",
  "components/TidePanel.tsx",
  "components/WeatherPanel.tsx",
  "components/ZoneOverlay.tsx",
];

const SRC_DIR = path.resolve(__dirname, "..");

/** One hook declaration found in the source. */
interface HookDecl {
  name: string;
  line: number;
}

/** One top-level function scope extracted from the file. */
interface ComponentScope {
  name: string;
  startLine: number;
  decls: HookDecl[];
}

/**
 * Regex that matches lines like:
 *   const foo = useSomeStore((s) => s.foo);
 *   const bar = useCallback(() => {}, []);
 *   const baz = useRef<null>(null);
 *
 * Group 1 = variable name.
 * We deliberately cast a wide net (any `use` hook) because the crash happens
 * for *any* duplicate const, not just store hooks.
 */
const HOOK_DECL_RE = /^\s*const\s+(\w+)\s*=\s*use[A-Z]\w*\s*[<(]/;

/**
 * Matches top-level function/component declarations (including `export`).
 *
 * Two forms:
 *   1. `function Name(` / `export function Name(`
 *   2. `const Name` / `export const Name`  (arrow-function components)
 *
 * Group 1 = name from a `function` declaration.
 * Group 2 = name from a `const` declaration.
 *
 * For const arrow-function components we only open a scope when the
 * declaration line itself introduces an opening brace (delta > 0), so simple
 * `const MAX = 5;` lines are ignored.
 */
const FN_DECL_RE =
  /^(?:export\s+)?(?:function\s+(\w+)\s*[<({]|const\s+(\w+)\b)/;

function parseScopes(src: string): ComponentScope[] {
  const lines = src.split("\n");
  const scopes: ComponentScope[] = [];

  let current: ComponentScope | null = null;
  let depth = 0; // brace depth *inside* the current scope

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1; // 1-indexed for human readability

    // Detect a new top-level function/component (depth === 0 = file level)
    if (depth === 0) {
      const fnMatch = FN_DECL_RE.exec(line);
      if (fnMatch) {
        const name = fnMatch[1] || fnMatch[2];
        const bracesDelta = countBraces(line);
        // Only open a scope when the declaration line itself starts a block.
        // This skips simple `const X = 5;` lines (delta = 0).
        if (bracesDelta > 0) {
          current = { name, startLine: lineNo, decls: [] };
          depth = bracesDelta;
        }
        continue;
      }
    }

    if (current === null) {
      // Haven't entered any function yet — skip
      continue;
    }

    // Count braces to track scope boundaries
    depth += countBraces(line);

    if (depth <= 0) {
      // We've closed the function body — save scope and reset
      scopes.push(current);
      current = null;
      depth = 0;
      continue;
    }

    // Inside a function scope: look for hook declarations
    const hookMatch = HOOK_DECL_RE.exec(line);
    if (hookMatch) {
      current.decls.push({ name: hookMatch[1], line: lineNo });
    }
  }

  // Push any unclosed scope (shouldn't happen in well-formed TS but be safe)
  if (current !== null) {
    scopes.push(current);
  }

  return scopes;
}

/**
 * Count the net brace delta for a single source line, ignoring braces inside
 * string literals and single-line comments.  This is intentionally simple:
 * it handles 99 % of real component code without a full parser.
 */
function countBraces(line: string): number {
  let delta = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateLiteral = false;

  for (let ci = 0; ci < line.length; ci++) {
    const ch = line[ci];
    const prev = ci > 0 ? line[ci - 1] : "";

    // Toggle string state (simple — doesn't handle all escape sequences but
    // sufficient for detecting `{` / `}` in non-string code)
    if (ch === "'" && !inDoubleQuote && !inTemplateLiteral && prev !== "\\") {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote && !inTemplateLiteral && prev !== "\\") {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (ch === "`" && !inSingleQuote && !inDoubleQuote && prev !== "\\") {
      inTemplateLiteral = !inTemplateLiteral;
      continue;
    }

    if (inSingleQuote || inDoubleQuote || inTemplateLiteral) continue;

    // Detect `//` line comments — everything after is ignored
    if (ch === "/" && line[ci + 1] === "/") break;

    if (ch === "{") delta++;
    if (ch === "}") delta--;
  }

  return delta;
}

// ---------------------------------------------------------------------------

describe("App.tsx lint suppressors", () => {
  it("App.tsx has no eslint-disable-next-line react-hooks/exhaustive-deps suppressors", () => {
    const filePath = path.join(SRC_DIR, "App.tsx");
    const src = fs.readFileSync(filePath, "utf-8");
    const lines = src.split("\n");
    const offenders: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("eslint-disable-next-line react-hooks/exhaustive-deps")) {
        offenders.push(`  line ${i + 1}: ${lines[i].trim()}`);
      }
    }
    expect(
      offenders,
      `App.tsx contains eslint-disable-next-line react-hooks/exhaustive-deps suppressor(s) ` +
        `— fix the dependency array instead of silencing the rule:\n${offenders.join("\n")}`,
    ).toHaveLength(0);
  });
});

describe("duplicate hook-variable declarations", () => {
  it("has no duplicate hook-variable names within any component scope in any scanned file", () => {
    const violations: string[] = [];

    for (const relPath of SCANNED_FILES) {
      const filePath = path.join(SRC_DIR, relPath);
      const src = fs.readFileSync(filePath, "utf-8");
      const scopes = parseScopes(src);

      for (const scope of scopes) {
        // Build a map: name → list of line numbers where it appears
        const seen = new Map<string, number[]>();
        for (const decl of scope.decls) {
          const existing = seen.get(decl.name);
          if (existing) {
            existing.push(decl.line);
          } else {
            seen.set(decl.name, [decl.line]);
          }
        }

        for (const [name, lines] of seen) {
          if (lines.length > 1) {
            violations.push(
              `  ${relPath} — component "${scope.name}" (starts line ${scope.startLine}): ` +
                `"const ${name}" declared ${lines.length} times — ` +
                `lines ${lines.join(", ")}`,
            );
          }
        }
      }
    }

    expect(violations, violations.join("\n")).toHaveLength(0);
  });

  it("finds at least 10 hook declarations in each scanned file (sanity check that parsing works)", () => {
    for (const relPath of SCANNED_FILES) {
      const filePath = path.join(SRC_DIR, relPath);
      const src = fs.readFileSync(filePath, "utf-8");
      const scopes = parseScopes(src);
      const total = scopes.reduce((sum, s) => sum + s.decls.length, 0);
      expect(
        total,
        `${relPath}: expected ≥10 hook declarations but found ${total} — parser may be broken`,
      ).toBeGreaterThanOrEqual(10);
    }
  });

  it("SCANNED_FILES must stay complete — fails when a new qualifying file is not listed", () => {
    // Auto-discover every .tsx outside __tests__ dirs that meets the threshold.
    // If a file grows to qualify after a merge, this test will catch it.
    const scannedSet = new Set(SCANNED_FILES);
    const allTsx = collectTsxFiles(SRC_DIR);
    const missing: string[] = [];

    for (const absPath of allTsx) {
      const src = fs.readFileSync(absPath, "utf-8");
      const lineCount = src.split("\n").length;
      if (lineCount <= MIN_LINES) continue;

      const hookMatches = src.match(HOOK_COUNT_RE);
      const hookCount = hookMatches ? hookMatches.length : 0;
      if (hookCount < MIN_HOOKS) continue;

      const relPath = path.relative(SRC_DIR, absPath);
      // Normalize to forward-slash so paths match on all platforms
      const relPathNorm = relPath.split(path.sep).join("/");
      if (!scannedSet.has(relPathNorm)) {
        missing.push(
          `  ${relPathNorm} (${lineCount} lines, ${hookCount} hook declarations)`,
        );
      }
    }

    expect(
      missing,
      `The following files meet the threshold (>${MIN_LINES} lines, ≥${MIN_HOOKS} hooks) ` +
        `but are not in SCANNED_FILES — add them:\n${missing.join("\n")}`,
    ).toHaveLength(0);
  });
});
