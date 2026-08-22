---
name: Mobile coordinate-search e2e coverage
description: The mobile shell uses a compact dataset picker without coordinate search.
---

The coordinate/radius search journey is currently owned by the desktop Find Data flow; the mobile shell's "Choose a dataset" action opens a different picker with no coordinate form.

**Why:** A narrow Playwright viewport alone routes the app into the mobile shell, so a coordinate-search e2e can silently skip or hang at the desktop entry point.

**How to apply:** Keep coordinate-flow coverage explicit and, if narrow viewport coverage is required, document whether the test is validating the desktop overlay at narrow dimensions or the mobile picker separately.