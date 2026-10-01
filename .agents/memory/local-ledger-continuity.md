---
name: Local validation ledger continuity
description: Why retained Git plans cannot replace missing local allocation, lease and audit history.
---

Treat local ledger continuity as a separate prerequisite from accepted plan
content or committed projections. Do not recreate history or infer an allocator
high-water mark from plan files.

**Why:** A later session observed tracked plans but an apparently fresh home
ledger that allocated an already represented ID. The original history and cause
were unavailable. Plans are not backups of cancellations, audit events or leases.
Official platform documentation confirmed that files outside the project are
not automatically included in project checkpoints or task-agent merges.
That storage boundary does not establish why a particular ledger disappeared.

**How to apply:** Preserve a SQLite-consistent original ledger backup and stable
writer-lock identity across handoffs. If available retained history conflicts
with tracked plans, fail closed and investigate; do not claim platform storage
durability, reset a namespace silently or reconstruct missing state.
Do not choose home-only storage when continuity through task-agent handoffs is
required without a separately verified persistence/consistent-backup mechanism.