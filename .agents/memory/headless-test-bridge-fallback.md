---
name: Headless test-bridge fallback
description: Test-bridge callbacks registered by Canvas-mounted hooks never register in headless Playwright; provide pure-function fallbacks.
---
Rule: any `__bathyTest` API that invokes a callback registered by a hook mounted inside the Three.js Canvas (e.g. useFlyControls) will silently return false in headless Playwright, because WebGL never initialises and the Canvas subtree never mounts.

**Why:** camera-spawn e2e tests failed with `spawnOk === false` — the registry was empty, not the spawn logic wrong.

**How to apply:** extract the production logic into a pure lib function and have the test-bridge fall back to running it against the fly-wheel rig camera + React-bound terrain when no callback is registered (pattern: resetCameraForSpawn → applyCameraSpawn).
