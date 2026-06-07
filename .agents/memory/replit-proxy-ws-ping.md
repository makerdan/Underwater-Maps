---
name: Replit proxy native WS ping
description: The Replit mTLS proxy drops WebSocket connections after ~30 s of idle time; only native opcode-0x9 ping frames reset its timer. Use server.ws.on("connection") not "vite:client:connect".
---

## The rule
Any long-lived WebSocket connection through the Replit mTLS proxy must send a **native WebSocket ping frame (opcode 0x9)** at least every 25–28 seconds, or the proxy will silently close the socket.

**Why:** The proxy tracks idle time at the WebSocket framing layer, looking specifically for native ping/pong frames, not application-layer data. Vite's built-in keepalive sends a JSON `{ type: "ping" }` text frame from the browser every `server.hmr.timeout` ms — the proxy ignores this for idle tracking. When the proxy closes the socket, Vite's reconnect handler calls `location.reload()`, wiping all in-memory state.

**How to apply:** Use `server.ws.on("connection", socket => ...)` in a Vite plugin's `configureServer` hook. Vite 7 routes events in `wsServerEvents = ["connection","error","headers","listening","message"]` directly to the underlying `ws.WebSocketServer`, so the callback receives the raw `ws.WebSocket` instance which has `.ping()`. Events NOT in that list (e.g. `"vite:client:connect"`) go through the custom-event/normalizedHotChannel system instead — avoid using those for this purpose as they were found unreliable.

```ts
(server.ws.on as any)("connection", (socket: any) => {
  if (!socket || typeof socket.ping !== "function") return;
  const id = setInterval(() => {
    if (socket.readyState === 1) socket.ping();
  }, 15_000);
  socket.on("close", () => clearInterval(id));
});
```

This sends an opcode-0x9 frame from the server every 15 s, which the proxy counts as activity and resets its idle timer.

**What does NOT work:**
- `server.hmr.timeout: 15000` — only reduces the browser-side JSON ping interval; proxy ignores JSON data frames
- `server.ws.on("vite:client:connect")` — routes to custom-event system, not raw wss; found unreliable in practice

**Verification:** After restart, check browser console for `[vite] connecting...` entries. With the fix active, zero reconnects should appear after the initial page load, even after 60+ seconds of idle.
