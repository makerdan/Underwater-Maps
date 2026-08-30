# Regression Guard revision package

## Package identity

- **Candidate label:** `P3 — Complete candidate`
- **Package path:** `skill-previews/regression-guard/regression-guard-candidate-2026-08-30.md`
- **Baseline label:** `B0 — Baseline`
- **Canonical source:** `.agents/skills/harden-bug-fixes/SKILL.md`
- **Baseline byte count:** `15474`
- **Baseline MD5:** `698d3b54f1b622e8502373b751ff4265`
- **Baseline SHA-256:** `bc48ada072f47e03d7022589dfbdfa631759d2d04976fee3995ba6b663e44b09`
- **Requested scope:** rename the skill identity and broaden its instructional classification to material security/privacy, data-integrity, concurrency/lifecycle, performance/reliability, and compatibility/contract regression risks; preserve the planning, testing, N/A, deferral, lint, and Failure Gate contracts.
- **Mode:** preview only; no authoritative source, runtime mirror, script, validation configuration, or asset metadata was changed.
- **Proposed destination slug for a later approved apply:** `.agents/skills/regression-guard/SKILL.md`

The baseline below is an exact source snapshot. It is retained as the immutable comparison reference for every candidate and review in this package.

## B0 — Baseline

**Canonical source identity:** `.agents/skills/harden-bug-fixes/SKILL.md`
**Captured before revision:** yes
**Exact identity:** 15,474 bytes; MD5 `698d3b54f1b622e8502373b751ff4265`; SHA-256 `bc48ada072f47e03d7022589dfbdfa631759d2d04976fee3995ba6b663e44b09`

````markdown
---
name: Harden Bug Fixes
description: >-
  Mandates a "## Regression Guard" section in every task plan for bug fixes,
  behavior changes to existing features, and tasks that touch error-handling
  paths. Apply this skill whenever the Planner writes a plan that fixes a bug,
  changes what an existing feature does, or modifies how errors are caught,
  reported, or recovered from — even when the task title doesn't say "bug" or
  "fix". If a task repairs wrong behavior, alters existing behavior, or edits
  an error path, this skill applies; do not skip it just because the change
  looks small. It does NOT apply to purely additive features, pure-hardening
  tasks, DELETE-prefixed tasks, or cosmetic copy edits. Companion to Failure
  Gate: Failure Gate owns "## Pre-existing failures to ignore" and
  "## Validation"; this skill owns "## Regression Guard".
---

# Harden Bug Fixes

A fix without a test is a fix on loan. The bug that shipped once has already
proven the codebase lets it through; unless something now fails when the bug
comes back, a future refactor can silently reintroduce it. This skill closes
that gap by requiring every qualifying plan to say — before implementation
starts — exactly what test will catch a recurrence, where it lives, and what
it asserts.

This is a plan-time obligation on the Planner and an execute-time contract for
the Build agent: the Planner writes the `## Regression Guard` section; the
Build agent delivers the named test (or honors the documented N/A).

---

## Classification

Decide whether a task qualifies before writing its plan. A task is in scope
when it falls into any of these three categories:

1. **Bug fix** — the task repairs behavior that was wrong.
2. **Behavior change** — the task changes what an existing feature does
   (replacing prior behavior, not merely adding alongside it).
3. **Error-handling path** — the task touches code that catches, classifies,
   reports, retries, or recovers from failures.

### Strong-signal trigger keywords and patterns

Treat these as strong signals that the task qualifies (they are indicators,
not an exhaustive list — classify by substance, not keyword match):

- "fix", "broken", "wrong", "incorrect", "regression", "crash", "silently",
  "stale", "doesn't work", "fails to", "should have but didn't"
- "prevent X from happening again", "make sure X no longer..."
- Task descriptions that name a user-visible malfunction or a reproduction
- Changes to `try`/`catch` blocks, error boundaries, fallback branches,
  retry/timeout logic, validation rejects, or error-response shapes

### Explicit exclusions

Do NOT require a Regression Guard for:

- **Pure-hardening tasks** — the task's whole purpose is adding a guard,
  test, lint, or check (see § Self-Satisfying Tasks).
- **Purely additive features** — a new field, option, endpoint, or panel
  where no prior behavior is replaced (see § Behavior Change Threshold).
- **DELETE-prefixed tasks** — tasks marked for deletion are not being built;
  gating them wastes everyone's time.
- **Cosmetic/copy changes in error strings** — rewording an error message
  without changing when or whether it fires is not an error-handling change.

### Materiality threshold

The failure being fixed must have been **observable to a user or have caused
a real malfunction** (wrong data, crash, silent data loss, wrong render,
broken flow). Internal-only nits — a misleading comment, a suboptimal log
line, dead code — do not clear the bar. The point of the guard is to prevent
a *recurrence that matters*; if nothing material ever went wrong, there is no
recurrence to guard against.

---

## Required Section Template

Every qualifying plan must contain a `## Regression Guard` section with
exactly these three fields, all filled with real content:

~~~markdown
## Regression Guard
**Covers:** <what scenario/input triggers the bug — the concrete conditions under which the old behavior went wrong>
**Test location:** <file path of the test that will catch a recurrence>
**What it checks:** <the specific assertion/behavior — what fails if the bug comes back>
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

Some fixes genuinely cannot be guarded by an automated test. In that case,
say so explicitly — never omit the section. Use this format:

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
satisfies the Regression Guard requirement automatically — the deliverable
*is* the guard. Requiring a guard for the guard would recurse forever.

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
task changes existing behavior:

- If the change *replaces* prior behavior — a different default, a corrected
  calculation, a redirected flow — the old behavior could come back in a
  refactor without anything failing. Guard it.
- If the change is **purely additive** — a new field, a new option, a new
  endpoint, a new panel, with no prior behavior replaced — there is no "old
  wrong behavior" to prove gone. Excluded. (Normal test coverage for new
  features is still good practice, but it is not this skill's mandate.)

When in doubt, ask: "if someone reverted just this diff, would a user get
the *old wrong* behavior back, or just lose a new capability?" Old-wrong-back
means guard; capability-lost means additive and excluded.

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
[HARDEN-BUG-FIX] Classification: <bug-fix|behavior-change|error-handling|not-applicable>. Guard: <covered — <test file> | N/A — <reason> | self-satisfying>.
```

Examples:

```
[HARDEN-BUG-FIX] Classification: bug-fix. Guard: covered — artifacts/bathyscan/src/lib/__tests__/terrainGeometry.test.ts.
[HARDEN-BUG-FIX] Classification: error-handling. Guard: N/A — race condition requiring real proxy timing.
[HARDEN-BUG-FIX] Classification: not-applicable. Guard: self-satisfying.
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
````

## Scope and approved expansion

The source is canonical and the baseline identity is unambiguous. The requested
scope explicitly expands the default instructional-text-only scope in the
Skill Compression workflow to include:

1. frontmatter `name` and description trigger metadata;
2. document title and planner-announcement identity;
3. proposed canonical directory slug, recorded for a later apply task only.

The expansion does **not** authorize changing the canonical file, runtime mirror,
mirror fingerprint, lint script, Failure Gate, validation tiers, or unrelated
assets.

## Invariant ledger

| Ledger area | Invariant and B0 evidence | Status in P3 |
|---|---|---|
| Triggers | Bug fix, behavior change, error-handling path; strong signals; new material categories and their strong signals | Explicitly retained and broadened |
| Requirements | Every qualifying plan has a concrete three-field guard; Build agent delivers the named test or honors N/A | Explicitly retained |
| Workflow steps | Classify before plan; section placement; planner announcement before first heading; lint pair order; test runs within selected tier | Explicitly retained |
| Safety and authorization boundaries | Preview by default; no target overwrite before approval; no mirror edits; source of truth remains canonical | Explicitly retained in package/handoff; authoritative write not performed |
| Inputs | Plan task substance, concrete scenario, test location, assertion; accepted follow-up ref for deferral | Explicitly retained |
| Outputs | Regression Guard section, announcement, concrete test/N/A/self-satisfying declaration, lint result, complete preview package | Explicitly retained |
| Exceptions | Valid/invalid N/A reasons, self-satisfying tasks, pure additive and cosmetic exclusions, DELETE exclusion | Explicitly retained |
| Escalation rules | Ask/stop for ambiguous target or unsafe compression; defer only to accepted/active referenced task; do not escalate validation tier | Explicitly retained |
| Tool and file constraints | Canonical source is under `.agents/skills`; `.local/custom_skills` is a derived mirror; lint script remains a separate implementation contract | Explicitly retained |
| Identity metadata | Rename to `Regression Guard`; new announcement prefix and classification vocabulary; proposed slug `regression-guard` | Approved scope expansion |
| Protected integration | Failure Gate owns `## Pre-existing failures to ignore` and `## Validation`; this skill owns `## Regression Guard` | Explicitly retained |
| Domain terminology | Regression Guard, Failure Gate, TASK_PLAN_FILE, `--fix-stub`, `--stubs-only`, N/A, Self-satisfying | Explicitly retained |

No contradiction was found in B0. The phrase “three categories” is an
outdated count once the approved five risk categories are added; P3 changes it
to “any of these categories” rather than hiding the expansion.

## Brainstorm-and-iterate Round 1 — C1

**Review performed against:** B0 and the invariant ledger.

**Applied opportunities:**

- Rename the skill consistently to Regression Guard, including frontmatter,
  title, planner announcement, examples, and self-description.
- Add five material risk categories with concrete descriptions and grouped
  strong-signal vocabulary.
- Keep the existing materiality threshold and add explicit examples of
  protected-data, integrity, lifecycle, resource, and contract consequences.
- Make the additive-feature boundary explicit for new endpoints and contracts.
- Retain the existing templates, N/A protocol, deferral rule, lint behavior,
  layer rule, and Failure Gate composition with only identity wording changed.

**Rejected ideas:**

- Replace the three required template fields with one free-form “test plan”
  field — rejected because it would weaken mechanical linting and concrete
  reviewability.
- Treat every security, performance, or compatibility addition as qualifying —
  rejected because it would violate the requested selective boundary for
  purely additive work.
- Move lint implementation requirements into this revision — rejected because
  the task explicitly keeps `scripts/check-regression-guard.mjs` out of scope.

**C1 result:** Safe broadened candidate retained for Round 2. Every B0
requirement remained represented; candidate comparisons are recorded below.

## Brainstorm-and-iterate Round 2 — C2

**Review performed independently against:** B0, C1, and the invariant ledger.

**Applied iterations:**

- Separate the five new categories from the original bug/behavior/error
  categories so a reader can classify by substance instead of keywords alone.
- Add trigger examples for privacy boundaries, protected data, corruption and
  stale writes, races and resource cleanup, resource exhaustion and degraded
  service, and existing public contracts.
- State that a new endpoint or contract is still additive when it does not
  replace or alter existing behavior.
- Preserve exact force words such as “must,” “never,” “only,” and “always.”

**Rejected ideas:**

- Replace the detailed category triggers with a single “high-risk change”
  label — rejected because security/privacy and contract risks could be
  inferred away.
- Merge the five categories into the error-handling category — rejected because
  data exposure, corruption, lifecycle leaks, and compatibility breaks do not
  necessarily catch or recover from an error.
- Add a new N/A reason for performance or compatibility testing difficulty —
  rejected because the baseline's valid N/A list is intentionally narrow and
  expensive testing is not impossibility.

**C2 result:** Strongest candidate retained. The only expected metadata changes
are the approved identity expansion; no implementation or mirror behavior was
changed.

## Pass 1 — P1: Remove redundancy

**Comparison:** C2 against B0 and the immediately preceding candidate.

Removed duplicated category explanations and consolidated the new trigger
signals into a single structured list. Kept the examples that distinguish
material risk from additive capability. Kept every original template,
exception, placement, lint, and Failure Gate passage where combining it would
hide precedence or weaken a boundary.

**Rejected shorter alternative:** One paragraph covering all five categories
was shorter but obscured which signals map to which risk and was therefore
rejected.

**Ledger coverage:** All areas remain covered; no invariant interpretation
changed.

**P1 result:** Accepted as a reviewed reduction.

## Pass 2 — P2: Clarify decision boundaries

**Comparison:** P1 against B0 and the immediately preceding candidate.

Clarified “material” for the five categories, distinguished existing-contract
changes from a purely additive new endpoint, and made multi-category
classification and strong signals executable. Preserved the requirement that
classification is by substance, not keyword match. Kept the existing valid N/A
list and accepted-reference deferral rule rather than broadening exceptions.

**Rejected shorter alternative:** “Guard all risky changes” was rejected
because “risky” has no observable threshold and would pull additive and
cosmetic work into scope.

**Ledger coverage:** Triggers, exceptions, escalation, safety, and outputs were
made more explicit; all other entries remain unchanged.

**P2 result:** Accepted as a clarity improvement.

## Pass 3 — P3: Polish language and ordering

**Comparison:** P2 against B0 and the immediately preceding candidate.

Applied parallel category wording, ordered each category as material condition
then examples, and kept the existing skill workflow order. The final candidate
is complete below. No requirement was turned into a suggestion, and no count,
gate, or handoff was changed.

**Rejected shorter alternative:** Remove repeated “must/never/only” language
where the surrounding paragraph seemed clear; rejected because those words
carry the authorization and adherence force of the contract.

**Ledger coverage:** Complete; P3 retains the strongest safe wording.

**P3 result:** Accepted. This is not a Pass 3 no-op.

## Adversarial acceptance checks

1. **Concise target**
   - **Scenario:** A future agent reads only the classification and required
     section portions of the candidate.
   - **Ledger entries:** Triggers, requirements, workflow, outputs, exceptions.
   - **Result:** Pass. The candidate states all eight qualifying categories,
     the materiality threshold, exclusions, exact three fields, placement,
     N/A/self-satisfying paths, and the planner/build obligations.
   - **Action:** Retained explicit category and exclusion wording rather than
     using a shorter generic “regression risk” phrase.

2. **Safety-sensitive target**
   - **Scenario:** A task changes authorization, tenant isolation, PII
     handling, secret exposure, retention, or redaction in an existing flow.
   - **Ledger entries:** Triggers, materiality, safety/authorization,
     specificity, Failure Gate composition.
   - **Result:** Pass. Security/privacy is a named material category with
     strong signals, and the guard remains required when an existing boundary
     could regress. Approval and mirror protections remain explicit.
   - **Action:** Retained concrete privacy and authorization signals.

3. **Procedural target**
   - **Scenario:** An agent executes a qualifying plan with a named test, or
     runs the lint pair with TASK_PLAN_FILE set.
   - **Ledger entries:** Workflow, inputs, outputs, tool/file constraints.
   - **Result:** Pass. The exact template, section order, announcement,
     accepted-ref requirement, layer rule, `--fix-stub` then strict order, and
     single-file scope remain executable.
   - **Action:** Retained exact flag names and “always/only” wording.

4. **Exception-heavy target**
   - **Scenario:** A visual race, unmockable upstream behavior, removed
     feature, pre-mandate archive, or genuinely deferred test is encountered.
   - **Ledger entries:** Exceptions, escalation, outputs.
   - **Result:** Pass. Valid N/A reasons, invalid vague N/A reasons,
     self-satisfying declarations, accepted follow-up refs, and grandfathered
     stubs remain distinct.
   - **Action:** Rejected a broader “too hard to test” exception.

5. **Contradictory target**
   - **Scenario:** The old “three categories” wording conflicts with the
     approved addition of five more categories.
   - **Ledger entries:** Triggers, identity metadata, unresolved findings.
   - **Result:** Pass. The inconsistency is surfaced in the ledger and resolved
     narrowly by changing the count to “any of these categories,” not by
     silently dropping the old categories or hiding the expansion.
   - **Action:** Recorded the wording finding and retained the explicit
     category list.

6. **Domain-specific target**
   - **Scenario:** A reader applies `TASK_PLAN_FILE`, `--fix-stub`,
     `--stubs-only`, Failure Gate, or the `## Regression Guard` contract.
   - **Ledger entries:** Domain terminology, tool/file constraints,
     protected integration.
   - **Result:** Pass. Canonical paths, flags, headings, task-state terms,
     and Failure Gate ownership remain precise and are not generalized away.
   - **Action:** Retained all necessary project-neutral contract terms.

All six checks pass. No stop condition was triggered after P3.

## Final Review A — semantic fidelity

**Order:** Completed before general-language review.

Compared P3 with B0, the invariant ledger, and all adversarial findings.
Every original trigger, requirement, workflow step, boundary, input, output,
exception, escalation rule, tool constraint, and file constraint remains
present with the same force. The five approved material-risk categories and
their strong signals are added without making purely additive, cosmetic,
DELETE-prefixed, or genuinely non-material internal work qualify. The required
N/A, self-satisfying, accepted-follow-up, layer-appropriate test, lint, and
Failure Gate contracts are intact.

**Result:** Pass. No invariant is weaker, missing, ambiguous, or contradicted.

## Final Review B — general language

Removed accidental identity tied to the former skill name from the candidate,
while retaining necessary project-specific terms such as Failure Gate,
TASK_PLAN_FILE, and the named lint script. The candidate does not assume a
framework, provider, or runtime beyond the contracts already present in B0.
The source rename and proposed slug are surfaced as handoff metadata rather than
silently applied.

**Result:** Pass. No unnecessary workspace-specific framing was introduced.

## P3 — Complete candidate

````markdown
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
````

## Concise diff from B0

### Accepted meaningful changes

1. **Identity rename:** frontmatter `name` and document title change from
   `Harden Bug Fixes` to `Regression Guard`; the planner announcement prefix
   changes from `[HARDEN-BUG-FIX]` to `[REGRESSION-GUARD]`; examples and
   self-references use the new identity.
2. **Frontmatter trigger expansion:** the description now names material
   security/privacy, data-integrity, concurrency/lifecycle,
   performance/reliability, and compatibility/contract changes.
3. **Classification expansion:** five new material categories define the
   affected boundary and concrete failure modes.
4. **Strong signals:** each new category has its own signal list, while the
   original malfunction and error-path signals remain.
5. **Selective materiality:** “material” is defined for the five categories;
   new independent endpoints/contracts and non-material internal changes remain
   excluded.
6. **Behavior threshold:** existing security boundaries, data rules,
   lifecycle guarantees, resource/reliability properties, and contracts are
   explicitly treated like replaced behavior; capability-only additions remain
   excluded.
7. **Planner announcement:** the exact classification vocabulary now supports
   the new categories and explicitly allows comma-separated classifications.
8. **Clarity and scanability:** category wording is parallel and ordered;
   unchanged operational contracts are retained verbatim or near-verbatim.

### Protected metadata and out-of-scope content

- Canonical source contents were not changed.
- `.local/custom_skills/` and all fingerprints were not changed.
- `scripts/check-regression-guard.mjs` was not changed.
- Failure Gate, validation tiers, and unrelated skills were not changed.
- `.agents/agent_assets_metadata.toml` was not changed.
- The proposed directory slug is recorded only as a later handoff:
  `regression-guard`.

## Unresolved risks and findings

- The canonical directory rename will require a separately approved apply task
  and a later platform environment refresh for the new runtime mirror; this
  package intentionally does not perform either action.
- Existing references outside the candidate to `harden-bug-fixes` may need a
  separate inventory during the approved apply task. No such reference was
  rewritten here because that would exceed preview scope.
- The current lint script is intentionally not expanded to mechanically detect
  the five semantic categories; the candidate defines the planning contract,
  while script behavior remains out of scope.
- Strong keywords remain indicators rather than an exhaustive classifier.
  The materiality and substance rules are retained to prevent keyword-only
  boilerplate.
- A task can cross multiple categories. P3 makes comma-separated
  classifications explicit but does not require one guard per category; the
  existing one concrete guard section remains the contract.

No unresolved wording contradiction remains after the narrow “three
categories” → “any of these categories” correction recorded in the ledger.

## Recommendation

**Apply** after explicit user approval of the exact candidate label
`P3 — Complete candidate` and a separate approval-gated apply task. All six
adversarial checks and both final-review stages pass; the candidate preserves
the existing contracts while adding the requested selective risk coverage.
Until that approval is received, retain the canonical
`.agents/skills/harden-bug-fixes/SKILL.md` unchanged.

## Required change list

### Accepted changes

- Rename the skill identity to Regression Guard consistently in the candidate.
- Add five material regression-risk categories with concrete definitions and
  strong-signal triggers.
- Clarify materiality and the additive-feature boundary.
- Expand the planner classification vocabulary, including multi-category use.
- Keep all existing plan, test, N/A, self-satisfying, accepted-follow-up,
  layer, lint, and Failure Gate requirements.

### Materially shorter rejected alternatives

- A generic “high-risk change” category weakened category-specific triggers and
  safety/privacy recognition.
- One free-form guard field weakened mechanical validation and reviewability.
- A universal requirement for all security/performance/compatibility additions
  violated the additive and selective scope boundary.
- A wider “hard to test” N/A exception would turn cost into impossibility.
- Removing force words such as “must,” “never,” and “only” weakened adherence.

### Retained wording

- The three exact guard fields and their placement were retained because the
  lint script and reviewer workflow depend on them.
- Valid and invalid N/A reasons were retained because the baseline intentionally
  distinguishes impossibility from expense.
- Self-satisfying and accepted non-PROPOSED follow-up rules were retained to
  prevent recursive guards and unowned deferrals.
- Layer-appropriate test guidance, TASK_PLAN_FILE scoping, lint ordering, and
  Failure Gate ownership were retained because they are executable contracts.
- Domain terms and exact script flags were retained because generalizing them
  would make the instructions less actionable.

### Unresolved wording and findings

- The later apply task must inventory and update external identity references;
  this preview does not guess at those files.
- The platform-managed new mirror is created/refreshed outside this preview
  after the approved canonical rename.
- The lint script does not classify the new semantic categories mechanically;
  changing it is explicitly out of scope.

### Scope and source status

- **Authoritative source used:** `.agents/skills/harden-bug-fixes/SKILL.md`
- **Scope applied:** preview candidate only, with explicitly approved identity,
  trigger, title, announcement, and proposed-slug expansion.
- **Source status:** canonical source remains unchanged and B0 remains immutable.
- **Mirrors/status:** `.local/custom_skills/` and fingerprints remain untouched.
- **Other surfaces:** scripts, Failure Gate, validation tiers, and asset metadata
  remain untouched.

## Apply-task handoff

Create a separate **PROPOSED** apply task only after this package passes
read-back verification. The apply task must:

1. name the exact candidate label `P3 — Complete candidate`;
2. point to this exact package path;
3. identify B0 by canonical path, byte count, MD5, and SHA-256;
4. re-read `.agents/skills/harden-bug-fixes/SKILL.md` and compare it with B0
   before writing;
5. stop and regenerate/review a new candidate if the canonical source changed;
6. apply only the approved candidate scope, including the destination slug
   `.agents/skills/regression-guard/SKILL.md`;
7. leave `.local/custom_skills/` and fingerprints to platform sync; never edit
   them manually; and
8. re-read the applied source and verify it matches the approved candidate
   before reporting success.

**Exact handoff:** candidate `P3 — Complete candidate`; package
`skill-previews/regression-guard/regression-guard-candidate-2026-08-30.md`;
canonical source `.agents/skills/harden-bug-fixes/SKILL.md`; baseline
`15474 bytes / MD5 698d3b54f1b622e8502373b751ff4265 / SHA-256
bc48ada072f47e03d7022589dfbdfa631759d2d04976fee3995ba6b663e44b09`;
proposed destination slug `regression-guard`.

## Read-back verification record

This record is completed after the package is written:

- [x] Package path is tracked and outside `.local/`, temporary directories,
  ignored runtime mirrors, and the canonical target.
- [x] Package exists and is readable.
- [x] The complete candidate appears under the exact `P3 — Complete candidate`
  label.
- [x] The package read back byte-for-byte with the just-written content.
- [x] The package contains B0, the ledger, meaningful diffs, risks/findings,
  rejected alternatives, recommendation, all five required change-list
  categories, exact handoff, two brainstorm rounds, three ordered passes, six
  adversarial checks, and both final-review stages.
- [x] No canonical skill or runtime mirror was modified before approval.
