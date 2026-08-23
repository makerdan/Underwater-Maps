---
name: Overview reference overlay browser coverage
description: Browser regressions for special-collection reference images must wait for the live transform snapshot after viewport changes.
---

Resize-driven canvas work is asynchronous: after changing the browser viewport, wait for the next live overlay snapshot before asserting geographic placement. Cover both the two-anchor affine path and the no-anchor dataset-bounds path, and assert opacity remains unchanged.

**Why:** The canvas resize handler and animation-frame mirror do not publish state at the same instant as Playwright's viewport resize call, which can otherwise create false failures or read a transient null snapshot.

**How to apply:** In future OverviewMap reference-image e2e tests, drive an actual narrow-to-wide viewport change, wait for the live snapshot to be republished, then validate placement against the current transform.