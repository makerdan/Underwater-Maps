---
name: Vite dedupe zustand
description: @react-three/drei's tunnel-rat dep requires Zustand v4, creating dual-version risk alongside app's Zustand v5; dedupe forces one copy.
---

## Rule
`zustand` must be in `resolve.dedupe` in `artifacts/bathyscan/vite.config.ts`.

**Why:** `@react-three/drei` depends on `tunnel-rat@0.1.2`, which requires `zustand@4.5.7`. pnpm installs both versions. If Vite bundles both, there can be "Invalid hook call" errors from mismatched hook dispatchers. Adding `zustand` to `resolve.dedupe` forces Vite to use a single Zustand instance (v5) for all consumers.

**How to apply:** `resolve.dedupe` in `vite.config.ts` should always contain `["react", "react-dom", "zustand"]`. If new packages are added that bring in duplicate React renderers or conflicting store libraries, add them to dedupe as well.
