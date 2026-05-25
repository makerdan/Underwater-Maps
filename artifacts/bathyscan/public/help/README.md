# Help screenshots

The PNGs in this folder are referenced from the in-app help articles
(`artifacts/bathyscan/help/articles/*.md`).

They are real captures of the running app. Because the headless screenshot
environment used by the Replit agent cannot create a WebGL context, these are
regenerated manually with a real browser using the Playwright-based capture
script.

## Regenerating

1. Start the dev servers with the auth bypass enabled (a single
   `pnpm test:e2e` run already does this via `playwright.config.ts`, or run
   them manually):

   ```bash
   E2E_AUTH_BYPASS=1 PORT=3151 pnpm --filter @workspace/api-server run dev &
   VITE_DEV_AUTH_BYPASS=1 PORT=3150 BASE_PATH=/ \
     E2E_API_SERVER_URL=http://127.0.0.1:3151 \
     pnpm --filter @workspace/bathyscan run dev &
   ```

2. Run the capture script (uses headless Chromium by default; pass
   `CAPTURE_HEADLESS=0` to watch it in a window):

   ```bash
   pnpm capture:help-screenshots
   ```

3. Inspect the four PNGs (`datasets-panel.png`, `full-screen.png`,
   `upload-dropzone.png`, `depth-profile.png`) and commit if they look right.

The script lives at `scripts/capture-help-screenshots.mjs`.
