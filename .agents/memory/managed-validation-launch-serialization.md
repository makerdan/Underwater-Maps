---
name: Managed validation launch serialization
description: Callback timing limits when a managed validation command waits at a launch barrier.
---

Do not assume a blocked `startValidationRun` call can be released by another `CodeExecution` call in the same parallel batch. In an observed run, the start callback waited for the workflow to exit before the separate restoration/release callback ran; the workflow timed out at its five-minute limit without reaching the test tier.

**Why:** Treating separate callbacks as concurrent caused the gate-release action to arrive after the managed run had already failed, so no validation evidence was produced.

**How to apply:** Use a verified orchestration path that can restore configuration and release a waiting workflow while it is running, or avoid a gated launch. Confirm the run's actual process arguments and that the tier itself started before treating it as evidence.