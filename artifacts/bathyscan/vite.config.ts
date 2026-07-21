import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { execSync, exec, spawn } from "child_process";
import fs from "fs";
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
      // ── 1. Server→client custom event broadcast ──────────────────────────
      // Every 10 s the server sends a vite:keepalive custom event to every
      // connected HMR client. The client (see transformIndexHtml below)
      // responds immediately with import.meta.hot.send(), which calls
      // ws.send() on the actual HMR WebSocket — creating genuine
      // browser→proxy WebSocket frame traffic that resets the proxy's
      // per-connection idle timer on the browser→proxy leg.
      //
      // This is necessary because:
      //  • Server-side native pings (opcode 0x9) are handled by the proxy
      //    at its own layer and do NOT reach the browser→proxy idle counter.
      //  • HTTP fetch keepalives only reset the timer for the first request
      //    (new TCP connection); subsequent fetches reuse the pooled TCP
      //    connection and the proxy doesn't count them as new activity.
      //  • Only actual WebSocket text frames FROM the browser reset the
      //    browser→proxy leg idle timer reliably.
      const broadcastId = setInterval(() => {
        server.ws.send({ type: "custom", event: "vite:keepalive" });
      }, 10_000);
      server.httpServer?.once("close", () => clearInterval(broadcastId));

      // ── 2. Server-side native WS ping (belt-and-suspenders) ──────────────
      (server.ws.on as any)("connection", (socket: any) => {
        if (!socket || typeof socket.ping !== "function") return;
        const id = setInterval(() => {
          if (socket.readyState === 1 /* WebSocket.OPEN */) socket.ping();
        }, 15_000);
        socket.on("close", () => clearInterval(id));
      });

      // ── 3. HTTP keepalive endpoint (belt-and-suspenders fallback) ─────────
      server.middlewares.use("/__vite_keepalive", (_req, res) => {
        res.writeHead(204, { "Cache-Control": "no-store" });
        res.end();
      });
    },

    // ── 4. Browser-side WS reply handler ────────────────────────────────────
    // The handler is registered in src/main.tsx (a real Vite module) so that
    // Vite's transform pipeline injects the import.meta.hot context.
    // Inline HTML <script type="module"> blocks are NOT transformed by Vite,
    // so import.meta.hot would be undefined inside them — do not use that.
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

/**
 * Dev-only "Restart API Server" endpoint, served by the Vite dev server —
 * deliberately NOT by the API server, which is down exactly when the button
 * is needed. Backs the DevApiDownBanner component.
 *
 * POST /__restart_api_server:
 *   1. Kills whatever currently listens on the API server port (if anything —
 *      typically nothing, since the button appears when the server is dead).
 *   2. Spawns a fresh detached `pnpm --filter @workspace/api-server run dev`
 *      from the workspace root, logging to /tmp/api-server-dev-restart.log.
 *   3. Responds 202 immediately; the client's health poll detects recovery.
 *
 * `apply: "serve"` means this plugin only exists on the dev server — no
 * restart route is ever served by a production build (which is static assets
 * with no Vite server at all).
 */
function devApiRestartPlugin(): Plugin {
  const API_SERVER_PORT = 8080; // matches artifacts/api-server localPort
  const RESTART_LOG = "/tmp/api-server-dev-restart.log";
  const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");

  function killApiServerOnPort(): Promise<void> {
    return new Promise((resolve) => {
      // Kill by port so we catch both workflow-started and previously
      // restart-spawned instances. Errors (nothing listening) are ignored.
      exec(
        `pids=$(lsof -ti tcp:${API_SERVER_PORT} 2>/dev/null); [ -n "$pids" ] && kill $pids 2>/dev/null; exit 0`,
        () => setTimeout(resolve, 300),
      );
    });
  }

  function spawnApiServer(): void {
    const logFd = fs.openSync(RESTART_LOG, "a");
    const child = spawn(
      "pnpm",
      ["--filter", "@workspace/api-server", "run", "dev"],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          PORT: String(API_SERVER_PORT),
          NODE_ENV: "development",
        },
        detached: true,
        stdio: ["ignore", logFd, logFd],
      },
    );
    child.unref();
    fs.closeSync(logFd);
  }

  return {
    name: "bathyscan:dev-api-restart",
    apply: "serve",
    configureServer(server) {
      let inFlight = false;
      server.middlewares.use("/__restart_api_server", (req, res) => {
        const json = (status: number, body: object) => {
          res.writeHead(status, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(JSON.stringify(body));
        };
        if (req.method !== "POST") {
          json(405, { error: "method not allowed" });
          return;
        }
        if (inFlight) {
          json(409, { status: "already-restarting" });
          return;
        }
        inFlight = true;
        void (async () => {
          try {
            await killApiServerOnPort();
            spawnApiServer();
            json(202, { status: "restarting" });
          } catch (err) {
            json(500, { error: String(err) });
          } finally {
            // Debounce: block repeat restarts for a few seconds while the
            // freshly spawned server builds and boots.
            setTimeout(() => {
              inFlight = false;
            }, 5_000);
          }
        })();
      });
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
    devApiRestartPlugin(),
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
      injectManifest: {
        // The main index chunk is ~2.7 MB (three.js + app code), above
        // workbox's 2 MB default. Raise the cap so the chunk is precached
        // and the production build doesn't fail.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
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
