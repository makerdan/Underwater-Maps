# Skill Application Router — single-skill upload package

Upload this ZIP as one workspace skill. Its root `SKILL.md` is the only skill
entry point; retain the bundled `references/` files. There is no enclosing
folder and no second `SKILL.md` inside the archive.

## Layout

```text
SKILL.md
README.md
references/
  installation-verification-plan.md
  handoff-binding-and-recovery.md
  router-task-handoff-acceptance.md
  custom-skill-commands.md
  custom-skill-command-manifest.json
```

The root skill handles application wording and Invoke/Install/Apply/Audit
routing. Independent verification planning is now an internal reference
module, loaded during Install/Apply or an explicit verification
request. It does not require a separately installed
`skill-install-verification-plan` skill.

Normal Install/Apply routing either writes and finalizes a new primary task
or verifies an existing primary surfaced by Replit Agent. It reads the real
committed plan and matching identity/scope, then creates a separate verification
task with a dependency on the primary task. Both tasks may be pending together,
but substantive verification requires actual delivered inputs, not just a
platform dependency label. The bundled binding/recovery protocol requires
release-semantic discovery and explicit readiness/resume checks. Missing
task-creation or dependency capabilities are reported as blocked, never as
successful task creation.
An existing task does not need a new create response or replacement task.
Its finalized authoritative record is the equivalent evidence; a title/card,
status, or uncommitted proposal is insufficient. Repeated surfacing reuses the
same persisted Project/target/primary ID/primary-plan digest/scope key and checks
for an already-linked verifier. Source digests remain evidence, not changing
keys when a planned skill file first becomes available.

The protocol also requires full persisted-plan comparison, lifecycle-aware
reuse, complete immutable specification/reference baselines, uncertain-write
recovery, normalized key representations, and primary-revision checks at
linkage and execution. Cancelled, failed, blocked, or stale verifiers do not
satisfy required follow-ups merely because a record exists.

The verification module preserves source/runtime, project implementation,
and platform lifecycle as separate evidence tracks, along with read-only
boundaries, safety approvals, requirement-by-requirement evidence, and honest
blocked reporting. A created verification task is not a passing verification.

## Source and installation boundary

Canonical files in this conversation live at
`.agents/skills/skill-application-router/`. For project-local installation,
use that supported canonical location and preserve relative references.
Do not promote a runtime mirror to canonical authority.
An authorized first installation may use its original specification/package
before the destination exists; Invoke/Apply/Audit still require canonical
target sources. Install the whole authorized resource package, not SKILL.md
alone. Resolve applicable required companions canonically and preserve
report-only operation boundaries.

The bundled command catalog and hash manifest are historical material from
the uploaded package, not proof of current canonical-source parity. Its
recorded runtime source is provenance only, not permission to read mirrors.
Always resolve the current target contract under `.agents`; do not refresh
unavailable target definitions from the historical catalog.

Packaging the skill does not install it into workspace settings, implement a
host task API, create a project verification task, or change platform lifecycle
behavior. Those actions require the actual selected project's verified
capabilities and applicable authorization.