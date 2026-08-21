---
name: Validation-lock detached child lifecycle
description: An unref'd detached validation child needs a separate referenced lifecycle handle until its exit event.
---

`ChildProcess.unref()` alone can let validation-lock.mjs exit before its detached child, especially when stdio is ignored or noninteractive. Keep a small referenced lifecycle handle and clear it from the child exit handler so the lock is released only after the process group has been handled.

**Why:** An orphaned detached group can keep ports and shared state active after the lock wrapper has exited.

**How to apply:** When changing validation-lock child spawning or signal forwarding, preserve both process-group termination and an explicit parent lifecycle reference.