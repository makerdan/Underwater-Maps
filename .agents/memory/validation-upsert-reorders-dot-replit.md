---
name: Validation upserts reorder .replit
description: Why temporary task-locked validation command changes can leave a semantic no-op .replit diff.
---

`setValidationCommand` may reorder a workflow's metadata block even when the
canonical command is restored unchanged.

**Why:** A temporary task-locked validation upsert followed by restoration left
a tracked `.replit` diff containing only metadata-table ordering changes.

**How to apply:** After restoring a temporarily modified validation command,
check `.replit` for incidental drift. If present, restore the intended complete
file through `verifyAndReplaceDotReplit`; do not edit `.replit` directly.