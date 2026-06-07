import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { execSync } from "child_process";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Keep the Replit mTLS proxy from dropping the Vite HMR WebSocket.
 *
 * Root cause (Vite 7 source confirmed):
 *   When the HMR WebSocket closes unexpectedly, Vite 7's client always calls
 *   location.reload() after waitForSuccessfulPing() succeeds — wiping all
 *   in-memory state including loaded datasets.
 *
 *   The Replit mTLS proxy drops WebSocket connections after ~30 s of idle
 *   time, measured per-connection on the browser→proxy leg. Neither:
 *   • Server-side native WS ping frames (opcode 0x9) — the proxy handles
 *     these at its own layer and doesn't forward them to the browser
 *   • Browser-side JSON data frames (Vite's built-in ping) — the proxy
 *     doesn't count application-layer messages toward idle tracking
 *   …actually reset the proxy's idle timer.
 *
 * Fix — two-pronged:
 *   1. Browser heartbeat (primary): inject a tiny inline script into
 *      index.html that sends a HEAD fetch to /__vite_keepalive every 10 s.
 *      Because both the HMR WebSocket and this HTTP request go through the
 *      same *.replit.dev proxy HOST, the proxy's session idle timer resets
 *      on each fetch — keeping the WebSocket alive.
 *   2. Server-side native WS ping (belt-and-suspenders): sends opcode-0x9
 *      frames every 15 s; harmless if the proxy handles them internally.
 */
function hmrKeepalivePlugin(): Plugin {
  return {
    name: "bathyscan:hmr-keepalive",
    apply: "serve",

    configureServer(server) {
      // ── 1a. HTTP keepalive endpoint ──────────────────────────────────────
      // Responds 204 with no body. The browser fetches this every 10 s so
      // that the proxy session (shared with the HMR WS) never goes idle.
      server.middlewares.use("/__vite_keepalive", (_req, res) => {
        res.writeHead(204, { "Cache-Control": "no-store" });
        res.end();
      });

      // ── 1b. Server-side native WS ping (belt-and-suspenders) ─────────────
      // "connection" is in Vite 7's wsServerEvents so this routes directly
      // to the underlying ws.WebSocketServer; the callback gets the raw
      // ws.WebSocket instance which has .ping() for native opcode-0x9 frames.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (server.ws.on as any)("connection", (socket: any) => {
        if (!socket || typeof socket.ping !== "function") return;
        const id = setInterval(() => {
          if (socket.readyState === 1 /* WebSocket.OPEN */) socket.ping();
        }, 15_000);
        socket.on("close", () => clearInterval(id));
      });
    },

    // ── 2. Browser heartbeat script ─────────────────────────────────────────
    // Injected before anything else in <head>. Uses an absolute-path URL
    // (/__vite_keepalive) so it works regardless of the app's base path.
    // The fetch goes to the same Replit proxy host as the HMR WebSocket,
    // resetting the proxy's session idle timer.
    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { type: "text/javascript" },
          injectTo: "head-prepend" as const,
          children: [
            "(function(){",
            "  if(typeof fetch!=='function')return;",
            "  setInterval(function(){",
            "    fetch('/__vite_keepalive',{method:'HEAD',cache:'no-store'}).catch(function(){});",
            "  },10000);",
            "})();",
          ].join(""),
        },
      ];
    },
  };
}

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
    hmrKeepalivePlugin(),
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
    // The actual proxy-keepalive mechanism is hmrKeepalivePlugin() above.
    hmr:
      process.env.VITE_DEV_AUTH_BYPASS === "1"
        ? { overlay: false }
        : undefined,
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
