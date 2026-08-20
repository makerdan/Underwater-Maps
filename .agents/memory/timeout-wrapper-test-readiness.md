---
name: Timeout-wrapper test readiness
description: The nested timeout-wrapper cleanup test must tolerate slow child startup under workspace load.
---

The nested timeout-wrapper regression test polls for a child-created readiness marker instead of relying on a short output-based startup window.

**Why:** Concurrent validation can delay detached Node child startup long enough to make a correct cleanup implementation look broken.

**How to apply:** When extending process-lifecycle tests, wait for an explicit child readiness signal with a bounded polling deadline, then assert cleanup by probing the recorded descendant PID.