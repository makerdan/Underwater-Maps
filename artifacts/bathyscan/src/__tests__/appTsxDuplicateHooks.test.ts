// @vitest-environment node
/**
 * Guard against duplicate hook-variable declarations in App.tsx.
 *
 * App.tsx is ~2 300 lines and touched by many parallel tasks.  A merge
 * collision can introduce two identical `const X = useStore(…)` lines in the
 * same component scope, which causes a white-screen "cannot redeclare block-
 * scoped variable" runtime crash even though TypeScript and ESLint may miss it
 * under certain tooling states.
 *
 * This test:
 *   1. Reads App.tsx as plain text (no full AST parse needed).
 *   2. Splits the file into per-top-level-function scopes by tracking { } depth.
 *   3. Within each scope collects every `const <name> = use<Hook>(` declaration.
 *   4. Fails loudly with the component name, duplicate variable name, and the
 *      first two conflicting line numbers when any name appears more than once.
 */

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const APP_TSX = path.resolve(__dirname, "..", "App.tsx");

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
 * Regex that matches top-level function declarations (including `export`).
 * Group 1 = function name.
 */
const FN_DECL_RE = /^(?:export\s+)?function\s+(\w+)\s*[<({]/;

function parseScopes(src: string): ComponentScope[] {
  const lines = src.split("\n");
  const scopes: ComponentScope[] = [];

  let current: ComponentScope | null = null;
  let depth = 0; // brace depth *inside* the current scope

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1; // 1-indexed for human readability

    // Detect a new top-level function (depth === 0 means we are at file level)
    if (depth === 0) {
      const fnMatch = FN_DECL_RE.exec(line);
      if (fnMatch) {
        current = { name: fnMatch[1], startLine: lineNo, decls: [] };
        // Start counting braces from this line
        depth += countBraces(line);
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

describe("App.tsx hook declarations", () => {
  it("has no duplicate hook-variable names within any component scope", () => {
    const src = fs.readFileSync(APP_TSX, "utf-8");
    const scopes = parseScopes(src);

    const violations: string[] = [];

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
            `  Component "${scope.name}" (starts line ${scope.startLine}): ` +
              `"const ${name}" declared ${lines.length} times — ` +
              `lines ${lines.join(", ")}`,
          );
        }
      }
    }

    expect(violations, violations.join("\n")).toHaveLength(0);
  });

  it("finds at least 50 hook declarations across all scopes (sanity check that parsing works)", () => {
    const src = fs.readFileSync(APP_TSX, "utf-8");
    const scopes = parseScopes(src);
    const total = scopes.reduce((sum, s) => sum + s.decls.length, 0);
    expect(total).toBeGreaterThanOrEqual(50);
  });
});
