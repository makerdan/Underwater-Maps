---
name: Reference image decode fallback
description: Browser compatibility rule for Special Collection reference-image decoding.
---

Reference-image loading must treat `createImageBitmap()` as an optimization, not
as the only decode path: it may reject a valid image blob in constrained or
headless Chromium environments. Fall through to the `HTMLImageElement` +
object-URL decoder when that happens.

**Why:** Rejecting the entire load makes an otherwise saved and valid Special
Collection reference image disappear from its live overview overlay.

**How to apply:** Any future changes to reference-image loading should retain
both decode paths and test the rejection-to-fallback branch.