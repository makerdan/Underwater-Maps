---
name: failure-gate-v4
description: >-
  Implement or operate project-neutral, task-ID-based validation controls.
  Discover host capabilities, assign one authorized tier per task, prevent
  unintended tier changes, classify failures using provenance, and require
  applicable recorded validation for completion. Use for task planning,
  task-driven validation, baseline ownership, or Failure Gate installation.
---

# Failure Gate v4

## Purpose and boundary

Separate three decisions: which tier a task may run, who owns each failure, and
whether recorded validation applies to the work being completed.

This skill defines a project-tooling contract; installing it does not install
the runner, registry, or a platform permission. Never announce a lock,
approval, test result, or completion check that has not actually occurred.

Use one declared enforcement mode:

- **Workflow:** checked entry points and completion checks prevent accidental
  escalation. An agent with unrestricted shell/write access could bypass or alter
  them. Record that limitation; do not claim tamper-proof enforcement.
- **Protected:** an independently protected service controls authorization,
  execution, evidence, and completion acceptance. Task code cannot change its
  governing policy or approve itself. Claim this only after verifying the boundary.

The practical default is workflow enforcement. Direct, unofficial test runs
cannot satisfy gated completion; denying arbitrary shell execution is a separate
protected-executor capability.

## 1. Discover, then install or operate

Discover the host's canonical instructions, languages/runtimes, operating system,
build and validation commands, plan/task format, baseline storage, persistence,
and available completion checks. No framework, package manager, database, cloud,
CI provider, task service, or preinstalled companion skill is required.

Map the semantic contract to verified host interfaces in a capability manifest.
All example names, paths, tiers, and commands are illustrative, not dependencies.
Use existing equivalents rather than introducing a second project structure.
On hosts using `.agents`, keep canonical skill sources there; other instruction
files such as `replit.md` are discovery candidates only when present.

Classify each required capability as present, missing, or unavailable. Do not
assume named scripts or platform APIs exist. Read
[implementation.md](reference/implementation.md) for installation or changes to
enforcement; read [acceptance.md](reference/acceptance.md) when validating them.

- **Operate:** use verified host commands and interfaces.
- **Install:** implement the missing pieces only when installation is requested;
  preserve existing validation coverage and update canonical sources, not mirrors.
- **Unavailable:** report the exact blocker. Do not invent infrastructure or
  silently downgrade an already active gate.

Documentation-only authoring and non-project conversation are not project
validation runs. For project tasks, use the registered docs/no-op tier only when
its policy explicitly covers the work; never invent a passing validation result.
Keep deliverables outside `.local/`. Disposable archives are not durable plans.

## 2. Core invariants

- One stable authoritative task ID has one active authorized tier. All other tiers are denied
  by default; do not maintain redundant per-tier deny lists.
- The authoritative task record binds the canonical plan digest, tier-definition
  digest, permitted execution parameters, policy version, and authorization version.
- Each run separately binds the actual tested snapshot and relevant environment.
  Ordinary code edits do not require new tier authorization, but invalidate
  affected prior run evidence.
- A tier name is insufficient: changed commands, configuration, required steps,
  or coverage require policy review and affected authorization renewal.
- Missing, malformed, stale, conflicting, suspended, or terminal authorization
  fails closed. Never substitute a lighter or heavier tier.
- A task may not approve its own tier change, waive its owned repairs, broaden
  baselines, or silently modify governing enforcement.
- A caller-supplied task ID or plan is not proof of task identity. Bind validation
  and completion to the independently resolved active task and project namespace;
  reject another task's valid ID/plan as well as invalid plans.
- The governing runner, tier definitions, checker, and completion adapter are
  policy inputs. A task's edits to them cannot authorize or validate that same
  task under the changed policy without independent acceptance.
- Failure classification never changes tier authorization.
- A retry pass establishes intermittency, not pre-existing provenance.

## 3. Plan and activate

Use the host's authoritative task-identity flow: reserve an ID if its allocator
supports reservation, or create a non-authorizing provisional draft reference if
the task service assigns an ID only after draft creation. The provisional reference
cannot launch validation or approve a plan. Bind it atomically at activation to
the independently assigned task ID, approved plan and version, authorization,
and audit event. Do not invent approval or create a competing allocator.
Read available project memory,
recent task evidence, and the discovered baseline catalog. Missing optional memory
or history is not a setup failure. No catalog means no catalog-authorized ignores;
it does not by itself prevent validation or evidence-based task-local classification.
Select the lightest registered tier covering the task; if coverage is uncertain,
use the project's defined selection policy, not an invented “middle” tier.

Capture a pre-edit baseline observation when the approved host policy requires it
for the affected behavior or risk, whether frontend, backend, native, embedded,
data, infrastructure, or another project type. Use the explicit planning capability,
not an active task lock. Do not run destructive, production-affecting, hardware,
or costly external checks without their necessary authorization and safe environment.
Run scaffold/plan guards through their separate planning capability. These
bounded capabilities exist before activation and cannot satisfy task completion.
If a required route is missing, report blocked setup.

Use the host scaffold once verified. The following Markdown illustrates required
semantic fields; structured task records and other formats may map equivalent
fields through a validated adapter rather than adopting these exact headings:

```markdown
## Task identity
**Task ID:** `TASK-001042` (authoritative ID once assigned; before assignment, a non-authorizing draft reference)

## Pre-existing failures to ignore
None known at plan time. Treat new failures as potential regressions.
**Flaky-test rule:** A passing retry proves intermittency, not provenance.

## Task-local environment observations
None observed.

## Validation
**Command:** `<registered-tier>`
**Why:** Covers the changed behavior and its relevant integration boundary.
**Do not escalate:** Run only the authorized tier; request approval for changes.
```

Replace examples with real registered values. Record an exact matching baseline
as either `**Ignored baseline:** <ID>` or `**Owned baseline repair:** <ID>`,
never both. Include suite, test, applicable variant/environment, and signature.
Keep task-local observations separate from reusable catalog authority.

Preserve other host-required sections and regression protections. No companion
skill with a particular name is required.
Plan guards must pass before activation. Revalidate the approved plan and its
version against the authoritative task ID at binding; reject a mismatched or
unbound draft. Initial activation requires explicit
plan approval or a previously approved, deterministic activation policy.
Record which authority applies; an agent-written `approved: true` is not approval.
Activate atomically with its audit event and announce only the observed result.

## 4. Execute under the task ID

Use the verified checked runner with task ID and the approved plan reference.
Pass these through validated arguments, a task API, or another host-supported
interface; `TASK_PLAN_FILE` is an optional file-based adapter, not a requirement.
Resolve file plans inside the registered project root; for remote records verify
namespace, identity, version, and access through the adapter. Reject another task's plan.
The runner resolves the single authorized tier from the registry and validates
the entire authorization before starting its commands.

Execute required steps without coverage-reducing overrides. Authorized diagnostic
selectors may retry a failed test or compare a verified earlier snapshot; these
are distinct run purposes, not alternative tiers or full-tier completion evidence.
Do not unset task context, invoke another task's lock, or relabel work as ad hoc.

Record run identity, purpose, authorization version, actual arguments, snapshot,
environment/configuration identity, raw results, and complete report references.
Do not stop a multi-step tier merely because an ignored failure appeared;
account for every required step. Unsafe dependent steps may stop, but the run
is then incomplete rather than acceptable.

Relevant edits after a run require renewed applicable validation. Hash actual
tested inputs, not just the commit ID of a dirty tree. Isolate runs from concurrent
edits; if snapshot integrity is unknown, reject the evidence.

## 5. Classify failures without expanding scope

Apply in order:

1. **Owned repair:** verify the declared obligation and fix it within task scope.
   Expiry or reclassification cannot erase ownership. A deleted, skipped,
   filtered, renamed, or undiscovered test is not proof of repair.
2. **Explicit ignore:** ignore only an exact match to an authoritative, unexpired
   active catalog record applicable to this environment. Do not repair unrelated
   failures. Preserve the raw failing result.
3. **Unlisted failure:** run exactly three authorized isolation retries when the
   diagnostic capability supports that failure. Record each attempt; the initial
   failure is not a retry. Crashes, skips, missing reports, and zero-test runs
   are not passing attempts. Do not retry until lucky.
4. **Provenance:** classify as pre-existing only with direct evidence of the same
   failure on a verified earlier, task-unaffected snapshot plus independent
   corroboration. Match environment applicability as well as failure identity.
5. **Insufficient evidence:** report an unresolved potential regression and block
   completion. Investigate within authorization; do not automatically fix
   unrelated code or label unknown ownership as proven task causation.

Direct evidence is a verified comparison run or a trustworthy earlier run.
Corroboration may be independently sourced task/memory evidence, an applicable
catalog record, or verified unchanged relevant inputs including transitive,
configuration, fixture, migration, generated, and dependency inputs. References
copied from the same observation count once. Narrative memory plus untouched
files without direct provenance is insufficient.

If isolation is impossible or unsafe, use a registry-defined equivalent diagnostic
policy with explicit coverage and attempt limits. Otherwise classification is
blocked; missing diagnostics do not authorize a broader tier.

Typecheck failures remain failures under the host's typecheck policy, not
test-baseline waivers. Expired catalog entries, missing installed dependencies,
validation locks, and conflicting concurrent work are distinct obstructions:
report the specific blocker and unexecuted checks, not a product regression or
a passing partial tier. Investigate observed test failures separately once a
trustworthy run is possible. Catalog promotion is separate maintenance with evidence,
owner, reviewer, applicability, matching rule, and review deadline.

## 6. Change authorization deliberately

Request a tier change only for a concrete coverage/scope need—not a known failure
or extra confidence. Permit one pending request. Suspend validation if current
coverage is inadequate; otherwise the old tier remains the only authorized tier.

Approval must identify the authorized human or policy authority and its evidence.
Move authorization atomically: update tier, plan version/digest, parameter and
tier digests, authorization version, request state, and durable audit event.
Run plan guards against the proposed plan before publishing the change.
Rejection cannot clear an independent suspension or violation.

Validation-relevant plan amendments follow the same approval/versioning rule,
even without a tier change. Code edits inside approved scope do not.
Serialize transitions with active runs; do not orphan a run or accept stale
results. Enforcement changes use the prior governing policy until independently
accepted; workflow mode must disclose that this is procedural, not tamper-proof.

## 7. Decide completion and report accurately

Keep raw exit status separate from assessment:

- `PASS`: all required obligations executed successfully.
- `ACCEPTABLE_WITH_IGNORED_FAILURES`: complete results contain only qualifying
  unrelated failures; owned repairs and other mandatory checks are satisfied.
- `FAIL`: a regression, unmet repair, or other required product check failed.
- `BLOCKED`: authorization, evidence, required capability, or environment is missing.
- `INCOMPLETE`: execution/results are unfinished or untrustworthy.

The completion checker must verify applicable full-tier evidence and all observed
failures, not accept an agent's summary. Diagnostics cannot replace full-tier
validation. Unexpected zero-test runs, missing reports, and skipped required steps
cannot become acceptable through baseline classification.
Recheck each ignored baseline's active, unexpired, exact-match eligibility at
completion; if it expired or was revoked, do not accept the ignore. Owned-repair
obligations survive catalog expiry and still require proof of repair.
Every task-success path (UI, API, automation, or other host equivalent) must
consult the same completion decision. In workflow mode this is cooperative;
protected mode must enforce it outside task-writable code and state. Do not
accept caller-authored result files or an ad-hoc run as trusted proof.

Discover completion support at installation: use a real platform adapter if
available, otherwise a project-local checker. Broader completion execution needs
its own explicit authorization. If project policy requires an unavailable external
check, completion is blocked; a local check must not impersonate that service.

**Managed completion must preserve the task lock.** Claim managed completion only
with evidence that the platform actually dispatched the active task through the
checked project entry point and accepted its result. Project-local launcher tests
prove only local behavior, not the platform-to-project handoff. If that handoff
is unverified or unavailable, report managed completion as blocked, not protected.
When a platform-managed check
completes a task, it must obtain the exact active plan reference and task ID from
trusted task/platform context, bind both to that platform task, and dispatch once
through the project's existing checked
task-validation entry point. That entry point resolves the task's one authorized
tier. The platform must not invoke every registered tier directly or infer the
active plan from the newest file, environment guess, or project code.

Respect ownership boundaries: if the dispatch command or workflow configuration
is platform-managed or declared out of scope, do not modify it or add a project
fallback to evade the lock. If the platform cannot pass the active plan reference
to the checked entry point, report managed completion as blocked and name the
required platform-side change.

A still-running check is incomplete. A polling timeout is not cancellation.
Do not start a replacement while the original remains active; use documented
recovery. After acceptance, failure, or cancellation, release authorization
atomically and retain IDs/history. Failed/cancelled tasks need no passing validation
to release safely after run handling.

Report task ID, authorized tier, run IDs, tested snapshot, raw results, assessment,
failure ownership/evidence, specific obstructions, unexecuted checks, limitations,
and enforcement mode. Never call an
ignored failing suite a clean pass.