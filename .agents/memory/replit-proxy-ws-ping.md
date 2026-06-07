---
name: Replit proxy HMR WS keepalive
description: The Replit mTLS proxy drops WebSocket connections after ~30 s idle on the browser→proxy leg. Fix requires browser→server WebSocket text frames via import.meta.hot.send, NOT HTTP fetches.
---

## The rule
Keep the Replit mTLS proxy from dropping the HMR WebSocket by making the **browser send WebSocket text frames back to the server** every ≤25 s. Use a Vite plugin that broadcasts a server→client custom event; the browser responds with `import.meta.hot.send()`.

**Why — full causal chain (empirically confirmed):**
1. Replit proxy drops WS connections at ~30 s idle, measured per-connection on the browser→proxy leg.
2. **Server-side native ping frames (opcode 0x9):** proxy handles these at its own layer; they do NOT reach/reset the browser→proxy idle counter.
3. **Vite's built-in browser JSON ping (`{ type:"ping" }`):** proxy ignores application-layer WS text frames from the browser too (unknown why — possibly because Vite's ping at 30 s fires exactly when the proxy drops it anyway).
4. **HTTP fetch keepalives (`fetch('/__vite_keepalive')`):** only the FIRST fetch opens a new TCP connection, which the proxy counts as activity. Subsequent fetches reuse the pooled TCP connection — the proxy does NOT count connection reuse as activity. Result: connection extended by exactly one 30 s period, then drops again.
5. **What DOES work:** WebSocket TEXT FRAMES sent FROM the browser (on the existing WS connection) reset the browser→proxy leg idle timer reliably. `import.meta.hot.send()` calls `ws.send()` on the HMR socket → genuine browser→proxy WS frame → timer resets.
6. Vite 7 source-confirmed: `vite:ws:disconnect` handler always calls `location.reload()` after reconnect — no config suppresses it.

**How to apply:**

**vite.config.ts** — Vite plugin (`apply: "serve"`):
```ts
// configureServer — broadcast ping to all connected clients every 10 s
const broadcastId = setInterval(() => {
  server.ws.send({ type: "custom", event: "vite:keepalive" });
}, 10_000);
server.httpServer?.once("close", () => clearInterval(broadcastId));

// Belt-and-suspenders: native WS ping from server side
(server.ws.on as any)("connection", (socket: any) => {
  if (!socket || typeof socket.ping !== "function") return;
  const id = setInterval(() => { if (socket.readyState === 1) socket.ping(); }, 15_000);
  socket.on("close", () => clearInterval(id));
});

// Belt-and-suspenders: HTTP endpoint (resets proxy on first new TCP conn)
server.middlewares.use("/__vite_keepalive", (_req, res) => {
  res.writeHead(204, { "Cache-Control": "no-store" });
  res.end();
});
```

**src/main.tsx** — handler in a REAL Vite-transformed module (critical):
```ts
// MUST be in a real .ts/.tsx file, NOT an inline HTML <script type="module">
// Inline HTML scripts are NOT transformed by Vite — import.meta.hot is
// undefined in them. Only source files processed by Vite's transform
// pipeline get import.meta.hot injected.
if (import.meta.env.DEV && import.meta.hot) {
  import.meta.hot.on("vite:keepalive", () => {
    import.meta.hot!.send("vite:keepalive-ack", {});
  });
}
```

**What does NOT work:**
- `server.hmr.timeout: N` — only changes Vite's browser JSON ping interval; proxy ignores those
- Server-side native pings alone — proxy handles them internally, browser→proxy leg stays idle
- HTTP fetch keepalive — only the FIRST fetch (new TCP conn) resets; reused connections ignored
- `transformIndexHtml` inline `<script type="module">` — Vite does NOT transform inline HTML scripts, so `import.meta.hot` is `undefined` in them

**Verification:** After restart, check browser console. With the fix active: single `[vite] connected.` at startup, zero proxy-idle reconnects for 115+ seconds. Any reconnects visible will be caused by server restarts (code edits), not idle drops.
