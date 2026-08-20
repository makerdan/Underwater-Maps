import "./lib/suppressThreeClockWarn";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { assertDevAuthBypassSafe, installDevAuthFetchPatch } from "./lib/devAuth";
import { patchPerformanceMeasure } from "./lib/patchPerformanceMeasure";
import { startDevHealthWatch } from "./lib/queryClient";
import { registerSW } from "virtual:pwa-register";
import { startServiceWorkerRegistration } from "./lib/serviceWorkerReadiness";

// Dev-only proactive API health watch: pings /api/healthz every few seconds
// so the "API server down" banner appears even before any screen has fetched
// anything. In production builds `import.meta.env.DEV` is statically false,
// the body is dead code, and the watch never runs.
if (import.meta.env.DEV) {
  startDevHealthWatch();
}

// Keep the Replit mTLS proxy from dropping the HMR WebSocket.
// The server (hmrKeepalivePlugin in vite.config.ts) broadcasts a
// "vite:keepalive" custom event every 10 s. We respond with hot.send(),
// which calls ws.send() on the actual HMR WebSocket — creating genuine
// browser→proxy WebSocket frame traffic that resets the proxy's
// per-connection idle timer before the 30 s timeout fires.
// Must live in a real Vite module (not an inline HTML script) so that
// Vite's transform pipeline injects the import.meta.hot context.
if (import.meta.env.DEV && import.meta.hot) {
  import.meta.hot.on("vite:keepalive", () => {
    import.meta.hot!.send("vite:keepalive-ack", {});
  });
}

patchPerformanceMeasure();
assertDevAuthBypassSafe();
installDevAuthFetchPatch();
// Explicit registration gives the offline-save path access to registration
// rejection instead of relying on a later, indistinguishable `.ready`
// timeout. Importing virtual:pwa-register also tells vite-plugin-pwa not to
// inject its silent auto-registration script.
if (import.meta.env.PROD) {
  startServiceWorkerRegistration(
    () =>
      new Promise((resolve, reject) => {
        try {
          registerSW({
            immediate: true,
            onRegisteredSW: (_scriptUrl, registration) => {
              if (registration) resolve(registration);
              else reject(new Error("No service worker registration was returned"));
            },
            onRegisterError: reject,
          });
        } catch (cause) {
          reject(cause);
        }
      }),
  );
}
// Hard call-site gate: in a production build, `import.meta.env.DEV` is
// statically replaced with `false`, the whole `if` body becomes dead code,
// and the `installTestHelpers` import is tree-shaken away — so `__bathyTest`
// (and the forge-auth-headers helpers it exposes) cannot reach the bundle.
// See `lib/testHelpers.ts` header for the full defense-in-depth story.
if (
  import.meta.env.DEV &&
  import.meta.env.VITE_DEV_AUTH_BYPASS === "1"
) {
  void import("./lib/testHelpers").then(({ installTestHelpers }) => {
    installTestHelpers();
  });
}

createRoot(document.getElementById("root")!).render(<App />);
