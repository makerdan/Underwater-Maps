---
name: Puzzle layout density metadata
description: Pixel-based puzzle offsets need the save-time geographic pixel density to restore accurately on another viewport.
---

Persisted puzzle transforms retain their historical pixel-offset shape for compatibility, while new named layouts and transform sessions should carry optional save-time effective pixels-per-degree metadata. Restore only rebases when valid metadata exists; legacy entries remain readable without assumptions.

**Why:** A raw pixel gap represents a different geographic distance after restoring a layout on a differently sized canvas or at a different zoom.

**How to apply:** Whenever puzzle transforms are serialized or restored, preserve the legacy payload shape and pair it with optional density metadata; rebase offsets before rendering or publishing geographic corrections.