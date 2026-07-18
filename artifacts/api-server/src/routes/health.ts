import { Router, type IRouter } from "express";
import { HealthCheckResponse, DeepHealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

const POE_PING_TIMEOUT_MS = 2_000;
const DB_QUERY_TIMEOUT_MS = 2_000;
const AOOS_PING_TIMEOUT_MS = 5_000;

// Primary AOOS endpoint used by the intertidal-habitat bundle.
const AOOS_PROBE_URL =
  "https://gis.aoos.org/arcgis/rest/services/AKCoastalHabitats/IntertidHabitat/FeatureServer/0?f=json";

/**
 * Deep health check — probes each critical subsystem and returns per-subsystem
 * status. Returns HTTP 503 when any subsystem is degraded so monitors and
 * synthetic checks can distinguish a live (but impaired) server from a fully
 * healthy one. The shallow `/healthz` continues to return 200 quickly for
 * load-balancer liveness probes.
 */
router.get("/healthz/deep", asyncHandler(async (_req, res) => {
  const [dbResult, poeResult, aoosResult] = await Promise.allSettled([
    checkDb(),
    checkPoe(),
    checkAoos(),
  ]);

  const db = dbResult.status === "fulfilled" ? dbResult.value : { status: "degraded" as const, error: String(dbResult.reason) };
  const poe = poeResult.status === "fulfilled" ? poeResult.value : { status: "degraded" as const, error: String(poeResult.reason) };
  const aoos = aoosResult.status === "fulfilled" ? aoosResult.value : { status: "degraded" as const, error: String(aoosResult.reason) };

  const overallStatus = db.status === "ok" && poe.status === "ok" && aoos.status === "ok" ? "ok" : "degraded";

  if (overallStatus === "degraded") {
    logger.warn({ code: "healthz_deep_degraded", db, poe, aoos }, "Deep health check: degraded");
  }

  const body = DeepHealthCheckResponse.parse({ status: overallStatus, subsystems: { db, poe, aoos } });
  res.status(overallStatus === "ok" ? 200 : 503).json(body);
}));

interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
}

function getPoolStats(): PoolStats {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

async function checkDb(): Promise<{ status: "ok" | "degraded"; latencyMs?: number; error?: string; pool?: PoolStats }> {
  const start = Date.now();
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB health check timed out")), DB_QUERY_TIMEOUT_MS),
      ),
    ]);
    return { status: "ok", latencyMs: Date.now() - start, pool: getPoolStats() };
  } catch (err) {
    return { status: "degraded", latencyMs: Date.now() - start, error: (err as Error)?.message ?? "unknown", pool: getPoolStats() };
  }
}

async function checkPoe(): Promise<{ status: "ok" | "degraded"; latencyMs?: number; error?: string }> {
  const start = Date.now();
  const apiKey = process.env["POE_API_KEY"];
  if (!apiKey) {
    return { status: "degraded", error: "POE_API_KEY not configured" };
  }
  try {
    const response = await fetch("https://api.poe.com/v1/models", {
      method: "HEAD",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(POE_PING_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - start;
    if (response.status >= 500) {
      return { status: "degraded", latencyMs, error: `HTTP ${response.status}` };
    }
    return { status: "ok", latencyMs };
  } catch (err) {
    return { status: "degraded", latencyMs: Date.now() - start, error: (err as Error)?.message ?? "unknown" };
  }
}

/**
 * Probe the AOOS ArcGIS FeatureServer that backs the intertidal-habitat bundle.
 *
 * A "degraded" result here means gis.aoos.org is unreachable from this host,
 * which is expected in the Replit dev container (DNS is blocked) but should be
 * "ok" in the deployed production environment. When this returns "ok" in
 * production, re-run `pnpm --filter @workspace/scripts run build-aoos-intertidal-pow`
 * to replace the ENC-fallback bundle with authoritative AOOS habitat polygons.
 */
async function checkAoos(): Promise<{ status: "ok" | "degraded"; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    const response = await fetch(AOOS_PROBE_URL, {
      method: "HEAD",
      signal: AbortSignal.timeout(AOOS_PING_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - start;
    if (response.status >= 500) {
      return { status: "degraded", latencyMs, error: `HTTP ${response.status}` };
    }
    return { status: "ok", latencyMs };
  } catch (err) {
    return { status: "degraded", latencyMs: Date.now() - start, error: (err as Error)?.message ?? "unknown" };
  }
}

export default router;
