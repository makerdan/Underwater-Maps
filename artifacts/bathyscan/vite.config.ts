import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { execSync } from "child_process";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Build-time guard: fail the production build if the dev-only e2e test
 * back door (`window.__bathyTest`, installed by `src/lib/testHelpers.ts`)
 * leaks into any emitted chunk. The helpers expose a
 * `setRequestHeaders` API that can forge auth headers on real DELETE
 * calls, so they must never ship.
 *
 * Paired with the call-site gate in `src/main.tsx` and the runtime
 * `PROD` throw in `installTestHelpers` — this plugin catches the case
 * where someone re-introduces an unconditional call (Vite's dead-code
 * elimination would still inline the throw, and we would catch it
 * here before it could ever reach a deploy).
 */
function failOnTestBackdoor(): Plugin {
  const NEEDLE = "__bathyTest";
  return {
    name: "bathyscan:fail-on-test-backdoor",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      if (process.env.NODE_ENV !== "production") return;
      const offenders: string[] = [];
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") continue;
        if (chunk.code.includes(NEEDLE)) offenders.push(fileName);
      }
      if (offenders.length > 0) {
        throw new Error(
          `[bathyscan] production bundle contains the dev-only test back door "${NEEDLE}". ` +
            `Offending chunks: ${offenders.join(", ")}. ` +
            `See artifacts/bathyscan/src/lib/testHelpers.ts for the gating contract.`,
        );
      }
    },
  };
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

function getBuildHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return String(Date.now());
  }
}

const buildHash = getBuildHash();

export default defineConfig({
  base: basePath,
  define: {
    __BUILD_HASH__: JSON.stringify(buildHash),
  },
  plugins: [
    failOnTestBackdoor(),
    react(),
    tailwindcss({ optimize: false }),
    // The runtime error overlay intercepts pointer events whenever any
    // runtime error fires (e.g. headless Chromium failing to create a
    // WebGL context). That blocks Playwright clicks against the HUD.
    // Skip the overlay plugin in e2e auth-bypass mode so the dev server
    // stays clickable. Production builds are unaffected.
    ...(process.env.VITE_DEV_AUTH_BYPASS === "1" ? [] : [runtimeErrorOverlay()]),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: "auto",
      base: basePath + "/",
      manifest: false,
      devOptions: {
        enabled: false,
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom", "zustand"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    // Vite's built-in HMR error overlay (`<vite-error-overlay>`) is a separate
    // element from the Replit runtime-error modal plugin above. It intercepts
    // pointer events whenever a transient runtime error (e.g. a benign WebGL
    // "Error creating WebGL context" warning in headless Chromium) fires, even
    // after the app has rendered successfully. Disable it under the e2e
    // auth-bypass build so Playwright clicks reach the HUD directly.
    //
    // timeout also controls the client-side ping interval (Vite 7 source:
    // `pingInterval: hmrTimeout`). The Replit mTLS proxy has a ~30 s idle
    // WebSocket timeout; with the default 30 000 ms there is a race where the
    // proxy drops the connection just before the ping lands, causing a full
    // page reload. 15 000 ms keeps the connection alive with comfortable margin.
    hmr:
      process.env.VITE_DEV_AUTH_BYPASS === "1"
        ? { overlay: false, timeout: 15000 }
        : { timeout: 15000 },
    // In e2e mode, the api-server is started on a separate port by Playwright
    // and the frontend's relative `/api/*` requests must be proxied to it.
    ...(process.env.E2E_API_SERVER_URL
      ? {
          proxy: {
            "/api": {
              target: process.env.E2E_API_SERVER_URL,
              changeOrigin: true,
            },
          },
        }
      : {}),
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
