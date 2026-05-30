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
// JSON body limit. Catalog dataset materialization can synthesize and round-trip
// full-resolution terrain grids in jsonb form; classify also accepts a 1024×1024
// depthsFull payload (~5 MB). 50 MB matches the multer file-upload cap and
// leaves headroom for high-resolution pipeline grids while still capping
// pathological payloads.
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

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
