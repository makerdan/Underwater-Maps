---
name: Stale validation waiters and PID reuse
description: Why a dead validation lock may not release a waiting lower-priority tier.
---

**Rule:** If a validation tier still waits after the stale lock's dead holder has
been safely reclaimed, inspect priority-queue waiter manifests. A stale
manifest can appear live when its old PID has since been reused by an unrelated
thread. Confirm its age, the current PID's identity and that it is not an
actual validation waiter before removing only that obsolete runtime manifest.

**Why:** A heavy run remained queued after safe lock cleanup because an
August manifest's PID was reused by a current thread of the validation
process. A liveness-only priority check treated that obsolete higher-priority
entry as active.

**How to apply:** Distinguish the lock holder from queue entries; do not delete
live locks or sweep every waiter. Prefer the project's safe stale-lock cleaner
for dead holders. Remove a single proven stale queue entry only after checking
its timestamp and current process identity. Keep runtime cleanup separate
from tracked deliverables and do not turn a queued/interrupted run into a pass.