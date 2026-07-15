---
name: Health probe must use /api/healthz
description: Why frontend connectivity probes must target /api/* paths, and how the dev API restart flow works
---
Frontend health probes must target `/api/healthz`, never a root-relative path like `/health`.

**Why:** Only `/api/*` paths are routed to the API server by the Replit proxy in dev and the deployment router in prod. A root path is answered by the frontend's SPA fallback with a misleading 200, so the poll thinks the server is healthy while it is down.

**How to apply:** Any new reachability check, banner, or reconnect logic in the web app should reuse the health-poll state in queryClient.ts (useIsConnecting/markServerUnreachable) rather than adding a second poller. The dev-only "Restart API Server" flow is served by the Vite dev server (not the API server, which is down when needed) and works by killing whatever listens on port 8080 via lsof, then spawning the api-server dev command detached — note this decouples the process from the Replit workflow supervisor until the workflow is next restarted.
