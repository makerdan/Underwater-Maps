# Skill: Skill Mirror Sync

## Purpose

Replit projects that maintain user-authored skills store the canonical versions
under `.agents/skills/<name>/SKILL.md`. Replit also exposes a runtime copy of
each skill at `.local/custom_skills/<name>/SKILL.md`. The `.local/` tree is
gitignored and populated by the platform at environment-setup time, so those
copies can silently lag behind edits made to the canonical `.agents/skills/`
sources.

This skill documents the contract between the two trees, explains when to
invoke it, and provides a registration checklist for new skills and remediation
steps when drift is detected.

---

## Trigger

Invoke this skill when:

1. You are **adding a new user-authored skill** to `.agents/skills/` and need
   to know what (if anything) must be updated so the mirror is tracked and
   validated automatically.
2. A **validation check reports that a skill mirror is stale** — a stored
   `.fingerprint` does not match the md5 of the canonical `SKILL.md` — and you
   need to understand the canonical-vs-local contract and how to fix it.
3. You are **auditing skill health** and want to verify that every skill with a
   counterpart in `.local/custom_skills/` has an up-to-date copy and a current
   fingerprint.
4. You are investigating **unexpected agent behaviour** that could be caused by
   an agent reading stale skill instructions from `.local/custom_skills/`
   instead of the canonical `.agents/skills/` source.

---

## The Canonical-vs-Local Contract

| Property | Canonical source | Live copy |
|---|---|---|
| **Location** | `.agents/skills/<name>/SKILL.md` | `.local/custom_skills/<name>/SKILL.md` |
| **Tracked by git** | ✅ Yes | ❌ No (`.local/` is gitignored) |
| **Edited by humans / agents** | ✅ Always edit here | ❌ Never edit here — overwritten on sync |
| **How it is populated** | Manual creation | Platform install + project post-merge sync |
| **Drift detection** | `.local/custom_skills/<name>/.fingerprint` stores the md5 of the last-synced canonical file | Compared on every fast-tier CI run |

### How skills are discovered — auto-enumeration

Both the drift-detection check script and the post-merge sync step use
**dynamic discovery**: they iterate over every subdirectory in `.agents/skills/`
and, for each one that has a matching directory in `.local/custom_skills/`,
compare or refresh the copy. There are **no per-skill registration entries** in
either script; adding a new directory under `.agents/skills/` is sufficient for
it to be picked up automatically on the next run.

### Fingerprint file

Each live copy directory may contain a `.fingerprint` file whose sole content
is the hex md5 of the canonical `SKILL.md` at the time of the last sync. The
drift-detection check reads this file and re-computes the md5 of the canonical
source; a mismatch means the live copy is stale.

### How the live-copy directory is first created

The platform creates `.local/custom_skills/<name>/` at environment-setup time
for every skill it finds under `.agents/skills/`. A brand-new skill committed
to `.agents/skills/` will have its live-copy directory created at the **next
environment setup** after the commit lands. Once that directory exists, the
post-merge sync step keeps the live copy and its `.fingerprint` current on
every subsequent merge — no manual wiring needed.

### Out-of-scope cases

- Skills that exist **only** in `.local/custom_skills/` (Replit-provided
  skills with no `.agents/skills/` counterpart) are not tracked by this system.
- The post-merge sync step does **not** create new `.local/custom_skills/`
  entries on its own; it only refreshes directories that already exist (created
  by the platform at environment-setup time, as described above).

---

## Adding a New Skill — Registration Checklist

When you create a new skill under `.agents/skills/<new-name>/SKILL.md`, verify
**three categories** of project infrastructure before considering the skill
fully integrated:

1. **Drift-detection check** — this check auto-discovers all canonical skill
   directories; no per-skill entry is needed. Verify only that the check itself
   is still registered as a step in the fast-tier validation sequence (it should
   already be — confirm it has not been accidentally removed).

2. **Post-merge automation** — the sync step also auto-discovers all canonical
   skill directories; no per-skill entry is needed. Verify only that the sync
   step itself is still present in the post-merge automation (it should already
   be — confirm it has not been accidentally removed).

3. **Fast-tier validation config** — if the drift-detection check is already
   registered (the normal case), no change is needed. If this is the first time
   the check is being introduced to the project, add it to the fast-tier step
   list in the project's validation configuration and add a corresponding npm
   script.

> **Initial live copy:** After the new canonical skill is committed and merged,
> trigger an environment restart so the platform creates the
> `.local/custom_skills/<new-name>/` directory. The post-merge sync step will
> then populate it automatically on the next merge.

---

## Remediation: When the Check Fails

### Cause

The md5 of `.agents/skills/<name>/SKILL.md` no longer matches the value stored
in `.local/custom_skills/<name>/.fingerprint`. This means `.agents/skills/`
was updated but the live copy was not re-synced.

### Fix

Run the project's post-merge sync step. It:

1. Copies `.agents/skills/<name>/SKILL.md` → `.local/custom_skills/<name>/SKILL.md`
2. Rewrites `.local/custom_skills/<name>/.fingerprint` with the new md5

After the sync completes, re-run the drift-detection check; it should exit 0.

### If the `.fingerprint` file is missing entirely

The live copy directory exists but was never fingerprinted. Run the same
post-merge sync step — it creates or overwrites `.fingerprint` unconditionally.

### What NOT to do

- Do **not** edit `.local/custom_skills/<name>/SKILL.md` directly. It is
  overwritten by every sync run.
- Do **not** manually write a `.fingerprint` value by hand unless you have
  verified it matches the md5 of the current canonical file.
