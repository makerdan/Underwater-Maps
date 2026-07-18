---
name: bug-audit
description: >-
  Systematic bug-and-error audit playbook for any Replit app (frontend,
  backend, or full-stack). Use whenever the user asks to audit code for bugs,
  hunt errors, review code for correctness, investigate crashes, find race
  conditions or null/undefined errors, do a security review, chase performance
  problems, make the app more reliable, or run a pre-launch/pre-deploy check —
  even if they don't say "audit" explicitly (e.g. "why does my app keep
  crashing", "check my code for problems", "is this safe to ship"). Supports
  two modes — report-only (find and report, change nothing; the default) and
  audit-and-fix (fix in severity order with verification and regression
  hardening).
---

# Bug Audit

A phased, repeatable playbook for finding, triaging, fixing, and permanently preventing bugs in any codebase. It works on any stack; stack-specific checks are gated and skipped when they don't apply.

## Invocation Modes — decide first

- **report-only** (DEFAULT): audit, deliver the findings report, change NOTHING. Stop at the end of Phase 2 and ask the user which findings to fix.
- **audit-and-fix**: only when the user explicitly asks for fixes ("fix what you find", "clean these up"). Runs all phases.

If the user's intent is ambiguous, assume report-only. Never modify code in report-only mode — not even "trivial" fixes.

## Phase overview

| Phase | Gate | Purpose |
|---|---|---|
| 0 | ALWAYS | Scope, stack detection, cheap signal gathering |
| 1 | ALWAYS | Ten category audit passes |
| 2 | ALWAYS | Triage + findings report (report-only STOPS here) |
| 3 | CONDITIONAL: audit-and-fix mode, or user approved fixes after the report | Verified fix loop |
| 4 | CONDITIONAL: fixes were applied in Phase 3 | Regression hardening |
| 5 | ALWAYS | Acceptance test and handoff |

Conditional phases whose gate fails are skipped entirely — never applied speculatively.

---

## Phase 0 (ALWAYS) — Scope and inventory

1. **Detect the stack.** Identify languages, frameworks, and tooling:
   - TypeScript present? (tsconfig.json, .ts/.tsx files) → gates the type-safety category.
   - React present? (react in package.json) → gates React-specific checks (hook deps, unmounted setState, effect cleanup).
   - Backend framework, database layer, test runner, linter — note what exists.
2. **Map entry points and highest-risk surfaces**: authentication, payments, data writes, anything handling user input. These get audited first.
3. **Scope check.** If the codebase is large (roughly >30k lines or many packages), ask the user to narrow scope (a feature area, a directory, "just security"). Otherwise audit everything in priority order: security-sensitive code → data integrity → the rest.
4. **Cheap signal gathering** — run whatever exists and record output as seed findings:
   - Typechecker (e.g. `tsc --noEmit`)
   - Linter
   - Existing test suite
   - Dependency vulnerability audit (`npm audit` / `pip-audit` / platform security-scan tooling if available — use it, don't reimplement it)

Their output seeds the findings list; don't treat tool output as final findings until verified in Phase 1.

## Phase 1 (ALWAYS) — Category audit passes

Run one pass per category below. For each candidate a search surfaces, **read the surrounding context before recording a finding** — grep hits are candidates, not findings. Skip gated categories that don't apply and say so in the report.

### 1. Null / undefined safety
Look for: unguarded access on possibly-null values; missing optional chaining on API response fields; array access without bounds checks.
Heuristics: grep for `.data.` / `[0]` / `.find(` followed by immediate property access; `JSON.parse(` results used without checks; function params typed optional but dereferenced directly.
False-positive warning: a value may be guaranteed non-null by an earlier guard or by construction — trace the data flow before reporting.

### 2. Async & timing
Look for: unawaited promises / uncaught rejections; race conditions producing inconsistent state; setState after unmount (React gate); missing effect cleanup for subscriptions/timers/listeners (React gate); stale closures capturing outdated state.
Heuristics: grep `\.then\(` without `.catch`; async functions called without `await` inside non-async handlers; `setInterval|setTimeout|addEventListener` inside `useEffect` — check the return cleanup; two writes to the same state from separate async paths.

### 3. Error handling
Look for: empty or log-only catch blocks; API calls with no UI error state; missing fallback for unexpected response shape/status; errors that crash instead of surfacing a message.
Heuristics: grep `catch\s*\(\w*\)\s*\{\s*\}` and `catch.*console\.log`; fetch/axios calls — check status handling; global error boundary presence (React gate).
False-positive warning: an intentionally-ignored error with an explanatory comment is not a finding.

### 4. Type safety — GATE: only if the project uses a typed language (TypeScript, etc.)
Look for: `any` bypassing checks; assertions (`as X`, `!`) that can fail at runtime; API return shape vs. declared type mismatches.
Heuristics: grep `: any|as any|as unknown as|!\.|!\)`; compare API client types against actual server responses at one or two boundaries.

### 5. State & data integrity
Look for: client/server state drift; direct mutation instead of setters; derived values recomputed every render without memoization (React gate); missing/incorrect dependency arrays (React gate).
Heuristics: grep `\.push\(|\.splice\(|\.sort\(` on state variables; `useEffect|useMemo|useCallback` — inspect dep arrays against captured variables.

### 6. Security
Look for: user input reaching queries/commands/eval unsanitized; sensitive data logged; hardcoded credentials/tokens; missing auth checks on protected routes/actions.
Heuristics: grep `eval\(|exec\(|query\(.*\+|query\(.*\$\{`; grep `password|token|secret|apiKey|api_key` in source and in `console.log`/logger calls; enumerate routes and check each mutating/protected route for an auth guard.
This category is audited FIRST when prioritizing. Run available SAST/dependency tooling here rather than duplicating it manually.

### 7. Performance
Look for: expensive work inside render without memoization; infinite re-render loops from unstable references in dep arrays (React gate); large lists without virtualization; redundant network requests fired every render.
Heuristics: object/array literals or inline functions passed as deps or props to memoized children; `fetch` inside render or effects with unstable deps; `.map(` over unbounded data in JSX.

### 8. Concurrency & shared state
Look for: shared mutable state touched by multiple async operations without coordination; optimistic UI updates not rolled back on failure.
Heuristics: module-level `let`/mutable singletons written from async functions; read-modify-write sequences spanning an `await`; mutation calls — check the error path restores prior state.

### 9. Dead / unreachable code
Look for: branches unreachable under current type constraints; unused variables; unused imports.
Heuristics: rely on the linter/typechecker output from Phase 0 first; grep for early `return`/`throw` followed by code; conditions on values with narrowed types that make a branch impossible.

### 10. Dependency hygiene
Look for: packages with known vulnerabilities; mismatched peer dependency versions causing silent runtime differences.
Heuristics: use the Phase 0 dependency-audit output; check lockfile for duplicate major versions of the same library (a classic source of "two copies of X" bugs); check peer-dependency warnings on install.

## Phase 2 (ALWAYS) — Triage and report

Record every verified finding with all five fields:
- **(a) File and line**
- **(b) Category** (one of the ten above)
- **(c) Risk description** — including the realistic failure scenario ("if the API omits `user`, the settings page white-screens")
- **(d) Recommended fix**
- **(e) Severity**:
  - **Critical** — data loss, security vulnerability, or crash
  - **High** — user-visible malfunction
  - **Medium** — latent bug (wrong under conditions not yet hit)
  - **Low** — hygiene (dead code, unused deps)

Deliver the report sorted by severity, with a summary table up top. Use the bundled template: `report-template.md` in this skill directory.

**REPORT-ONLY MODE STOPS HERE.** Deliver the report and ask the user which findings (if any) they want fixed. Do not proceed to Phase 3 without approval.

## Phase 3 (CONDITIONAL — audit-and-fix mode, or user approved fixes) — Verified fix loop

For each approved finding, in severity order (Critical first):

1. **Reproduce or demonstrate the defect first**, when feasible: a failing test, a small script, or a documented manual trace showing the bad behavior. If reproduction is infeasible (e.g. a race), document why and what evidence supports the finding.
2. **Apply the minimal fix.** Resist drive-by refactors.
3. **Verify the same probe now passes.**
4. **Run the project's typecheck/lint/test suite** to confirm no regression.

Keep changes reviewable: one fix per finding, or per tight cluster within one category. Never batch unrelated fixes into one opaque change.

## Phase 4 (CONDITIONAL — fixes were applied) — Regression hardening

For each fixed class of bug, make silent recurrence impossible or at least loud:

- **Add or extend automated tests** covering the fixed behavior.
- **Add a durable guard** where the bug class is mechanically detectable: a lint rule, a stricter compiler option (e.g. `noUncheckedIndexedAccess`), a runtime assertion, schema validation at API boundaries, or a CI/validation step.
- If a guard cannot be automated, add a short "watch for" note to the project's README or conventions doc (e.g. replit.md) so the next contributor knows.

Prefer guards over memory — a lint rule outlives everyone's recollection of the bug.

## Phase 5 (ALWAYS) — Acceptance test and handoff

1. Re-run the full verification suite from Phase 0 (typecheck, lint, tests, dependency audit). Output must be clean or every remaining warning explainable.
2. Deliver a final summary:
   - Findings by severity (counts + list)
   - What was fixed vs. deferred
   - What hardening was added
   - Explicit instructions for each deferred item (what to do, why it matters, suggested priority)

In report-only mode, Phase 5 reduces to delivering the Phase 2 report plus confirmation that no code was changed.
