---
name: Regression Guard
description: >-
  Requires a "## Regression Guard" section in every task plan for material bug
  fixes, behavior changes to existing features, error-handling changes, and
  material security/privacy, data-integrity, concurrency/lifecycle,
  performance/reliability, or compatibility/contract changes. Apply this skill
  whenever the Planner writes a plan that fixes a malfunction, replaces
  existing behavior, changes an error path, or materially changes a boundary,
  data flow, concurrent lifecycle, resource/reliability behavior, or existing
  contract — even when the task title does not use a strong-signal keyword.
  Classify by substance, not keyword match. It does NOT apply to purely
  additive features, pure-hardening tasks, DELETE-prefixed tasks,
  cosmetic/copy-only edits, or genuinely non-material internal changes.
  Companion to Failure Gate: Failure Gate owns "## Pre-existing failures to
  ignore" and "## Validation"; this skill owns "## Regression Guard".
---

# Regression Guard

A fix without a test is a fix on loan. The failure that shipped once has
already proven the codebase lets it through; unless something now fails when
the failure comes back, a future refactor can silently reintroduce it. The same
risk applies when an existing security/privacy boundary, data invariant,
concurrent lifecycle, performance/reliability property, or compatibility
contract is materially changed: without a guard, the old failure can return
without detection. This skill closes that gap by requiring every qualifying
plan to say — before implementation starts — exactly what test will catch a
recurrence, where it lives, and what it asserts.

This is a plan-time obligation on the Planner and an execute-time contract for
the Build agent: the Planner writes the `## Regression Guard` section; the Build
agent delivers the named test (or honors the documented N/A).

---

## Classification

Decide whether a task qualifies before writing its plan. A task is in scope
when it falls into any of these categories:

1. **Bug fix** — the task repairs behavior that was wrong.
2. **Behavior change** — the task changes what an existing feature does
   (replacing prior behavior, not merely adding alongside it).
3. **Error-handling path** — the task touches code that catches, classifies,
   reports, retries, or recovers from failures.
4. **Material security/privacy change** — the task changes an existing
   authorization, access-control, tenant-isolation, protected-data, secret,
   redaction, retention, exposure, or privacy boundary in a way that could
   expose, retain, or disclose data incorrectly.
5. **Material data-integrity change** — the task changes existing validation,
   persistence, transformation, synchronization, migration, idempotency, or
   atomicity behavior in a way that could lose, corrupt, duplicate, stale, or
   misassociate data.
6. **Material concurrency/lifecycle change** — the task changes existing
   scheduling, locking, shared state, cancellation, retry coordination,
   cleanup, disposal, shutdown, worker, queue, or resource-lifecycle behavior
   in a way that could race, deadlock, leak, double-run, or strand work.
7. **Material performance/reliability change** — the task changes existing
   caching, timeout, backpressure, resource-use, availability, throughput,
   latency, memory, CPU, or degraded-service behavior in a way that could
   regress an existing workflow or exhaust resources.
8. **Material compatibility/contract change** — the task changes an existing
   API, schema, wire format, serialization, configuration, storage, migration,
   public type, or supported-client contract in a way that could break existing
   consumers or persisted data.

The word **material** means that an existing user, workflow, protected-data
boundary, data invariant, resource/lifecycle property, or supported contract
could be observably harmed. A new endpoint, option, field, or contract that
does not replace or alter existing behavior remains purely additive and is
excluded under § Explicit exclusions.

### Strong-signal trigger keywords and patterns

Treat these as strong signals that the task qualifies (they are indicators,
not an exhaustive list — classify by substance, not keyword match):

- General malfunction signals: "fix", "broken", "wrong", "incorrect",
  "regression", "crash", "silently", "stale", "doesn't work", "fails to",
  "should have but didn't", "prevent X from happening again", "make sure X
  no longer...", or a task description naming a user-visible malfunction or
  reproduction.
- **Security/privacy signals:** "auth", "authorization", "permission",
  "access control", "tenant isolation", "PII", "personal data", "secret",
  "redact", "exposure", "disclosure", "retention", "privacy", "encryption",
  "CORS", or a change to who can read, write, retain, or receive data.
- **Data-integrity signals:** "data loss", "corruption", "duplicate",
  "wrong record", "stale overwrite", "integrity", "validation", "migration",
  "schema", "idempotency", "atomic", "consistency", "reconciliation", or a
  change to persistence or transformation semantics.
- **Concurrency/lifecycle signals:** "race", "deadlock", "lock",
  "concurrent", "cancellation", "abort", "cleanup", "dispose", "close",
  "shutdown", "worker", "queue", "lifecycle", "double-run", "stranded", or a
  change to shared state, scheduling, or resource ownership.
- **Performance/reliability signals:** "timeout", "latency", "slow",
  "memory", "CPU", "OOM", "leak", "backpressure", "throughput", "availability",
  "degraded", "flaky", "retry", "cache", "capacity", or a change that can
  exhaust resources or regress service under load.
- **Compatibility/contract signals:** "breaking", "backwards compatibility",
  "API", "wire format", "serialization", "public type", "supported client",
  "config", "storage format", "migration", "schema", "version", or a change
  to an existing consumer-facing or persisted contract.
- Changes to `try`/`catch` blocks, error boundaries, fallback branches,
  retry/timeout logic, validation rejects, or error-response shapes.

### Explicit exclusions

Do NOT require a Regression Guard for:

- **Pure-hardening tasks** — the task's whole purpose is adding a guard,
  test, lint, or check (see § Self-Satisfying Tasks).
- **Purely additive features** — a new field, option, endpoint, panel, or
  contract where no prior behavior or existing contract is replaced or altered
  (see § Behavior Change Threshold).
- **DELETE-prefixed tasks** — tasks marked for deletion are not being built;
  gating them wastes everyone's time.
- **Cosmetic/copy changes in error strings** — rewording an error message
  without changing when or whether it fires is not an error-handling change.
- **Genuinely non-material internal changes** — a misleading comment, a
  suboptimal log line, dead code, or an internal refactor that cannot affect an
  existing user, workflow, protected-data boundary, data invariant,
  resource/lifecycle property, or supported contract.

### Materiality threshold

The failure being fixed, or the changed property at risk, must have been
**observable to a user, caused a real malfunction, or created a material risk**
of wrong data, data loss or corruption, unauthorized exposure, broken
compatibility, a concurrency/lifecycle failure, resource exhaustion, service
degradation, crash, wrong render, or broken flow. Internal-only nits that
cannot affect one of those properties do not clear the bar. The point of the
guard is to prevent a *recurrence that matters*; if no material failure or
material regression risk exists, there is no recurrence to guard against.

---

## Required Section Template

Every qualifying plan must contain a `## Regression Guard` section with
exactly these three fields, all filled with real content:

~~~markdown
## Regression Guard
**Covers:** <the concrete scenario/input, boundary, invariant, lifecycle, reliability property, or contract whose old failure or material regression must not return>
**Test location:** <file path of the test that will catch a recurrence>
**What it checks:** <the specific assertion/behavior — what fails if the old failure or material regression comes back>
~~~

Place the section after `## Pre-existing failures to ignore` and
`## Validation` (which Failure Gate owns), before `## Relevant files`.

**Example — compliant `## Regression Guard`:**

~~~markdown
## Regression Guard
**Covers:** Loading a dataset whose grid has all-land rows (depth ≥ 0 everywhere) — the old clamp flattened the entire mesh to Y=0, rendering it invisible.
**Test location:** artifacts/bathyscan/src/lib/__tests__/terrainGeometry.test.ts
**What it checks:** Asserts that a grid containing positive-down land values produces a mesh with non-zero Y relief, and that `Math.max(depth, 0)` (not `Math.min`) is applied at the land clamp — the test fails if the clamp direction ever flips back.
~~~

Each field earns its place: **Covers** pins down the reproduction so the test
author knows what input to construct; **Test location** makes the deliverable
concrete and reviewable; **What it checks** prevents a vacuous test that
exercises the code path without asserting the fixed behavior.

---

## N/A Protocol

Some qualifying changes genuinely cannot be guarded by an automated test. In
that case, say so explicitly — never omit the section. Use this format:

~~~markdown
## Regression Guard
**N/A**
**Why N/A:** <specific reason from the valid list below, with enough detail to verify it applies>
~~~

**Example — compliant N/A declaration:**

~~~markdown
## Regression Guard
**N/A**
**Why N/A:** The fix addresses a race between the WebSocket reconnect timer and the Replit proxy's 30-second idle drop. Reproducing it requires real wall-clock proxy timing that fake timers cannot simulate and the test environment's proxy does not exhibit; there is no deterministic way to assert the race is gone.
~~~

### Valid N/A reasons

- **Race condition requiring real timing** — the bug only manifests under
  genuine wall-clock concurrency that fake timers or deterministic test
  harnesses cannot reproduce.
- **Unmockable external API behavior** — the failure depends on a live
  third-party service behaving in a way that cannot be faithfully mocked
  (e.g., an upstream endpoint's undocumented drift).
- **Visual regression with no screenshot infra** — the bug is purely visual
  and the project has no screenshot/pixel-diff infrastructure to assert
  against.
- **Fix removes the feature entirely** — there is no behavior left to guard;
  the code path is gone.

### Invalid N/A reasons

These do not clear the bar and make the section non-compliant:

- **Vague "hard to test"** — difficulty is a cost, not an impossibility.
  If a test is possible but expensive, either write it or defer it via the
  Follow-Up Task Middle Path.
- **Citing existing coverage without naming the test** — "this is already
  covered" is only acceptable when the claim names the specific test file
  and assertion. An unnamed claim is unverifiable and usually wrong.
- **Deferring to a follow-up task without a named accepted ref** — "we'll
  test it later" is prohibited unless the deferral meets both conditions in
  § Follow-Up Task Middle Path.

---

## Self-Satisfying Tasks

A task whose **primary deliverable is itself a test or guard script**
satisfies the Regression Guard requirement automatically — the deliverable *is*
the guard. Requiring a guard for the guard would recurse forever.

Mark such plans as **Self-satisfying**:

~~~markdown
## Regression Guard
**Self-satisfying** — this task's deliverable is the regression test/guard itself (<name the test or script>).
~~~

This applies to: tasks that add a test for an existing bug, tasks that write
a lint/check script, tasks that add a CI guard, and confirm-and-harden tasks
whose whole purpose is verification. It does not apply to tasks that merely
*include* a test alongside a production-code change — those follow the
normal template, naming that test.

---

## Behavior Change Threshold

Hardening is required only when **the old (wrong) behavior needs to be
proven gone or could silently revert**. That is the test to apply when a
task changes existing behavior or an existing material risk boundary:

- If the change *replaces* prior behavior — a different default, a corrected
  calculation, a redirected flow, a changed access boundary, a new
  persistence/consistency rule, a changed lifecycle guarantee, a changed
  resource/reliability property, or a changed existing contract — the old
  wrong or unsafe behavior could come back in a refactor without anything
  failing. Guard it.
- If the change is **purely additive** — a new field, a new option, a new
  endpoint, a new panel, or a new independent contract, with no prior
  behavior or existing contract replaced or altered — there is no "old wrong
  behavior" to prove gone. Excluded. (Normal test coverage for new features
  is still good practice, but it is not this skill's mandate.)

When in doubt, ask: "if someone reverted just this diff, would a user get the
old wrong or unsafe behavior back, would an existing workflow or contract
break, or would they just lose a new capability?" Old-wrong-back,
unsafe-boundary-back, existing-risk-back, or contract-break-back means guard;
capability-lost means additive and excluded.

---

## Follow-Up Task Middle Path

Sometimes the right test is real but too large for the current task (needs
new fixtures, new harness capability, a new test layer). Deferring the
hardening step to a follow-up task is allowed only when **both** conditions
hold at plan-write time:

1. **The task ref is explicitly listed in the plan** — a concrete ref number
   (e.g. "deferred to task #4102"), not "a follow-up task will be created".
2. **That task is in a non-PROPOSED state (accepted/active)** — a PROPOSED
   draft can be deleted in triage without anyone noticing the guard vanished
   with it. Only a task the project has committed to counts.

Deferral without a tracked ref is explicitly prohibited. The failure mode
this prevents is well known: "we'll harden it later" with no tracked owner
means never. Format:

~~~markdown
## Regression Guard
**Covers:** <scenario as usual>
**Test location:** Deferred to task #<ref> (accepted) — <one line on why the test can't land in this task>
**What it checks:** <the assertion the follow-up task will implement>
~~~

---

## Planner Announcement

Before writing the first heading of any plan, emit this exact line in your
response:

```
[REGRESSION-GUARD] Classification: <bug-fix|behavior-change|error-handling|security-privacy|data-integrity|concurrency-lifecycle|performance-reliability|compatibility-contract|not-applicable>. Guard: <covered — <test file> | N/A — <reason> | self-satisfying>.
```

Use one or more applicable classifications when a task crosses categories,
separating them with commas.

Examples:

```
[REGRESSION-GUARD] Classification: bug-fix. Guard: covered — artifacts/bathyscan/src/lib/__tests__/terrainGeometry.test.ts.
[REGRESSION-GUARD] Classification: security-privacy. Guard: covered — server/auth.test.ts.
[REGRESSION-GUARD] Classification: data-integrity, concurrency-lifecycle. Guard: covered — server/sync.test.ts.
[REGRESSION-GUARD] Classification: error-handling. Guard: N/A — race condition requiring real proxy timing.
[REGRESSION-GUARD] Classification: not-applicable. Guard: self-satisfying.
```

This creates a visible, searchable audit trail in the conversation, the same
way Failure Gate's `[FAILURE-GATE]` line does. A qualifying plan written
without this line was not classified — and unclassified plans are exactly
where guardless fixes slip through.

---

## Lint Integration

The mechanical enforcement lives in a sibling script,
`scripts/check-regression-guard.mjs`, which scans plan files and verifies
`## Regression Guard` compliance. It supports three operating modes,
mirroring the Failure Gate lint guard:

- **Strict (default)** — Scans plan files for a compliant
  `## Regression Guard` section (template fields filled, or a valid N/A /
  Self-satisfying declaration). Reports every violation and exits 1. This is
  the formal CI gate.
- **`--fix-stub`** — For any qualifying plan file missing the section,
  inserts a stub with placeholder fields. Cannot classify tasks or fill in
  real content — that requires the Planner. Always exits 0; a no-op when all
  files are compliant, so it is safe to run unconditionally.
- **`--stubs-only`** — Checks only for unfilled placeholders in existing
  `## Regression Guard` sections, skipping the missing-section check. Use
  this to grandfather an archive of older plan files that predate the
  mandate without permanently breaking CI.

The three modes above control *strictness*. The following is an orthogonal
*scope* requirement that every implementation of this guard must also satisfy:

**Single-file scoping** — When the `TASK_PLAN_FILE` environment variable is
set, the guard must operate on the single file it names rather than scanning
the full plan archive. Two hard errors apply: (a) if the named path does not
end in `.md`, exit 1 with a clear diagnostic; (b) if the named path does not
exist, exit 1 with a clear diagnostic. This prevents the archive-wide scan
from breaking on pre-mandate files that are gitignored and do not propagate
between environments. Both guard scripts in a project (the failure-gate guard
and this regression-guard script) must honour `TASK_PLAN_FILE` consistently,
so the agent receives a uniform contract regardless of which script runs first.

Wire the script into the project's validation runner as an
**auto-remediate + strict-check pair**, exactly matching how
`scripts/check-failure-gate.mjs` is wired: run `--fix-stub` unconditionally
first (always exits 0, inserts missing stubs), then run strict mode, which
now only fires on genuinely unfixable issues — unfilled placeholders and
malformed declarations that need a human. This ordering means a missing
section is repaired rather than merely reported, and CI red always means
"a decision is needed", never "a stub is needed". When `TASK_PLAN_FILE` is
set, scope the `--fix-stub` pass to that single file as well — this prevents
a needless archive-wide rewrite on every task run and keeps the fix-stub step
touching only the file the current task actually owns.

(Writing `scripts/check-regression-guard.mjs` is a separate implementation
task; this skill defines the contract it must satisfy.)

---

## Specificity Rule

A `## Regression Guard` section is **non-compliant** if any required field
contains placeholder text (e.g. `<what scenario...>`, `<FILL IN>`, `TBD`) or
is absent entirely. Half-filled sections are worse than missing ones — they
look done and get skipped in review.

Additionally, the named test layer must match the layer where the fix lives:

- A backend route fix names a backend unit/integration test, not a frontend
  component test.
- A frontend store bug names a frontend test, not an API test.
- A cross-layer flow bug (client sends → server rejects → client shows
  error) names the layer where the *wrong behavior* occurred, or an e2e test
  when the bug only manifests across the boundary.

A guard in the wrong layer passes today and keeps passing while the bug
returns in the layer it actually lived in — it provides the feeling of
coverage without the fact of it.

---

## Interaction With Failure Gate

This skill is **additive** to Failure Gate, not competing with it:

- **Failure Gate owns** `## Pre-existing failures to ignore` and
  `## Validation`. It governs which failures to ignore and which tier to
  run. This skill does not replace, modify, or reinterpret either section.
- **This skill owns** `## Regression Guard`. It governs what new test must
  exist so the fixed failure cannot silently return.

The two compose in one plan: Failure Gate tells the Build agent what noise
to filter out and what ceiling to validate at; this skill tells it what
signal to add. A plan for a qualifying task carries all three sections. The
regression test named here runs inside whatever tier the plan's
`## Validation` section already selects — this skill never changes the tier,
and adding a regression test is never a reason to escalate past the plan's
ceiling.
