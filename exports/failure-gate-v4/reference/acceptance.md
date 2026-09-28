# Failure Gate v4 — acceptance and confirmation

These are required executable test cases for a host implementation. This document
is not evidence that the implementation or tests already exist.

## Before changing a host

Record existing commands, observed failures, and unavailable checks. Use the approved
bootstrap validation contract during initial installation; do not require the
uninstalled gate to validate itself. Preserve canonical local and CI coverage.
Do not trigger or modify remote CI without appropriate authorization.

Material implementation changes require regression protection describing the bug
or contract risk, the proving check, and post-change verification. Use the host's
existing format; no named companion skill is mandatory. Do not fix unrelated
baseline failures. Record raw failures and ownership separately.

## Required host tests

| Area | Prove |
|---|---|
| Portability | No example path, Node command, package manager, OS, framework, database, tier name, or companion skill is required implicitly. |
| Host adapters | Verify actual host mappings for task/plan, execution, storage, evidence, approvals, and completion, including remote-record identity checks where used. |
| Missing optional features | Absent memory/history/catalog does not block otherwise valid execution or create invented ignore authority. |
| No existing tiers/tests | Installation registers only approved real checks; manual-only evidence is labeled honestly and missing required checks remain blocked. |
| Safe discovery/retries | Pre-edit observations and repeated checks respect host-specific side effects, hardware, production, and external-service authorization. |
| Allocator reservation | Where the host reserves IDs, concurrent reservations are unique; committed IDs survive restart and are never reused after cancellation or deletion attempts. |
| Service-assigned identity | Where the service assigns an ID after draft creation, guards may use a non-authorizing provisional reference; no active run or completion accepts that reference as an ID. A duplicate/delayed service callback or caller-chosen ID cannot activate another task. |
| Draft binding | Positive: independently issued ID and the exact approved plan/version bind atomically with authorization and audit before the first run. Negative: missing approval, service mapping, plan/version mismatch, or interrupted binding remains draft/blocked; no competing allocator or self-approval is introduced. |
| Namespace | Independent workspaces cannot falsely claim shared sequential allocation; mismatched repository identities are denied. |
| Bootstrap | Reserved-ID or provisional draft plan guards and registered baseline discovery work before activation; neither route can launch arbitrary tiers or satisfy completion. |
| Activation | Only valid plans with recorded approval or approved activation-policy decisions activate. |
| Tier lock | Correct tier runs; lighter/heavier/unknown tiers, missing IDs, wrong plans, escaping paths, and stale digests fail before command launch. |
| Defaults | A task has exactly one authoritative tier; no redundant deny-list migration is required when another tier is added. |
| Overrides | Arguments, environment, config, package-script routes, and diagnostic selectors cannot reduce accepted required coverage. |
| Modes | Workflow bypass produces no accepted completion evidence; protected-mode tests prove the claimed external boundary rather than assuming it. |
| Task substitution | Another valid active task ID and plan cannot be used to validate or complete the current task; identity comes from an independent task context. |
| Evidence forgery | Agent-edited result JSON, `PASS` labels, artifact swaps, and copied run IDs cannot become protected completion evidence. |
| Policy edit | A task-modified tier registry, wrapper, runner, checker, or automation adapter cannot govern that task without independent acceptance. |
| Completion routes | Every UI/API/automation success route checks the same final decision; document any route the workflow mode cannot enforce. |
| Ad-hoc route | An ad-hoc run, even with passing output, cannot be attached to an active task's completion evidence. |
| Approvals | Agent-supplied actor/approved flags do not satisfy protected approval; workflow approval limitations are explicit. |
| Transitions | Approval updates plan/tier/authorization versions and audit atomically; stale/double approvals and a second pending request are rejected. |
| Rejection | Rejecting a change preserves the old tier and cannot clear independent suspension. |
| Crash safety | Simulated failure before/during commit or plan projection leaves no runnable partial state; audit failure rolls back mutation. |
| Races | Launch versus tier move, amendment, cancellation, and release cannot execute against inconsistent versions. |
| Snapshots | Ordinary in-scope edits permit a new run but invalidate prior relevant results; dirty/untracked/generated/dependency inputs are represented. |
| Output exclusions | Writing approved logs/reports does not itself invalidate evidence; modifying executable inputs does. |
| Isolation | Concurrent code edits and uncoordinated worktrees cannot yield accepted snapshot evidence. |
| Provenance | A “pre-task” run contaminated by task changes or mismatched relevant environment is rejected. |
| Retries | Three distinct permitted retries are bounded; a passing retry proves only intermittency; crashes/skips/zero-test results are not passes. |
| Alternate diagnostics | Unsupported isolation blocks classification unless an approved equivalent diagnostic policy is present. |
| Independence | Memory plus untouched files without direct provenance fails; duplicate references to one observation count once. |
| Matching | Different assertions, variants, environments, signatures, ambiguous matches, and unknown matching rules cannot inherit an ignore. |
| Lifecycle | Positive: a still-active, unexpired exact-match ignore is rechecked at completion and may qualify. Negative: an ignore that expired or was revoked after launch cannot waive a failure at completion, even if previously eligible. |
| Ownership | Positive: completed owned repair has evidence of the fix. Negative: an owned repair cannot be discharged by record expiry, reclassification, skipped/deleted/renamed tests, or unapproved plan amendments. |
| Obstructions | Positive: report an expired catalog ignore, missing installed dependency, validation lock, or conflicting concurrent work by name with raw status and affected/unexecuted checks. Negative: do not attribute an unexecuted check to an application regression or accept a partial tier as a pass; an actual observed product failure is classified separately. |
| Completeness | Ignored failures followed by missing required steps, reports, discovery, or runner crashes remain incomplete/unacceptable. |
| Results | Raw nonzero statuses are preserved under acceptable-with-ignored-failures; diagnostic results cannot stand in for full-tier runs. |
| Completion | Unknown/stale snapshots, invalidated plans, and missing required external checks prevent successful completion. |
| Capability adapter | Missing optional platform support is declared; required support cannot be impersonated by a local check or silently disabled. |
| Managed dispatch | Platform supplies the exact active task's plan reference and invokes one checked task-validation entry point; it never directly calls every registered tier. |
| Dispatch identity | Missing, stale, malformed, wrong-task, or unresolvable plan references are rejected before validation; no newest-plan/default-plan inference occurs. |
| Platform boundary | Positive: platform-origin evidence binds active task ID/plan and a single checked invocation to run and completion decision. Negative: launcher-only unit tests, local result files, or unverified/unavailable handoff cannot prove managed completion or protected enforcement; report blocked. |
| Ownership boundary | If platform dispatch configuration is outside project scope, no project workflow/command edits or unlocked fallback are introduced; report the platform-side blocker. |
| Recovery | Poll timeout does not launch a duplicate; orphan reconciliation requires confirmed stop or documented quarantine. |
| Terminal states | Completion requires acceptance; failed/cancelled cleanup remains possible after safe run handling; released IDs cannot run or reopen. |
| Security | No shell injection, path escape, secret-bearing logs, unbounded report reads, or forged trusted identity is accepted. |
| Migration | Legacy tasks retain honest provenance; canonical sources and approved generated outputs agree; competing authorities are not active together. |

## Paired skill confirmation

When creating project tasks to install this skill definition, create a dependent
confirmation task scoped to `SKILL.md`, after the authoring task. Its acceptance
items must match the authoring task's items, including:

- Valid frontmatter names `failure-gate-v4`; title and identifiers consistently use v4.
- Core skill remains below 500 lines with resolvable local reference links.
- One authoritative task-to-tier mapping replaces redundant live allow/deny lists.
- Planning authorization avoids a pre-activation guard deadlock.
- Both reserved IDs and post-draft service IDs bind to the exact approved plan
  before activation without provisional authorization or invented approval.
- Task authorization and run snapshots are distinct.
- Workflow versus protected enforcement is explicit.
- Completion capabilities are discovered rather than invented.
- Managed completion receives the exact active plan reference and delegates once to the checked task runner instead of directly invoking all tiers.
- A project-level launcher test is not represented as proof of platform dispatch behavior.
- Managed completion without verified platform handoff is blocked, not protected.
- Blocked runs name their obstruction and unexecuted checks; a partial tier is
  never a pass, and expired ignores do not erase owned-repair obligations.
- Another valid task identity cannot be substituted for the platform's current active task.
- Every task-success route and trusted result source has a stated enforcement boundary.
- Paths, commands, formats, runtimes, tier names, and companion skills are host-adapted rather than mandatory examples.
- Essential ownership, provenance, and fail-closed rules remain in the core skill.
- No section is vague, self-referential, or deferred to future work.
- A future Planner reading the skill file cold could follow it without ambiguity.

List gaps before patching. Do not use skill confirmation as permission to implement
project feature code, alter unrelated skills, or repair the broader repository.
If correcting the skill requires rewriting more than half, surface a replacement
task instead of silently expanding scope. Review companion documents separately.

## Reporting

Report actual checks run, raw outcomes, known baseline failures, unverified
capabilities, and enforcement mode. A document-format review is not runtime
verification, and installed instructions are not an installed validation system.