import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { correlationIdMiddleware, globalTimeoutMiddleware } from "./middlewares/correlationId";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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

app.use(cors({ credentials: true, origin: true }));

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

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
