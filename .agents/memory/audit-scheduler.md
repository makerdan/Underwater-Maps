---
name: Audit scheduler pending tasks
description: After post-merge setup, the agent must run queue-audits.mjs via code_execution to create any due audit project tasks that the shell run could not create.
---

# Audit Scheduler — Post-Merge Agent Action

## The rule
After calling `runPostMergeSetup()`, check whether `.local/pending-audit-tasks.json` exists. If it does, run `scripts/queue-audits.mjs` via the code_execution sandbox so `bulkCreateProjectTasks` is available and due audit tasks are actually created.

**Why:** `post-merge.sh` runs `node scripts/queue-audits.mjs` in a plain bash shell where Replit platform globals (`bulkCreateProjectTasks`, `searchProjectTasks`) are absent. In that context the script increments counters and writes the pending file but cannot create tasks. Counters are deliberately NOT reset in shell context — they stay elevated so the platform-context run sees them as still due.

**How to apply:**
1. After `runPostMergeSetup()` completes, run in code_execution:
   ```javascript
   // Import and run the scheduler in platform context
   const { readFileSync, existsSync } = await import('fs');
   const pendingPath = '/home/runner/workspace/.local/pending-audit-tasks.json';
   if (existsSync(pendingPath)) {
     // queue-audits.mjs uses top-level await — run via dynamic import
     await import('/home/runner/workspace/scripts/queue-audits.mjs');
   }
   ```
2. If no pending file exists, no action needed — no audits were due this merge.

## Counter design
- `lastProcessedCommit` in `.local/audit-counter.json` stores the git SHA of the last processed merge. Running the script again for the same SHA is a no-op (retry safety).
- Counters are only reset AFTER `bulkCreateProjectTasks` confirms creation (platform context). Shell runs leave counters elevated.
- Six audits with cadences: Validation (10), Security (10), Memory/GPU (15), Schema Drift (10), Dependency Health (20), Accessibility (20).
