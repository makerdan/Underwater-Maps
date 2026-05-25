import app from "./app";
import { logger } from "./lib/logger";
import { buildTerrainGrid } from "./lib/terrain.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Pre-warm Thorne Bay terrain cache in background so the first user
  // request is fast. Non-blocking — a failure here does not affect startup.
  void buildTerrainGrid("thorne-bay", 64).then(() => {
    logger.info({ datasetId: "thorne-bay", resolution: 64 }, "Terrain cache warmed");
  }).catch((warmErr: unknown) => {
    logger.warn({ err: warmErr }, "Terrain pre-warm failed (non-critical)");
  });
});
