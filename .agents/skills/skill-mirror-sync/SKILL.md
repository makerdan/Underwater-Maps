---
name: Skill Mirror Sync
description: >-
  Manage workspace-owned skills through an explicit source, validated generated
  project projections, and read-only platform runtime mirrors. Use when adding,
  auditing, refreshing, or diagnosing a workspace-managed skill projection or
  runtime-mirror status.
---

# Skill Mirror Sync

## Purpose

Workspace-managed skills have one authority and one direction of travel:

`WORKSPACE_SKILLS_SOURCE` → generated project projection → platform runtime mirror

These layers are not interchangeable:

| Layer | Authority and ownership | Allowed writes |
|---|---|---|
| Workspace source | Authoritative, supplied explicitly by `WORKSPACE_SKILLS_SOURCE` | Only the workspace owner or platform workflow that owns the source |
| Project projection | Generated, helper-owned directories under `.agents/skills/` | Only the projection refresh helper |
| Runtime mirror | Disposable, platform-owned state under `.local/custom_skills/` | Platform only; repository helpers are read-only |
| Project-authored skill | Ordinary tracked skill under `.agents/skills/` without a projection marker | Humans and agents may edit it; refresh must never replace it |

Never infer source authority from whichever copy currently exists. A runtime
mirror is not a backup, and a generated projection is not an ordinary
project-authored skill.

## When to use this skill

Use this contract when:

- installing or refreshing a workspace-managed skill;
- auditing source, projection, or runtime-mirror parity;
- diagnosing stale instructions or a failed workspace-skill status check;
- changing projection lifecycle, locking, manifests, or status behavior; or
- deciding whether a directory is helper-owned or project-authored.

Do not use this workflow to synchronize ordinary project-authored skills or
Replit-provided skills that have no workspace source entry.

## Source contract

`WORKSPACE_SKILLS_SOURCE` is mandatory for refresh, loading, and live status.
It may be absolute or repository-relative. Do not guess a path or silently fall
back to `.agents/skills/`.

The source root must contain:

- a regular, non-symlink `.workspace-revision` file with a valid non-empty
  revision supplied by the source owner; and
- one or more immediate child skill directories, each containing `SKILL.md`.

Every file below each skill directory participates in the projection. Discovery
is recursive and deterministic. Sort paths, hash each regular file with
SHA-256, and derive the source fingerprint from the normalized inventory.
Keep the supplied source revision and computed fingerprint as separate values:
revision drift and same-revision content drift are both failures.

Reject the complete source snapshot when it contains:

- symlinks, devices, sockets, FIFOs, or other special files;
- path escapes, malformed skill IDs, or reserved helper files;
- top-level non-skill content other than `.workspace-revision`;
- a missing or malformed revision; or
- a skill without `SKILL.md`.

Errors and logs must not disclose source paths, file contents, or private source
identifiers.

## Refresh lifecycle

Run:

```sh
pnpm workspace-skill:refresh
```

The helper must:

1. Resolve the explicit source and build a complete revision plus SHA-256
   inventory before taking installation action.
2. Acquire the projection-root lock. The lock records host, PID, and an
   unpredictable ownership token.
3. Treat a lock as abandoned only when its owner metadata is valid, it belongs
   to the same host, and the recorded PID is proven dead. Foreign-host,
   malformed, unknown, or live locks remain blocking.
4. Recover interrupted work only from a valid helper journal whose names and
   ownership match that lock token. Never delete unknown temporary state.
5. Copy the entire source snapshot into helper-owned staging, write per-skill
   SHA-256 projection manifests, and validate staged contents.
6. Refuse any target collision with an unmarked project-authored skill.
7. Re-read the complete source revision and fingerprint immediately before
   installation. Abort if either changed.
8. Install through guarded renames with a rollback journal. Commit the root
   projection-set manifest only after every skill is installed.
9. On failure, restore moved targets. On success or failure, clean only staging,
   backups, and temporary manifests owned by the current token.

Per-skill projection markers and the root projection-set manifest classify
generated state. A missing or malformed marker never grants ownership; it makes
the directory non-replaceable until a human resolves the ambiguity.

## Fail-closed loading

Consumers must load workspace-managed instructions through the validated
projection reader, not by reading a projected `SKILL.md` directly.

Return content only when all of these agree:

- the current explicit source revision and SHA-256 fingerprint;
- the root projection-set manifest and complete skill set;
- the requested skill's projection marker and recursive file inventory; and
- the actual projected bytes.

If source, set manifest, skill marker, or projected content is unavailable,
malformed, stale, extra, or missing, return no skill content and surface an
error. Never continue with the last readable copy.

## Runtime-mirror status

Run a non-mutating per-skill comparison:

```sh
pnpm workspace-skill:status -- --skill <skill-id>
```

Status reads the authoritative source identity and platform-provided
`.workspace-skill-mirror.json` metadata. It does not read parity from an old
MD5 `.fingerprint`, copy files, repair metadata, create a mirror, or write
anywhere under `.local/`.

Exit codes are stable:

| Code | Meaning |
|---:|---|
| `0` | Platform metadata exactly matches the source revision, SHA-256 fingerprint, skill ID, and recursive inventory |
| `1` | Source is available, but mirror metadata is malformed or mismatched |
| `2` | The explicit source, supplied revision, source snapshot, or requested source skill is unavailable |
| `3` | No platform mirror metadata exists for the requested skill |

Unavailable source data is not success. Missing mirror metadata is not inferred
from mirror contents. The repository helper reports status; only the platform
provisions or refreshes the runtime mirror.

## Validation and post-merge behavior

`pnpm run check:skill-mirror-sync` runs fixture-driven contract tests. It must
exercise recursive integrity, unsafe input rejection, project-authored
collisions, revision and fingerprint races, lock ownership, interrupted
rollback, fail-closed loading, status codes, redaction, and the no-runtime-write
boundary without fabricating a live workspace source or platform mirror.

Post-merge automation may run this contract check. It must not run a mutating
runtime sync, create source metadata, or treat unavailable live status as pass.

## Prohibited shortcuts

- Do not edit, copy into, delete from, or reverse-promote
  `.local/custom_skills/`.
- Do not restore the obsolete `.agents/skills` → runtime MD5 repair path.
- Do not invent `WORKSPACE_SKILLS_SOURCE`, `.workspace-revision`, projection
  markers, runtime sidecar metadata, or a successful parity result.
- Do not follow symlinks or accept special files.
- Do not replace an unmarked project-authored skill.
- Do not recover a lock based only on age, PID reuse assumptions, or a foreign
  host.
- Do not expose a partially installed or mixed-revision projection.
- Do not commit private workspace source contents as ordinary project-authored
  skills.