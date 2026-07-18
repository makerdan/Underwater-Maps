---
name: Collapsed details sections hide e2e targets
description: e2e specs must expand <details> sections before interacting with their content; hidden-not-missing failures look like flake.
---

Form controls inside a collapsed `<details>` (e.g. FindDataPanel's coord-search-section) exist in the DOM but are hidden, so `toBeVisible()` times out deterministically — this looks like ordering flake but is not.

**Why:** the coordinate-search e2e spec failed in the full run because it never clicked the `<summary>` toggle (coord-search-toggle) to expand the section.

**How to apply:** when an e2e spec fails with "element is hidden" or a visibility timeout on a control that exists in the DOM, check for an enclosing collapsed `<details>`/accordion and click its toggle first.
