---
name: EFH browser fixture hydration
description: Durable setup constraints for authenticated browser coverage of EFH controls.
---

Bridge-seeded EFH catalog entries are vulnerable to being replaced by the
initial settings and catalog-query hydration cycle. A browser test can have a
correct intercepted response and still not render EFH controls if it seeds
before that cycle settles.

**Why:** The authenticated shell restores water type and active dataset while
the test bridge is also mutating those values, so the visible dataset and the
query cache can temporarily disagree.

**How to apply:** Wait for the authenticated shell and active dataset to settle,
then seed the relevant catalog cache again before asserting EFH controls. Keep
an explicit environment-gate skip for runs where the signed-in EFH control is
not rendered, and update the e2e skip audit/baseline with the same change.