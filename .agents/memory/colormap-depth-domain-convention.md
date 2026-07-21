---
name: Colormap depth-domain convention
description: Which palette themes normalise depth absolutely vs grid-relatively, and how legends stay aligned.
---

Ocean and custom band themes map depth on the **absolute** 0–2000 ft scale (`getColormapDepthDomain` → `[0, OCEAN_MAX_DEPTH_M]`); fixed ramps (thermal/grayscale/viridis/freshwater) stay **grid-relative** (dataset min/max).

**Why:** band stops are authored at t = feet/2000; normalising a shallow lake grid-relatively stretched it across the whole ramp, so 10 m lakes rendered in near-black deep colours and on-screen colours contradicted DepthLegend/DepthScaleBar labels.

**How to apply:** any new consumer that turns depth into a colormap t must go through `getColormapDepthDomain(theme, min, max)`; legends/scale bars that show only the dataset's slice must crop the gradient with `getColormapTRange` (passed as the optional `tRange` arg to `colormapCssGradient`/`colormapCanvas`). Regression tests live in bathyscan `terrain.test.ts` ("absolute-feet depth mapping").
