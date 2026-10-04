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
| Project adapters | Verify actual local mappings for task/plan, execution, storage, evidence, recorded approvals, and local completion. Do not claim Agent platform task identity. |
| Missing optional features | Absent memory/history/catalog does not block otherwise valid execution or create invented ignore authority. |
| Missing governance | No human review or catalog-maintenance service is assumed; absent required local approval blocks the change, and absent catalog governance blocks promotion. |
| No existing tiers/tests | Installation registers only approved real checks; manual-only evidence is labeled honestly and missing required checks remain blocked. |
| Safe discovery/retries | Pre-edit observations and repeated checks respect host-specific side effects, hardware, production, and external-service authorization. |
| Allocation | Concurrent local reservations are unique; committed IDs survive restart and are never reused after cancellation or deletion attempts. |
| Namespace | Independent workspaces do not claim shared sequential allocation; mismatched local project identities and bare Replit Agent task numbers are denied as local authorization. |
| Bootstrap | Draft plan guards and registered baseline discovery work before activation; neither route can launch arbitrary tiers or satisfy completion. |
| Activation | A verified explicit Replit plan-approval event authorizes without an approver identity or roster; the recorded decision binds one exact local ID, approved durable plan/version/digest, the single declared registered tier and definition digest, parameters, and policy/authorization versions. Other hosts may use a configured human-review route. A previously approved deterministic policy matches precise scope or activation blocks. |
| Once-approved policy | An owner-approved, versioned deterministic policy authorizes multiple exactly matching approved plans without per-task human review; its approval source, eligibility rule, fixed tier selection, parameters, and policy version are verified. A policy selecting the plan-stated tier accepts only one registered tier with guard-verified coverage. An unapproved, self-modified, out-of-scope, or unverifiable policy cannot activate a task. |
| Approved plan input | An approved Replit task plan is usable only when its exact contents and binding to the project-local ID are verified; a bare platform task number, plan title, or purported approval is not local authority. |
| New bound decision | Every activation/amendment records the exact task ID, plan version/digest, selected tier and definition digest, parameters, policy/authorization versions, and decision reference. Changing any governing binding invalidates the old decision; a matching policy must issue a fresh decision or fresh applicable approval is needed. |
| Approval event source | Demonstrate a real trusted source for the explicit Replit plan-approval action or another configured decision/policy route. Missing/inaccessible sources, agent-authored claims, and caller-only references cannot activate tasks. A valid Replit event with no approver identity succeeds; adding a fabricated actor cannot make an invalid event succeed. |
| Event semantics and reuse | Command approval, Active/Ready status, and later merge/apply actions do not count as plan approval. Wrong-plan, changed-tier, drifted-policy, and wrong-local-ID events are rejected; one event cannot bind two local IDs. Same-task retries obey idempotency/CAS without granting a new assignment. |
| Decision source stability | Mutate working-tree captured event/decision evidence during activation: the coordinator uses pinned versioned evidence and governing policy, retains its reference atomically, and denies missing/inconsistent snapshots. A commit preserves verified captured contents but cannot prove an approval occurred. A separate identity-based human route pins its reviewer authority with its decision; the Replit-event route does not require a roster. |
| Tier lock | Correct tier runs; lighter/heavier/unknown tiers, missing IDs, wrong plans, escaping paths, and stale digests fail before command launch. |
| Independent caller execution | Each discovered independent caller's existing command executes its intended safe checks with TASK_PLAN_FILE or the host's equivalent optional adapter absent, without changing its command string or requiring new task metadata/caller changes. Prove real step execution, not merely a zero exit. Fixtures alone do not prove platform caller compatibility. |
| Compatibility without task-route cutover | When a plan-file route remains the sole approved ordinary-task route, independent checks work without that plan while the ordinary route, bindings, and change controls remain unchanged. No new lifecycle, cutover, or independent-to-task evidence conversion is introduced. |
| Checked plan input adapters | Supported native arguments, local interfaces, or optional environment/file adapters resolve the exact task/namespace, approved plan/version/digest, authorized tier/definition, and current authorization. A supported non-environment input works without TASK_PLAN_FILE; conflicting supplied bindings are rejected. |
| Checked rejection without fallback | Missing, wrong-task, malformed, stale, suspended, or unauthorized checked bindings launch no validation steps. Removing the variable or requesting a diagnostic/independent mode cannot downgrade a checked request or satisfy the ordinary task's checked-validation obligation. |
| Tier-specific plan scope | A plan authorized only for the fast tier cannot be supplied to standard, full, or heavy checked runs. Independent platform-final checks remain independent; they do not authorize those checked runs or make an incompletely validated task complete. |
| Independent evidence separation | Independent passing, failing, and incomplete results remain distinguishable from checked records. Their mere execution creates no checked authorization, lease, or required-tier evidence; the task checker rejects copied/relabelled independent results, direct tier passes, variable-only claims, and bypass flags as checked evidence. Other independently required obligations remain independently required. |
| Independent raw outcomes | Deliberately failing independent checks preserve nonzero statuses and reports; crashes, missing reports, unexpected zero-test runs, and unfinished steps stay failed/incomplete as applicable, not fabricated passes or automatic catalog ignores. |
| Shared execution preservation | Verify every existing registered tier retains checks, coverage, timeouts, resource/writer locks, report adapters, and heavy-suite serialization where present across supported entry points. Preserve independent command strings, shared workflows, and Run-button definitions unless a separate approved change explicitly covers them. No example tier names are required. |
| Compatibility repair provenance | An evidenced installation-introduced independent-caller rejection is owned by that integration change, not automatically a pre-existing product baseline. A scoped repair uses applicable approval/versioning without inventing a new lifecycle/cutover; separately planned original installation/confirmation pins its original source and records the later amendment distinctly. |
| Defaults | A task has exactly one authoritative tier; no redundant deny-list migration is required when another tier is added. |
| Derived tier status | For each registered tier, status and activation/change audit snapshot derive from the single assignment; added tiers default NOT ALLOWED; suspended/terminal tasks deny all tiers; pending change cannot allow its target. |
| Overrides | Arguments, environment, config, package-script routes, and diagnostic selectors cannot reduce accepted required coverage. |
| Boundary | Checked local execution and completion reject unsupported records; tests do not claim to prevent shell runs, local edits, or Replit Agent task completion. |
| Task substitution | Another valid local task ID and plan cannot validate or complete this local task; its exact approved plan version/digest must match, with no claim of independent Agent platform identity. |
| Result checks | Missing or inconsistent run records, manually supplied `PASS` labels, and copied run IDs fail local checker consistency checks; no forgery-resistance claim. |
| Policy edit | Changed tier registry, wrapper, runner, or checker requires separate approval in the checked workflow; deliberate local tampering remains possible. |
| Completion | Ordinary validated completion requires its local checker decision. Explicit owner-directed administrative completion uses its separately bound decision/mode and cannot masquerade as validation success. Platform task routes remain independent. |
| Ad-hoc route | An ad-hoc run, even with passing output, cannot be attached as required-tier evidence by the local checker. |
| Approvals | A caller-written actor/approved flag is not enough for the checked workflow; recorded local approval is not authenticated identity. |
| Transitions | Approval updates plan/tier/authorization versions and audit atomically; stale/double approvals and a second pending request are rejected. |
| Rejection | Rejecting a change preserves the old tier and cannot clear independent suspension. |
| Crash safety | Simulated failure before/during commit or plan projection leaves no runnable partial state; audit failure rolls back mutation. |
| Races | Launch versus tier move, amendment, cancellation, and release cannot execute against inconsistent versions. |
| Final-write coordination | Demonstrate effective coordination with relevant writers while final inputs and evidence are checked and terminal state is committed. An intervening edit, uncoordinated writer, or coordinator-only lock blocks completion and new-route cutover; out-of-band shell edits remain outside the cooperative guarantee. |
| Optional writer-lock adapter | If using the bundled POSIX reference, its six primitive tests and host checklist pass; verify the real filesystem, stable same-inode lock path across cleanup/redeploy/restart, foreground writer lifetime, writer route coverage, lock ordering, and a live local completion race. Lock-file unlink/rotation/replacement while participants may run must be ruled out; the acquisition-time check cannot prevent a later split lock. Bundling or primitive tests alone cannot permit cutover. Other hosts may use equivalent coordination or isolation. |
| Snapshots | Ordinary in-scope edits permit a new run but invalidate prior relevant results; dirty/untracked/generated/dependency inputs are represented. |
| Output exclusions | Writing approved logs/reports does not itself invalidate evidence; modifying executable inputs does. |
| Isolation | Concurrent code edits and uncoordinated worktrees cannot yield accepted snapshot evidence. |
| Provenance | A “pre-task” run contaminated by task changes or mismatched relevant environment is rejected. |
| Retries | Three distinct permitted retries are bounded; a passing retry proves only intermittency; crashes/skips/zero-test results are not passes. |
| Alternate diagnostics | Unsupported isolation blocks classification unless an approved equivalent diagnostic policy is present. |
| Independence | Memory plus untouched files without direct provenance fails; duplicate references to one observation count once. |
| Matching | Different assertions, variants, environments, signatures, ambiguous matches, and unknown matching rules cannot inherit an ignore. |
| Lifecycle | Expired, revoked, non-active, or newly broadened baselines cannot waive a task failure without approved policy. |
| Ownership | An owned repair cannot be discharged by reclassification, expiry, skipped/deleted/renamed tests, or unapproved plan amendments. |
| Completeness | Ignored failures followed by missing required steps, reports, discovery, or runner crashes remain incomplete/unacceptable. |
| Results | Raw nonzero statuses are preserved under acceptable-with-ignored-failures; diagnostic results cannot stand in for full-tier runs. |
| Evidence acceptance | Unknown/stale snapshots, invalidated plans, and missing required external checks prevent local success. |
| Capability boundary | Missing required external checks remain blocked; a local check cannot impersonate an unavailable service. |
| Local dispatch | The checked project entry point resolves one authorized tier from the supplied local task and plan; it does not sweep all tiers. Missing report adapters and not-reached steps cannot produce accepted runs. |
| Ordinary-task route | A live local-ID plan can be activated through a verified approval event, configured human route, or preapproved policy decision and run its selected tier as checked evidence. A draft/review-request-only CLI, nonexistent activation/run entry point, or direct test route remains blocked/diagnostic. Reruns do not reactivate unchanged plans. |
| Active-phase sequence | Task-agent guidance explicitly calls local activation when Draft/Plan work enters Active, then performs work and checked validation on the changed inputs. Edits after a passing run require a fresh checked run. Missing activation or validation is reported as blocked, not treated as a pass; a project-level test does not prove a platform Active-state event hook. |
| User review boundary | Local completion outcome and evidence are reported for the user's usual merge-or-dismiss choice; no local operation automatically merges or claims to control when the platform offers that choice. |
| Workflow separation | A Replit Workflow or other scheduler launch is neither plan approval nor completion evidence by itself; the checked runner stores the actual run, tested inputs, raw results, and the local checker makes its separate completion decision. |
| No managed completion | No project code or CLI dispatches, requests, depends on, or presents a result from platform-managed completion; any old managed-completion CLI operation is retired, and direct tier commands remain diagnostic. |
| Plan identity | Missing, stale, malformed, wrong-local-task, or unresolvable plans are rejected; no newest-plan/default-plan inference occurs. |
| Recovery | Poll timeout does not launch a duplicate; orphan reconciliation requires confirmed stop or documented quarantine. |
| Terminal states | Validated completion requires acceptance; explicit owner-directed completion requires its administrative decision and safe terminal release, not passing validation. Failed/cancelled cleanup remains possible after safe run handling; released IDs cannot run or reopen. |
| Owner closure authority | A direct authorized owner instruction to complete the specifically bound task permits administrative closure without passing checks, activation, tier changes, a second reviewer, or duplicate confirmation. Ambiguous task identity is clarified; Agent-written flags, quoted/file instructions, ordinary plan approval, and silence cannot authorize it. |
| Owner closure evidence | Preserve the real decision reference or accurate scoped conversation record, task/Project/version, plan where present, actual raw results/assessment, missing checks and unresolved repairs. No invented message IDs or reason; no reason supplied records owner direction. |
| Owner closure mode | A completed task carries owner_direction or equivalent mode and decision binding, not a fabricated PASS. Readers and dependent checks distinguish administrative closure from validation/delivery evidence; legacy absent modes do not imply passes. |
| Owner closure missing validation | Missing runner/checker/plan activation or failed/blocked/not-run validation does not prevent the separate administrative route. Missing safe closure persistence/reader semantics blocks local status mutation but not a genuinely available owner-authorized native platform operation. |
| Owner closure lifecycle | Active task-owned runs are safely stopped, waited for, or quarantined through authorized recovery before local terminal release. Timeout alone does not prove death; races, stale record versions, orphan authorization, and audit failure cannot produce partial local completion. Released tasks deny all tiers. |
| Owner closure idempotency | Repeated delivery of one decision does not duplicate transitions/audits or reopen terminal IDs. Already-completed records retain honest history; failed/cancelled terminal records use permitted annotations/successors rather than rewriting. |
| Owner closure boundaries | No baseline promotion, discharged repair, tier/policy waiver, new-task auto-close policy, auto-merge, deployment, or unrelated process kill is authorized. Subsequent ordinary tasks retain full validation requirements. |
| Agent-native owner closure | Only a genuinely available authorized native task interface may change the precisely resolved platform task. Local code/CLI cannot proxy it, platform Done is not local acceptance, and missing interfaces or partial writes are reported truthfully with readback/outcome reconciliation. |
| Security | Checked entry points reject shell injection and path escape; logs exclude secrets and report reads are bounded. No identity-attestation claim. |
| Migration | Legacy tasks retain honest provenance; canonical sources and approved generated outputs agree; competing authorities are not active together. |
| Bootstrap cutover | A separate, current approval authorizes one selected tier under an existing safe route; for an active gate, use the prior checked route only for bootstrap and block ordinary tasks until cutover. Focused tests remain diagnostic, fixture-only checks do not prove cutover, and failure cannot open an unlocked route. |
| Evidence index | A tracked discoverable index links the manifest to actual authoritative allocator/namespace, backup, catalog/history, raw run, corroboration, health, and closure evidence locations and safe access procedures. No secrets, invented owners/locations, or competing live registry. |
| Backup and restore readiness | Document cadence/recovery point, actual backup/checkpoint, namespace/schema, and isolated authorized host restore report. Procedures, mocks, or a scheduled job alone do not prove a successful backup or tested recovery. |
| Stale allocator backup | Allocate committed IDs after a backup, then restore the checkpoint in isolation. Verified recovery reconciles later commits/tombstones or keeps allocation blocked; it never silently reuses IDs. |
| Restore writers and permissions | Fence old allocators/replicas and prevent same-namespace split allocation. Stale active leases/grants and expired ignores are not revived by backup flags; current policy and normal activation/recovery are required. Production restore is not authorized by skill authoring. |
| Classification lineage | A pre-existing determination links the exact current failure/snapshot/environment, direct earlier/comparison run, relevant policy/catalog revisions, and each original corroboration source. Missing applicability or origin remains unresolved. |
| Corroboration duplication | Copied logs, summaries, or two views of one observation count as one source; independent verified unchanged inputs may corroborate but never replace required direct earlier-run proof. |
| Evidence availability states | Distinguish present, never_collected, unavailable, expired, pruned, corrupt, and unknown with observed reason/recovery action. Present may be stale; expired historical entries may corroborate but cannot authorize an ignore. Missing optional history blocks only dependent claims. |
| Evidence health inspection | Bounded read-only diagnostics report broken links, missing artifacts, bindings, stale grants/runs, expiry, backup status, lineage and mode ambiguity. Report writes are scoped; no silent repair, renewal, status mutation, process kill, restore, or recurring-job setup. |
| Retention dependencies | Preserve tombstones and evidence still required by current accepted claims, or explicitly invalidate dependent assessments when authorized pruning removes it. Retain historical outcomes with pruned/unverifiable status; lost artifacts cannot justify new acceptance. |
| Portable evidence export | A requested scoped versioned bundle includes exact bindings, raw outcomes, snapshot/environment, classification origins, closure mode and unresolved work, with digests/redactions/absence recorded. Protected data stays protected; incomplete bundles are not called fully verifiable. |
| Export non-authority | Import/viewing cannot allocate IDs, grant tiers, approve changes, widen baselines, replace a live store, or prove another environment passed. Digests are integrity aids, not authentication or tamper-proof evidence. |
| Owner closure visibility | Reports/health/export views distinguish owner_direction from validated mode and expose retained failed/blocked/not-run checks and repairs. Index/restore/health/export requirements do not demand a second closure approval or passing tests; no auto-created follow-ups or successful-validation metrics. |

## Paired skill confirmation

When creating project tasks to install this skill definition, create a dependent
confirmation task scoped to `SKILL.md`, after the authoring task. Its acceptance
items must match the authoring task's items, including:

- Valid frontmatter names `failure-gate-v4`; title and identifiers consistently use v4.
- Core skill remains below 500 lines with resolvable local reference links.
- One authoritative task-to-tier mapping replaces redundant live allow/deny lists.
- Per-tier audit snapshots and status are derived from that mapping, not separately editable permissions.
- Planning authorization avoids a pre-activation guard deadlock.
- Task authorization and run snapshots are distinct.
- Project-local workflow limitations are explicit, without a protected-mode claim.
- A verified explicit Replit plan-approval action is trusted authorization without requiring an approver identity or reviewer roster; deterministic policy is usable only after separate prior approval.
- A once-approved deterministic policy may authorize matching plans without per-task human review, but records a new exact-bound decision for each task/change.
- An approved Replit task plan is input only with verified project-local binding, never standalone authorization.
- An ordinary-task activation and checked-run route is required; a draft/review-only CLI cannot supply it.
- Active work explicitly invokes the local activation/checked-validation path, reruns after relevant edits, and leaves the merge-or-dismiss choice to the user.
- A configured source supplies checkable real approval events/decisions; caller assertions and status/merge actions alone cannot activate.
- Final input/evidence checking and terminal write are coordinated with relevant writers, or local completion stays blocked.
- No project entry point invokes or reports platform-managed completion.
- The local completion checker is implemented and does not pretend to control the platform task lifecycle.
- Explicit owner-directed closure has a separate recorded decision/mode,
  preserves unresolved validation, and does not require a second approval or
  Agent self-authorization. Ordinary validated completion remains protected.
- Local validation uses the supplied local task and plan to run one authorized tier.
- Independent callers retain their existing invocations without mandatory task
  metadata or an environment variable. Explicit checked requests fail closed
  without fallback; independent results cannot become required-tier evidence.
- Both execution paths have regression cases preserving raw outcomes, checks,
  timeouts, resource locks, reports, heavy serialization, and workflow definitions.
- A project-level launcher test is not represented as proof of Replit Agent platform routing.
- Another valid local task plan cannot be substituted for the local task being checked.
- Local result consistency checks are not described as forgery resistance.
- Paths, commands, formats, runtimes, tier names, and companion skills are host-adapted rather than mandatory examples.
- Essential ownership, provenance, and fail-closed rules remain in the core skill.
- The eight evidence/recovery requirements have explicit normative references
  and acceptance cases, with optional-history and owner-closure boundaries intact.
- No section is vague, self-referential, or deferred to future work.
- A future Planner reading the skill file cold could follow it without ambiguity.

List gaps before patching. Do not use skill confirmation as permission to implement
project feature code, alter unrelated skills, or repair the broader repository.
If correcting the skill requires rewriting more than half, surface a replacement
task instead of silently expanding scope. Review companion documents separately.

## Reporting

Report actual checks run, raw outcomes, known baseline failures, and project-local
workflow limitations. A document-format review is not runtime
verification, and installed instructions are not an installed validation system.