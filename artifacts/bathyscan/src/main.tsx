import "./lib/suppressThreeClockWarn";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installTestHelpers } from "./lib/testHelpers";
import { assertDevAuthBypassSafe, installDevAuthFetchPatch } from "./lib/devAuth";
import { patchPerformanceMeasure } from "./lib/patchPerformanceMeasure";
import { startDevHealthWatch } from "./lib/queryClient";

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
// Hard call-site gate: in a production build, `import.meta.env.DEV` is
// statically replaced with `false`, the whole `if` body becomes dead code,
// and the `installTestHelpers` import is tree-shaken away — so `__bathyTest`
// (and the forge-auth-headers helpers it exposes) cannot reach the bundle.
// See `lib/testHelpers.ts` header for the full defense-in-depth story.
if (
  import.meta.env.DEV &&
  import.meta.env.VITE_DEV_AUTH_BYPASS === "1"
) {
  installTestHelpers();
}

createRoot(document.getElementById("root")!).render(<App />);
