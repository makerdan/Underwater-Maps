---
name: Replit proxy HMR WS keepalive
description: The Replit mTLS proxy drops WebSocket connections after ~30 s of idle time. Fix: browser sends a HEAD fetch to a Vite endpoint every 10 s, resetting the proxy's session idle timer.
---

## The rule
Any long-lived WebSocket connection through the Replit mTLS proxy requires the **browser to send periodic HTTP requests to the same Vite dev server origin** to reset the proxy's session idle timer.

**Why:** Three key facts discovered through empirical testing:
1. The Replit proxy drops WS connections at ~30 s idle (per-connection timer on the browser→proxy leg).
2. Server-side native WS ping frames (opcode 0x9) do NOT prevent the drop — the proxy handles ping/pong at its own layer without counting them as activity on the browser→proxy leg.
3. Browser-side JSON data frames (Vite's built-in `{ type:"ping" }`) do NOT prevent the drop — the proxy doesn't count application-layer WebSocket messages either.
4. **What DOES work:** The proxy tracks idle at the session level per (client, backend-host). A plain HTTP `fetch` from the browser to any path on the same Vite dev server origin (same `*.replit.dev` host) resets the idle timer for the entire session, including the HMR WebSocket.
5. Vite 7 source-confirmed: the client-side disconnect handler (`vite:ws:disconnect`) ALWAYS calls `location.reload()` after `waitForSuccessfulPing()` succeeds — there is no config to suppress this reload.

**How to apply:** Two-pronged Vite plugin in `vite.config.ts`, `apply: "serve"`:
1. `configureServer`: register a `server.middlewares.use("/__vite_keepalive", ...)` endpoint that returns 204.
2. `transformIndexHtml`: inject a `<script>` into `head-prepend` that calls `setInterval(() => fetch("/__vite_keepalive", {method:"HEAD",cache:"no-store"}).catch(()=>{}), 10000)`.

```ts
// configureServer
server.middlewares.use("/__vite_keepalive", (_req, res) => {
  res.writeHead(204, { "Cache-Control": "no-store" });
  res.end();
});

// transformIndexHtml
return [{
  tag: "script",
  attrs: { type: "text/javascript" },
  injectTo: "head-prepend",
  children: `(function(){if(typeof fetch!=='function')return;setInterval(function(){fetch('/__vite_keepalive',{method:'HEAD',cache:'no-store'}).catch(function(){})},10000);})();`,
}];
```

Also keep the server-side native WS ping as belt-and-suspenders (it's harmless even if the proxy handles it internally):
```ts
(server.ws.on as any)("connection", (socket: any) => {
  if (!socket || typeof socket.ping !== "function") return;
  const id = setInterval(() => { if (socket.readyState === 1) socket.ping(); }, 15_000);
  socket.on("close", () => clearInterval(id));
});
```

**What does NOT work:**
- `server.hmr.timeout: 15000` — only changes Vite's browser JSON ping interval; proxy ignores those frames
- `server.ws.on("vite:client:connect")` — routes to custom-event system, not raw wss; unreliable
- `server.ws.on("connection")` alone — server-side native pings don't reach the browser→proxy idle timer

**Verification:** After restart, check browser console for `[vite] connecting...` entries. With the fix active, zero reconnects should appear after the initial page load, even after 60+ seconds of idle. Also look at the Vite workflow log for `/__vite_keepalive` HEAD requests every ~10 s.
