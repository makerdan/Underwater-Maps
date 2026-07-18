import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";
import { correlationIdMiddleware, globalTimeoutMiddleware } from "./middlewares/correlationId";
import router from "./routes";
import { logger } from "./lib/logger";
import { validateStartupEnv } from "./lib/env";

// Validate format-sensitive env vars once at startup. Malformed values are
// logged loudly here (and safe fallbacks apply at each point of use).
// Throws on critical misconfigurations (e.g. BUCKET_MONITOR_ADMIN=1 in
// production) so the process exits before serving any requests.
validateStartupEnv();

const app: Express = express();

// Trust the first proxy hop so req.ip reflects the real client IP rather than
// the proxy's address. Required for IP-based rate limiting to work correctly
// when the server runs behind Replit's proxy layer.
app.set("trust proxy", 1);

// ---------------------------------------------------------------------------
// /health — lightweight liveness probe (no auth required)
// ---------------------------------------------------------------------------
// Registered before all middleware so it returns 200 immediately even during
// startup, reconnection, or Clerk key mis-configuration. The frontend
// warm-up banner polls this path to know when the server is reachable.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// 1. Stamp X-Request-Id first so every downstream middleware and log line
//    carries the same correlation token.
app.use(correlationIdMiddleware);

// 2. Global 60 s ceiling — catches any route that forgets its own timeout.
app.use(globalTimeoutMiddleware);

app.use(
  pinoHttp({
    logger,
    // Re-use the correlation ID already stamped by correlationIdMiddleware so
    // req.id in every log line matches the X-Request-Id response header.
    genReqId: (req) => (req as express.Request).id,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// ─── CORS ─────────────────────────────────────────────────────────────────────
// `origin: true` (reflect any incoming origin) combined with
// `credentials: true` would allow any website to make credentialed cross-origin
// mutations on behalf of a logged-in user.  Instead we validate each origin
// against an explicit allowlist built from environment variables.
//
// Allowlist sources (comma-separated `ALLOWED_ORIGINS` + REPLIT_DEV_DOMAIN):
//   - ALLOWED_ORIGINS: e.g. "https://myapp.example.com,https://www.myapp.com"
//   - REPLIT_DEV_DOMAIN: auto-set in Replit dev environments
//
// In non-production environments where no allowlist is configured, the
// middleware falls back to reflecting the request origin (dev convenience).
// In production (REPLIT_DEPLOYMENT set or NODE_ENV=production) a missing
// allowlist means no cross-origin credentialed request is granted.
app.use(
  cors({
    credentials: true,
    origin(requestOrigin, callback) {
      // No origin header → same-origin request, curl, Postman — always allowed.
      if (!requestOrigin) {
        callback(null, true);
        return;
      }

      const allowList = (process.env["ALLOWED_ORIGINS"] ?? "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
      if (process.env["REPLIT_DEV_DOMAIN"]) {
        allowList.push(`https://${process.env["REPLIT_DEV_DOMAIN"]}`);
      }

      const isProduction =
        process.env["NODE_ENV"] === "production" ||
        Boolean(process.env["REPLIT_DEPLOYMENT"]);

      // Dev with no allowlist configured: fall back to permissive so local
      // developer machines and Playwright E2E tests are not broken.
      if (!isProduction && allowList.length === 0) {
        callback(null, requestOrigin);
        return;
      }

      if (allowList.includes(requestOrigin)) {
        callback(null, requestOrigin);
      } else {
        // Return false: cors package omits Access-Control-Allow-Origin so the
        // browser's CORS policy blocks the response.
        callback(null, false);
      }
    },
  }),
);

// ─── Per-route JSON body limits ───────────────────────────────────────────────
// A single middleware selects the correct limit before any router or Zod
// validation runs.  router.use(express.json()) inside a sub-router does NOT
// work for this purpose because sub-router middleware runs for EVERY request
// passing through that router — even ones headed to a different route.
// Using path-prefix matching here (on the app, before any router) guarantees
// the body is rejected at 413 before any downstream processing starts.
//
// Limits are ordered longest-prefix-first so the most specific rule wins.
const BODY_LIMIT_RULES: Array<[string, string]> = [
  // Tight limits — reject large payloads before auth / Zod run.
  ["/api/query", "16kb"],       // free-text query + small terrain context
  ["/api/settings", "64kb"],    // flat key-value settings object
  ["/api/markers", "256kb"],    // single marker: a handful of scalar fields
  ["/api/catches", "64kb"],     // catch entry: symbol + notes + photo paths
  ["/api/catch-photos", "16kb"],// upload-url request: empty body
  ["/api/routes", "256kb"],     // route name + ≤20 waypoints
  // Medium limits — enough for GPS tracks or classify tile grids.
  ["/api/trails", "5mb"],       // up to 50 000 GPS points (~100 B/point)
  ["/api/poe", "10mb"],         // /classify: 1024×1024 depthsFull (~5 MB)
  // Large limits — catalog saves, terrain grid materialisation.
  ["/api/datasets", "50mb"],    // matches multer's multipart cap
];

app.use((req, res, next) => {
  let limit = "1mb"; // safe backstop for any uncategorised route
  let matchLen = 0;
  for (const [prefix, lim] of BODY_LIMIT_RULES) {
    if (req.path.startsWith(prefix) && prefix.length > matchLen) {
      limit = lim;
      matchLen = prefix.length;
    }
  }
  express.json({ limit })(req, res, next);
});

app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ─── Clerk authentication middleware ──────────────────────────────────────────
// Use a static publishable key resolved once at startup rather than a
// per-request factory.  The per-request factory derived the key from
// x-forwarded-host, which can differ from the hostname the frontend uses in
// Replit's path-based proxy, causing a key mismatch that prevents the session
// token from being verified.
app.use(
  clerkMiddleware({
    publishableKey:
      publishableKeyFromHost(
        process.env.REPLIT_DEV_DOMAIN ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ) ?? process.env.CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  }),
);

app.use("/api", router);

// ─── Global error handler ─────────────────────────────────────────────────────
// Maps body-parser errors to structured JSON responses.  Without this,
// express.json() errors (e.g. entity.too.large) propagate to Express's default
// finalhandler, which in some setups never responds, hanging the request.
app.use(
  (
    err: Error & { type?: string; status?: number },
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err.type === "entity.too.large") {
      res.status(413).json({ error: "Request body too large" });
      return;
    }
    if (err.type === "entity.parse.failed") {
      res.status(400).json({ error: "Malformed JSON body" });
      return;
    }
    const status =
      typeof err.status === "number" && err.status >= 400 && err.status < 600
        ? err.status
        : 500;
    if (status >= 500) {
      logger.error(
        { err, reqId: (_req as express.Request & { id?: string }).id },
        "Unhandled error forwarded to global error handler",
      );
    }
    res.status(status).json({ error: "Internal server error" });
  },
);

export default app;
