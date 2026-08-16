---
name: skill-mirror-sync check failures
description: Why check:skill-mirror-sync fails after skill merges and how to repair without touching tracked files
---

# skill-mirror-sync check failures

**Rule:** When `check:skill-mirror-sync` (fast tier) fails with stale fingerprints, repair by re-running the mirror-sync block from `scripts/post-merge.sh` (copy each canonical `.agents/skills/<name>/SKILL.md` over `.local/custom_skills/<name>/SKILL.md`, case-insensitive dir match, and write md5 to `.fingerprint`). This touches ONLY gitignored `.local/` files — zero tracked-file diff, safe even inside a strictly scoped task.

**Why:** `.local/` is gitignored, so git merges never update the mirror copies; any merge that edits a canonical SKILL.md leaves every environment's mirrors stale until the post-merge sync runs there. The check is wired into the fast tier, so a stale environment fails ALL tiers.

**How to apply:** If test-fast fails on skill mirrors right after a skill-related merge synced into your environment, sync mirrors first — it is environment hygiene, not a code regression.

# Completion-review foreign-commit attribution

**Rule:** The completion code review diffs your environment tip against the task-start snapshot. If another task's merge syncs into your environment mid-session, its commits appear in YOUR review diff and can cause rejection for scope violation.

**Why:** This happened on a zero-diff confirm task: a concurrently merged guard commit was attributed to it and the review rejected with "implements a separate feature across five unrelated files".

**How to apply:** When rejected for changes you never made, check `git log` — if the foreign commit is already on `main-repl/main`, state its provenance (hash + owning task) in `drift_reason`, confirm your own diff is empty/scoped, and retry with `request_fresh_code_review: true`.
