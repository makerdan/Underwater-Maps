import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { execSync, spawn } from "child_process";
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
/**
 * Prevent browsers from caching skill zip downloads served from the Vite
 * public directory (e.g. `public/failure-gate-skill.zip`).
 *
 * Skill zips are regenerated by post-merge.sh after every merge; any
 * browser-cached copy would be stale if the file changes between visits.
 * Vite's static-file handler respects headers set by earlier connect
 * middleware, so we intercept matching requests here before Vite's own
 * serveStaticMiddleware runs and stamp `Cache-Control: no-store`.
 *
 * Pattern: any path ending in `-skill.zip` — covers the current
 * `failure-gate-skill.zip` and any future skill zips added to public/.
 *
 * Covers both the dev server (configureServer) and the preview server
 * (configurePreviewServer) so `vite preview` builds behave identically.
 */
function skillZipNoCachePlugin(): Plugin {
  function addNoCacheMiddleware(server: {
    middlewares: {
      use: (fn: (req: any, res: any, next: () => void) => void) => void;
    };
  }) {
    server.middlewares.use((req: any, res: any, next: () => void) => {
      // Strip query strings before matching.
      const pathname: string = (req.url ?? "").split("?")[0];
      if (pathname.endsWith("-skill.zip")) {
        res.setHeader("Cache-Control", "no-store");
      }
      next();
    });
  }

  return {
    name: "bathyscan:skill-zip-no-cache",
    configureServer(server) {
      addNoCacheMiddleware(server);
    },
    configurePreviewServer(server) {
      addNoCacheMiddleware(server);
    },
  };
}

function devApiRestartPlugin(): Plugin {
  const API_SERVER_PORT = 8080; // matches artifacts/api-server localPort
  const RESTART_LOG = "/tmp/api-server-dev-restart.log";
  const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
  const portCleanupScript = path.resolve(workspaceRoot, "scripts", "kill-port-holders.mjs");

  function killApiServerOnPort(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use the workspace's guarded /proc cleanup path. --include-own-tree is
      // intentional here because a server started by an earlier button click
      // remains a descendant of this Vite process until it exits.
      const cleanup = spawn(
        process.execPath,
        [portCleanupScript, "--include-own-tree", String(API_SERVER_PORT)],
        {
          cwd: workspaceRoot,
          stdio: ["ignore", "ignore", "pipe"],
          env: process.env,
        },
      );
      let stderr = "";
      cleanup.stderr.setEncoding("utf8");
      cleanup.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      cleanup.once("error", reject);
      cleanup.once("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            `Port cleanup failed with exit code ${code ?? "unknown"}${stderr ? `: ${stderr.trim()}` : ""}`,
          ),
        );
      });
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

// The managed artifact uses this port for its preview service. Keep it as a
// build-safe default because Vite loads the full config before production
// builds, even though PORT is only operationally needed by dev/preview.
const DEFAULT_PORT = 23993;
const rawPort = process.env.PORT ?? String(DEFAULT_PORT);

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// This matches the artifact's registered previewPath. BASE_PATH remains
// overridable for alternate hosting environments, but is not required just to
// produce a deployment bundle.
//
// Vite and vite-plugin-pwa both expect a trailing slash. Normalizing here is
// important because appending "/" to an already-normalized root path produced
// the invalid `//sw.js` registration URL in generated production assets.
export function normalizePwaBasePath(value: string | undefined): string {
  const raw = (value ?? "/").trim();
  if (raw === "" || raw === "/") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) {
    throw new Error(`BASE_PATH must be a single-origin path, received "${raw}"`);
  }
  return `${raw.replace(/\/+$/, "")}/`;
}

const basePath = normalizePwaBasePath(process.env.BASE_PATH);

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
    skillZipNoCachePlugin(),
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
      // Keep the generated script URL and scope within the artifact's origin
      // and deployment path. In particular, root is "/" — never "//".
      base: basePath,
      scope: basePath,
      manifest: false,
      injectManifest: {
        // The install-time cache is the app shell, not every optional renderer
        // or data tool. Deferred assets are populated by the CacheFirst route
        // in src/sw.ts after their first successful use, which keeps offline
        // reopening intact without inflating the PWA's first download.
        globIgnores: [
          "assets/excel-*.js",
          "assets/GpsImportDialog-*.js",
          "assets/TourScene-*.js",
          "assets/three-*.js",
        ],
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
    rollupOptions: {
      output: {
        // Keep large, independently cacheable libraries out of the entry
        // chunk. TourScene is lazy-loaded from App.tsx, so its renderer chunks
        // are requested only when the signed-in workspace opens.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("/node_modules/three/")) return "three";
          if (id.includes("/@clerk/")) return "clerk";
          if (id.includes("/recharts/")) return "charts";
          if (id.includes("/exceljs/")) return "excel";
        },
      },
    },
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
