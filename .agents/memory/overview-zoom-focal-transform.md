---
name: Overview zoom focal transform
description: Geographic registration rules for Overview map zoom input and animation.
---

Overview zoom must be expressed as one focal-point transform in canvas coordinates. Toolbar, wheel, and pinch input should all preserve the geographic point under their pivot, while animated frames should use the same calculation as the final transform. Pinch updates must start from the transform captured when the gesture begins rather than repeatedly scaling the latest frame.

**Why:** Separate formulas and compounding pinch updates can make bitmap, reference-image, and vector layers drift in opposite directions even when each path individually appears to use the current transform.

**How to apply:** Reuse the canonical focal zoom helper for every Overview zoom source, convert CSS pointer coordinates to backing-canvas pixels, and keep geographic placement derived from the live transform.