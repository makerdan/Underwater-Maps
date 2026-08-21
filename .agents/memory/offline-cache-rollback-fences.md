---
name: Offline cache rollback fences
description: Rules for safely rolling back transactional offline-cache saves when users retry immediately.
---

Offline-pack cache transactions must snapshot affected entries before any fallible work and record the transaction that currently owns each cache URL. A rollback may restore or delete an entry only while it remains that URL's owner; otherwise it must discard only its own snapshot.

**Why:** A failed or cancelled save can finish cleanup after the user starts and commits a retry. Without ownership fencing, the old transaction can restore stale responses or delete the newly saved cache entries.

**How to apply:** When adding a cache-mutating phase to an offline save, snapshot before the mutation, make missing snapshots a no-op for transactional rollback, and clear the ownership record only if the committing transaction still owns it.