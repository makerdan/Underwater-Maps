---
name: Standalone bathyscan vite + headless screenshot
description: Env vars needed to boot bathyscan's vite on a throwaway port, and the playwright chromium channel workaround.
---

# Booting bathyscan standalone for visual checks

To run the bathyscan dev server on a throwaway port (outside the managed workflow), it needs:
`PORT=<port> BASE_PATH=/bathyscan/ VITE_DEV_AUTH_BYPASS=1 pnpm --filter @workspace/bathyscan run dev`
— without `BASE_PATH` the app 404s (root-mounted assets vs artifact base path); without the bypass, Clerk blocks rendering headlessly.

**Playwright screenshot gotcha:** the default bundled headless-shell crashes in this environment with a V8 snapshot error. Use `chromium.launch({ channel: "chromium" })` instead.
