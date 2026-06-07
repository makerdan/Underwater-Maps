---
name: Replit proxy native WS ping
description: The Replit mTLS proxy drops WebSocket connections after ~30 s of idle time; JSON data frames do NOT reset its timer — only native opcode-0x9 ping frames do.
---

## The rule
Any long-lived WebSocket connection through the Replit mTLS proxy must send a **native WebSocket ping frame (opcode 0x9)** at least every 25–28 seconds, or the proxy will silently close the socket.

**Why:** The proxy tracks idle time at the WebSocket framing layer, looking specifically for native ping/pong frames, not application-layer data. Vite's built-in keepalive sends a JSON `{ type: "ping" }` text frame from the browser every `server.hmr.timeout` ms — the proxy ignores this for idle tracking. When the proxy closes the socket, Vite's reconnect handler calls `location.reload()`, wiping all in-memory state.

**How to apply:** For the Vite HMR socket, the fix is `hmrNativePingPlugin()` in `artifacts/bathyscan/vite.config.ts`. It hooks `vite:client:connect` / `vite:client:disconnect` on `server.ws` to track each raw `ws` WebSocket (accessed as `.socket` on the HotChannelClient wrapper) and calls `ws.ping()` every 15 seconds. This sends an opcode-0x9 frame from the server side, which the proxy does count as activity.

For any other persistent WebSocket (e.g., a custom SSE or WS endpoint in the API server), apply the same pattern: get the raw `ws` instance and call `.ping()` on a 15-second interval.

**Verification:** After restart, check browser console for `[vite] connecting...` entries. With the fix, no reconnects should appear after the first load beyond 30 seconds of idle.
