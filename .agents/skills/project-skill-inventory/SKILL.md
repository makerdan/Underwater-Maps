---
name: Project Skill Inventory
title: Project Skill Inventory
description: Produce a read-only report showing which private or custom skills available to Agent are applied or integrated in the current project. Use when the user asks which custom skills a project has, whether a private skill is applied, or for a project skill integration report. Never install, update, sync, delete, copy, or repair skills.
---

# Project Skill Inventory

Report which private or custom skills available in the current Agent runtime are
applied or integrated in the current project. Do not change files or runtime
state.

## Meaning of “applied”

A private or custom skill is applied only when its skill ID appears in both:

1. the runtime-visible private/custom candidate set; and
2. a recognized project skill location.

Runtime availability by itself is not project application.

## Skill application versus project implementation

The inventory must report two separate dimensions:

1. **Skill application status** — determined only by exact skill-ID matching
   between the runtime-visible private/custom candidate set and a recognized
   project skill location.
2. **Project implementation evidence** — determined separately by inspecting
   project-owned source files, scripts, configuration, documentation, tests,
   and workflow wiring for behavior corresponding to the skill's purpose.

Implementation evidence must never change skill application status. A project
may implement similar behavior with different filenames, commands, or
architecture; report that as implementation evidence, not skill installation.

### Implementation status values

For every runtime-visible private/custom skill, report one of:

- **Applied and implemented** — the skill is applied and corresponding project
  behavior is evidenced.
- **Applied, implementation not evidenced** — the skill is applied, but no
  matching project behavior was found.
- **Not applied, implementation evidenced** — the skill is not applied, but
  matching functionality or an equivalent implementation is evidenced.
- **Not applied and implementation not evidenced** — neither application nor
  matching behavior was found.
- **Implementation status unknown** — the required project scope could not be
  inspected read-only.

If only part of a contract is evidenced, label the result with
`Partial implementation` and identify the missing or unverified areas.

### Implementation cross-check rules

- Do not infer implementation from a skill definition.
- Do not infer application from scripts, documentation, tests, workflow wiring,
  or behavior alone.
- Treat filenames and documentation as leads, not proof of complete
  implementation. Prefer executable wiring and existing test evidence.
- Inspect implementation evidence read-only; do not run validation merely to
  make an implementation status pass.
- Do not create a project copy, install a skill, regenerate projections, or
  repair implementation during this inventory.

Recognized project locations:

| Path | Applied as |
|---|---|
| `.agents/skills/<skill-id>/SKILL.md` | Project-installed |
| `.agents/skills/.workspace-projections/<skill-id>/SKILL.md` | Workspace-integrated |

Runtime candidate location:

| Path | Meaning |
|---|---|
| `.local/custom_skills/<skill-id>/SKILL.md` | Private/custom skill visible to this Agent runtime |

Treat `.local/custom_skills/` only as a read-only identity catalog for this
comparison. It is disposable and non-authoritative: never report a runtime
candidate as applied unless a matching recognized project entry exists.

## Read-only boundary

- Never create, edit, copy, move, delete, install, update, project, refresh,
  synchronize, repair, or execute a skill.
- Do not run commands that may regenerate projections, mirrors, manifests,
  metadata, lockfiles, or caches.
- Do not follow symlinks.
- Do not expose skill bodies, private workspace instructions, secrets,
  credentials, hidden metadata values, or canonical workspace source paths.
- Read only the minimum frontmatter needed for display: `name`, optional
  `title`, and `description`. Read skill instructions internally only as
  needed to identify the skill's purpose for the mandatory implementation
  cross-check; never include skill bodies in the report.
- When evidence is unavailable without mutation, report `unknown`.

Ignore dependencies, build outputs, archives, backups, temporary directories,
and nested repositories.

## Procedure

1. Confirm the current project root through read-only inspection.
2. Enumerate immediate skill directories under `.local/custom_skills/`.
3. Require each runtime candidate `SKILL.md` to be a regular, readable file.
   Use the immediate directory name as its stable skill ID.
4. Enumerate immediate project skill directories under `.agents/skills/`,
   excluding `.workspace-projections`, and inspect
   `.agents/skills/.workspace-projections/` separately.
5. Require every project candidate `SKILL.md` to be a regular, readable file.
   Use its immediate directory name as the project skill ID.
6. Compare exact, case-sensitive skill IDs:
   - matching direct project ID: **Project-installed**;
   - matching projection ID: **Workspace-integrated**;
   - both matches: report both states as a finding;
   - runtime candidate with no match: **Available, not applied**.
7. Keep malformed entries and duplicate identities as separate findings rather
   than merging or guessing.
8. If `.local/custom_skills/` is absent or unreadable, report the private/custom
   candidate set as `unknown`; do not substitute `.local/skills/`,
   `.local/secondary_skills/`, or another source.
9. If `.agents/skills/` is absent, report zero applied skills instead of
   creating it.
10. Return one focused result when the user names a skill; otherwise return the
    complete applied inventory and a count of available-but-not-applied skills.
11. For every runtime-visible private/custom skill, inspect the project
    read-only for corresponding implementation evidence and record the
    implementation status separately. If the project is too large or required
    evidence is inaccessible, report `Implementation status unknown` and the
    bounded unreadable scope rather than guessing.
12. Enumerate immediate regular readable `SKILL.md` files under
    `.local/skills/` and `.local/secondary_skills/`, excluding
    `.local/custom_skills/`. Read only each skill's `name`, optional `title`,
    and `description` frontmatter for the local-skills summary. These are
    runtime-visible local skills, not evidence of project application.

## Display names

For every listed skill, choose a readable display label in this order:

1. use `title` when it is non-empty and contains no hyphen;
2. otherwise use `name` when it is non-empty and contains no hyphen;
3. otherwise convert the directory skill ID into title case by replacing
   hyphens with spaces.

Always include the exact directory skill ID in backticks after the display
label so matching remains auditable.

Examples:

- `title: Project Skill Inventory` → **Project Skill Inventory**
- `name: Project Skill Inventory` → **Project Skill Inventory**
- ID `project-skill-inventory` with no hyphen-free title or name →
  **Project Skill Inventory** (`project-skill-inventory`)

## Outcomes

- **Project-installed:** a runtime-visible private/custom skill has a matching
  valid direct project skill.
- **Workspace-integrated:** a runtime-visible private/custom skill has a
  matching valid project projection.
- **Available, not applied:** the private/custom skill is runtime-visible but
  has no matching project skill or projection.
- **Invalid:** required `SKILL.md` evidence is missing, unreadable, non-regular,
  malformed, symlinked, or has an identity conflict.
- **Unknown:** required scope cannot be inspected without mutation.

Do not infer installation history, prior invocation, successful use, source
freshness, or provenance from current presence.

## Report

Lead with the applied result and use this structure:

```text
# Private/Custom Skills Applied to This Project

**Project:** <name or root>
**Result:** <N applied: N project-installed, N workspace-integrated>
**Runtime-visible private/custom skills:** <N>
**Scope:** Current read-only filesystem inspection

## Applied
- **<hyphen-free display name>** (`<skill-id>`) — <Project-installed or Workspace-integrated>

## Other Local Skills

### Platform-provided local skills
- **<display name>** (`<skill-id>`) — <one-sentence description>

### Secondary local skills
- **<display name>** (`<skill-id>`) — <one-sentence description>

## Implementation Cross-Check

- **<hyphen-free display name>** (`<skill-id>`)
  - **Skill status:** <Project-installed | Workspace-integrated | Available, not applied | Invalid | Unknown>
  - **Implementation status:** <one of the five implementation status values>
  - **Coverage:** <Complete | Partial implementation | Not evidenced | Unknown>
  - **Evidence:** <project-owned files, executable wiring, tests, or “None found”>
  - **Gaps:** <missing or unverified contract areas, or “None identified”>

## Findings
- <invalid entries, duplicate states, partial scope, or “None”>

## Limits
- <N> runtime-visible private/custom skills are available but not applied.
- Current presence does not prove installation history or prior invocation.
- <other material unknowns>

**Changes made:** None.
```

When no matches exist, write `## Applied` followed by
`None of the runtime-visible private/custom skills are applied to this project.`

## Other Local Skills

List every valid runtime-visible skill found under `.local/skills/` or
`.local/secondary_skills/` that is not already represented as a private/custom
skill. Group entries by source and show one faithful sentence from the
frontmatter description. Use the same readable display-label rules and include
the exact skill ID.

```text
## Other Local Skills

### Platform-provided local skills
- **<display name>** (`<skill-id>`) — <one-sentence description>

### Secondary local skills
- **<display name>** (`<skill-id>`) — <one-sentence description>
```

If a local skill is malformed, unreadable, symlinked, or missing required
frontmatter, list it under `Findings` rather than guessing its description.
If a source directory is absent, report that source as unavailable or empty
according to the evidence. Do not call these skills applied, installed, or
integrated solely because they are visible under `.local/`.

List available-but-not-applied skills only when the user requests the full
comparison. Always include `Findings`, `Limits`, and `Changes made: None`.