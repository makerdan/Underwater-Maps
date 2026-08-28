---
name: Fly-control test camera spawn
description: Terrain-backed fly-control tests must account for mount-time camera spawning before measuring frame displacement.
---

When a fly-control hook test mounts with a non-null terrain grid, the hook may
apply the configured camera spawn position and pitch during its mount effects.
Capture the baseline camera position after mounting, then compare the post-frame
position against that baseline rather than against the pre-mount origin.

**Why:** Measuring from the origin includes the mount-time spawn offset and
pitch, producing a false mismatch with the movement distance even when the
physics are correct.

**How to apply:** For terrain-backed movement tests, mount first, snapshot the
camera, drive the frame, and assert the displacement vector or its length.