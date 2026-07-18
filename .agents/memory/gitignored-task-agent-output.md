---
name: Gitignored paths silently drop task-agent output
description: Files task agents create under gitignored paths (e.g. .local/) never merge back to main.
---

Task agents merge their work back via git. Anything they write under a gitignored path — notably `.local/` (including `.local/custom_skills/`) — is silently dropped at merge time, even though the task reports MERGED and post-merge succeeds.

**Why:** The Port-Authority workspace skills were built and "verified" across four merged tasks, yet no files ever landed on main; `.local/` is in `.gitignore`, and `.local/custom_skills/` is additionally a platform-managed read-only mirror. The skills had to be rebuilt from their task specs afterwards.

**How to apply:** When scoping a task whose deliverable is files (skills, docs, assets), require a git-tracked destination — e.g. `.agents/skills/` for agent skills — and never `.local/`. When a merged task's deliverable seems missing, check `.gitignore` before suspecting the merge.
