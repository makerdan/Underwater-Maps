# Failure Gate v4 host capability map

This describes BathyScan's **project-local cooperative** workflow, not Replit's Task Board. The installation is a bootstrap; ordinary-task v4 activation and cutover are **blocked** until the required capabilities below are integrated and demonstrated. An agent with shell/write access can bypass or alter local tooling, and committed Git content does not authenticate a human reviewer.

| Contract concept | BathyScan host mapping | Bootstrap status |
|---|---|---|
| Project identity | Resolved workspace root plus a configured local namespace; no claim of shared identity across clones | Foundation present |
| Canonical instructions | `replit.md` and tracked `.agents/skills/`; runtime skill mirrors are read-only | Present |
| Project task and plan | Local coordinator stores canonical JSON plan content, digest and version; `.local/tasks/` remains a legacy, ignored archive | Foundation present; no live v4 plan projection/guards |
| Allocator, audit and persistence | SQLite transaction and unique local IDs in per-workspace owner-only home-directory storage, outside `.local/` | Foundation present; terminal transitions and recovery missing |
| Tier registry | Existing `scripts/register-validation-commands.mjs` and `scripts/validation-steps.mjs` define real checks and resource locks | Present for legacy route; digest/coverage mapping to v4 not verified |
| Bootstrap validation | Existing plan-file locked `test-heavy` route using `docs/validation/failure-gate-v4-bootstrap.md` | Approved for this installation only; not ordinary authorization |
| Planning guards and baseline discovery | Existing plan and Regression Guard checks, tracked baseline catalog | Present for legacy plans; not mapped to reserved local drafts |
| Reviewer decision source | `.agents/failure-gate-v4/` roster and per-task decisions, both read from one pinned Git commit | Roster source written but not yet committed; no actual project decision or authenticated reviewer |
| Activation | One-tier local assignment from a matching pinned decision and the installed registry; either admin or Dan, separate from task agent | Foundation present; not enabled for ordinary work |
| Checked runner and run evidence | Existing tier runner executes legacy plan-selected checks; v4 preflight checks local ID, exact tracked plan, policy digests, and records blocked attempts | Preflight present; no live v4 executor, run lease, machine result adapter, or acceptable evidence |
| Diagnostics and failure classification | Existing catalog and task-local Failure Gate guidance | No v4 bounded diagnostic/evidence coordinator |
| Writer coordination | Cooperative Linux `flock` adapter, exercised on workspace Btrfs | Primitive present and pinned as policy input; existing writers and terminal operation not integrated |
| Local completion | Must compare final input snapshot and complete raw run evidence under the writer lock, then commit terminal transition atomically | Missing; cannot gate Replit platform completion |
| Recovery and retention | Existing validation resource locks are separate from local task authorization | v4 run leases, orphan reconciliation and terminal tombstones not demonstrated |

## Approval and cutover boundary

The user selected a committed, versioned review source with **either** the admin **or** Dan as the designated ordinary-plan reviewer, not the task agent. The bootstrap approval is a conversation decision for this installation and one `test-heavy` tier only; it does not authorize ordinary-task activation, baseline promotion, tier changes, or a standing activation policy. A caller-supplied reference or agent-authored approval record is not review evidence. Pin roster and decision to the same committed revision and verify their exact plan, local task ID, tier definition, parameters, policy and authorization versions before activation.

Do not switch `pnpm task:validate` or any other ordinary-task route to v4 merely because foundation tests pass. Cutover requires a real reviewed project-local plan, an actual local-ID checked run with full result adapters, and a single final input/evidence/terminal operation that coordinates relevant foreground writers. Any participating writer outside the lock, asynchronous writer outliving its lease, absent reviewer decision, missing report or unsupported required external check blocks the new route. Keep the previous route as the sole ordinary-task authority until a verified one-step replacement; never treat an ad-hoc or platform-managed completion result as v4 evidence.

## Runtime limits

The local SQLite store persists across restarts in the current workspace but is not shared with independent clones or branch task agents. Back it up with a SQLite-consistent backup (or while closed); preserve task ID tombstones and audit history. Restrict filesystem access to the workspace owner. The Git revision pins review content, not a person's identity. Advisory locks coordinate only participating processes on this filesystem; direct file tools and out-of-band shells remain outside the guarantee. No bootstrap test or fixture approval proves those boundaries are closed.