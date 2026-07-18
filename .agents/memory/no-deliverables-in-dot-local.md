---
name: Never write deliverables under .local/
description: .local/ is gitignored; anything written there is lost at task merge — deliverables must live in git-tracked paths.
---

**Rule:** Never write any deliverable (scripts, docs, reports, skills, config, code, exports the user needs) under `.local/`. `.local/` is in `.gitignore`, so nothing there survives a task-agent merge back to main, and it never reaches the user's repo history.

**Why:** Task agents work in isolated environments and merge via git. A deliverable placed under `.local/` silently vanishes at merge — the task looks complete but the artifact is gone. `.local/` also holds platform-managed state (skills, tasks, tmp, locks) that is per-environment by design. This already happened once: a user skill written under `.local/` was lost and had to be rebuilt in a git-tracked location.

**How to apply:**
- Deliverables go in git-tracked locations: `scripts/`, `docs/`, `artifacts/*/`, `.agents/skills/`, etc.
- The ONLY legitimate agent writes under `.local/` are task plan files in `.local/tasks/*.md` — these are consumed at task-creation time (content is copied into the task record), so their loss at merge is harmless.
- User-authored skills belong in `.agents/skills/` (git-tracked), NOT `.local/skills/` or `.local/custom_skills/` (platform-managed, ephemeral).
- When writing or reviewing a plan, double-check every target path an executor will create is not under `.local/`.
