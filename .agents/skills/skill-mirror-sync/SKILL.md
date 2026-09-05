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
It may be absolute or relative to the repository root. Resolve it once to an
absolute path before reading it. Do not resolve a relative value against the
caller's current directory, guess a path, or silently fall back to
`.agents/skills/`.

The source root must contain:

- a regular, non-symlink `.workspace-revision` file with a valid non-empty
  revision supplied by the source owner; and
- one or more immediate child skill directories, each containing `SKILL.md`.

Skill IDs are case-sensitive and must match
`[A-Za-z0-9][A-Za-z0-9._-]*`. Reject dot-prefixed IDs, empty IDs, path
separators, `.`/`..`, and every ID outside that grammar before constructing a
path. The directory name is the exact skill ID used in manifests, projections,
and runtime metadata.

The trimmed `.workspace-revision` value must match
`[A-Za-z0-9][A-Za-z0-9._:-]{0,255}`. It is an opaque source-owner identity:
compare it exactly, never derive or rewrite it, and never use it as a path.

Every file below each skill directory participates in the projection. Discovery
is recursive and deterministic:

1. Represent every path relative to the source root with `/` separators.
2. Reject absolute paths, empty segments, `.` segments, `..` segments, and
   escapes before reading bytes.
3. Hash each regular file's exact bytes with SHA-256, producing lowercase
   64-character hexadecimal.
4. Sort inventory records by normalized path in ascending lexical order.
5. Serialize the ordered array as compact JSON with each object written as
   `{"path":"<skill-id>/<relative-path>","sha256":"<hex>"}`.
6. SHA-256 that UTF-8 JSON serialization to produce `sourceFingerprint`.

Keep the supplied `sourceRevision` and computed `sourceFingerprint` separate:
revision drift and same-revision content drift are both failures.

Reject the complete source snapshot when it contains:

- symlinks, devices, sockets, FIFOs, or other special files;
- path escapes or malformed skill IDs;
- `.workspace-skill-projection.json` anywhere inside a skill;
- a top-level entry using `.workspace-skills-projection-set.json`,
  `.workspace-skills-refresh.lock`, or the
  `.workspace-skills-stage-`/`.workspace-skills-backup-` prefixes;
- top-level non-skill content other than `.workspace-revision`;
- a missing or malformed revision; or
- a skill without `SKILL.md`.

Errors and logs must not disclose source paths, file contents, or private source
identifiers.

## Versioned metadata contract

All metadata is JSON version `1`. Unknown versions, missing fields, extra path
escapes, unsorted arrays, duplicate entries, malformed hashes, or inconsistent
identities fail closed.

| File | Owner and required fields |
|---|---|
| `.agents/skills/.workspace-skills-projection-set.json` | Refresh helper; `version`, `sourceRevision`, `sourceFingerprint`, and sorted `skills` containing the complete generated skill-ID set |
| `.agents/skills/<skill-id>/.workspace-skill-projection.json` | Refresh helper; `version`, exact `skill`, `sourceRevision`, `sourceFingerprint`, and sorted `files` containing skill-relative `path`/`sha256` records |
| `.agents/skills/.workspace-skills-refresh.lock/owner.json` | Active refresh; `version`, UUID ownership `token`, positive safe-integer `pid`, and bounded `host` |
| `.agents/skills/.workspace-skills-refresh.lock/journal.json` | Active refresh; `version`, exact `previousSet` (a validated set manifest or explicit absence), exact `nextSet` (`sourceRevision`, `sourceFingerprint`, sorted `skills`), and ordered `moves`; every move names a valid `skill` and the token-bound backup path for that exact target |
| `.local/custom_skills/<skill-id>/.workspace-skill-mirror.json` | Platform only; `version`, exact `skill`, `sourceRevision`, `sourceFingerprint`, and sorted `files`; each file record uses the same normalized skill-relative `{"path","sha256"}` schema and validity rules as a projection marker |

The projection-set file is the atomic commit marker. A valid per-skill marker
classifies that directory as helper-owned generated state. No runtime sidecar
classifies a project projection, and no project marker grants permission to
write runtime state.

## Refresh lifecycle

Run:

```sh
pnpm workspace-skill:refresh
```

The helper must:

1. Resolve the explicit source and build a complete revision plus SHA-256
   inventory before taking installation action.
2. Atomically create the projection-root lock directory. Write owner version
   `1`, a fresh unpredictable RFC 4122 UUID token, a positive safe-integer PID,
   and a host matching `[A-Za-z0-9._-]{1,255}`. Validate the token before using
   it in any staging, backup, journal, or cleanup path.
3. Treat a lock as abandoned only when its owner metadata is valid, it belongs
   to the same host, and the recorded PID is proven dead. Foreign-host,
   malformed, unknown, or live locks remain blocking.
4. Recover interrupted work only from a version-`1` helper journal whose
   `previousSet`, `nextSet`, skill IDs, backup basenames, contained paths, and
   ownership token all agree with the valid abandoned owner. Compare the current
   root commit marker before touching a target:
   - if it exactly matches `nextSet`, the transaction committed; preserve every
     installed target and clean only token-owned residue;
   - if it exactly matches `previousSet`, the transaction did not commit; for
     each reverse-ordered move, preserve the target when its backup is absent,
     otherwise remove a replacement target only after its valid marker proves
     helper ownership and restore the backup; or
   - if it matches neither state, is malformed, or cannot prove explicit
     previous absence, block recovery without deleting anything.
5. Copy the entire source snapshot into helper-owned staging, write per-skill
   SHA-256 projection manifests, and validate staged contents.
6. Refuse any target collision with an unmarked project-authored skill.
7. Re-read the complete source revision and fingerprint immediately before
   installation. Abort if either changed.
8. Build the replacement set from every current source skill plus every
   formerly generated skill absent from the new source. Never add an unmarked
   project-authored directory to the replacement or removal set.
9. Install targets through guarded renames recorded in the rollback journal.
   Formerly generated skills absent from the source are removed only through
   this backup-and-commit transaction.
10. Write a complete projection-set manifest to a token-bound temporary file,
    validate it, and atomically rename it over the root commit marker only after
    every skill target is installed.
11. Before that root commit, any failure restores every completed move in
    reverse order and leaves the old committed set authoritative. After the
    root commit, the new set is authoritative: a cleanup failure must be
    reported but must not roll targets back beneath the new commit marker.
12. Clean only lock, stage, backup, journal, and temporary-manifest state proven
    to belong to the current token. Never clean by age, prefix alone, or broad
    directory sweep.

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

Enumerate the physical direct-child projections on every load. The sorted set of
directories carrying valid projection markers must exactly equal both the root
manifest's `skills` array and the current source skill set. Then, before
returning even one requested skill, read and validate every generated skill's
marker, complete recursive physical inventory, and actual file hashes against
the source and root identities. Allow unmarked project-authored skill
directories to coexist, but fail closed on a malformed marker, an extra or
missing generated directory, an extra or missing projected file in any
generated skill, or any metadata/content mismatch. This all-skill exact-set
check prevents a mixed or partially tampered transaction from becoming readable
before or after the root commit.

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
| `1` | The requested ID is malformed, or source is available but mirror metadata is malformed or mismatched |
| `2` | The explicit source, supplied revision, source snapshot, or requested source skill is unavailable |
| `3` | No platform mirror metadata exists for the requested skill |

Unavailable source data is not success. Missing mirror metadata is not inferred
from mirror contents. The repository helper reports status; only the platform
provisions or refreshes the runtime mirror.

## Failure ownership and reporting

Fail closed first, then report a sanitized category, affected skill ID when it
is safe, status/exit code when applicable, and the responsible next action.
Never print source paths, source contents, private revision values, tokens, PIDs,
or raw sidecar data.

| Failure category | Owner and action |
|---|---|
| Source variable, source tree, revision, ID, or inventory unavailable/malformed | Workspace source owner or provisioning workflow; repair the authoritative source, then refresh |
| Unmarked collision or malformed projection marker | Human project owner; resolve authorship explicitly; do not overwrite or relabel automatically |
| Valid live/foreign/unknown lock | Current or unknown lock owner; stop and wait/investigate; do not delete |
| Valid same-host dead lock with valid token-bound journal | Projection helper; perform the bounded rollback sequence, then retry from a fresh source snapshot |
| Projection/set/content drift | Projection helper or repository maintainer; return no content and run an explicit refresh only after source validation succeeds |
| Runtime metadata missing or mismatched | Platform provisioning owner; report code `3` or `1`; never repair `.local/` from repository code |

When validation fails, name the failing contract boundary and preserve failure
ownership. Do not turn unavailable authoritative data into pass, blame runtime
state for a source failure, or fix unrelated failures under this workflow.

## Validation and post-merge behavior

`pnpm run check:skill-mirror-sync` runs fixture-driven contract tests. It must
exercise recursive integrity, unsafe input rejection, project-authored
collisions, revision and fingerprint races, lock ownership, interrupted
rollback, fail-closed loading, status codes, redaction, and the no-runtime-write
boundary without fabricating a live workspace source or platform mirror.

The applicable post-merge validation path must run this fixture contract check,
and the fast validation sequence must keep the same command. Both paths must
fail if the obsolete MD5/runtime-write integration returns. They must not run a
mutating runtime sync, create source metadata, fabricate live platform
provisioning, or treat unavailable live status as pass.

Before completing a lifecycle change, inspect package scripts, post-merge
automation, and validation registration together. Confirm that they invoke the
non-mutating contract test, that live refresh/status remain explicit commands,
and that no path copies project content into `.local/custom_skills/`.

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
- Do not accept a caller-controlled token until its complete UUID shape has
  been validated, and never interpolate an unvalidated value into a path.
- Do not rollback installed targets after the root projection-set commit.
- Do not ignore stale helper-owned projections or validate only the requested
  skill while extra generated state exists.
- Do not expose a partially installed or mixed-revision projection.
- Do not commit private workspace source contents as ordinary project-authored
  skills.