---
name: Terrain shader palette dominance
description: Palette color is the base hue in the terrain fragment shader; substrate textures are luminance detail only, never a multiplier.
---

Rule: in the terrain fragment shader, the depth-palette vertex color (vColor) must be the base color. Substrate textures contribute only a scalar luminance detail factor clamped near 1.0 (currently `clamp(0.85 + (texLum-0.35)*0.9, 0.7, 1.15)`), and lighting keeps a high ambient floor (0.55) with a cap (1.2).

**Why:** the substrate textures are dark (~0.2–0.4 luminance); the old `finalColor = texColor * vColor * 1.6` multiply chain crushed every palette into dark khaki/green, so switching palettes was nearly invisible on the terrain.

**How to apply:** any new shader color feature must blend against `finalColor`/`lighting` with `mix()`, never multiply palette by raw texel RGB. A TS-mirror + source-guard test (`terrainShader-palette-dominance.test.ts`) pins the formulation — update it in lockstep with deliberate shader changes.

Verification note: real 3D-viewport screenshots are impossible headless on this host (Chromium GPU crash → stub canvas); verify shader math via TS mirrors, and palette plumbing via the 2D overview-map render in a bridged browser session.
