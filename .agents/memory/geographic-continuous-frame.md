---
name: Geographic continuous longitude frame
description: Shared rule for comparing and converting GPS/map longitudes around the antimeridian.
---

Treat a dataset longitude interval as a continuous eastward frame beginning at
its `minLon`. For a wrapped bbox, values on the western side of the antimeridian
are represented as `lon + 360` for comparisons, fractions, and grid indexing;
convert back to the normal longitude range only at external boundaries.

**Why:** Ordinary numeric min/max checks disagree with antimeridian-aware map
transforms, hiding valid GPS fixes or generating invalid teleport targets.

**How to apply:** Reuse the shared geographic bounds functions for GPS
eligibility, map overlays, hit tests, and 2D coordinate conversion. Preserve
primary-grid clamping before issuing a 3D drop-in for secondary-only points.