import * as zod from "zod";

const SubsystemStatus = zod.object({
  status: zod.enum(["ok", "degraded"]),
  latencyMs: zod.number().optional(),
  error: zod.string().optional(),
});

const DbPoolStats = zod.object({
  total: zod.number().int(),
  idle: zod.number().int(),
  waiting: zod.number().int(),
});

const DbSubsystemStatus = SubsystemStatus.extend({
  pool: DbPoolStats.optional(),
});

export const DeepHealthCheckResponse = zod.object({
  status: zod.enum(["ok", "degraded"]),
  subsystems: zod.object({
    db: DbSubsystemStatus,
    poe: SubsystemStatus,
    aoos: SubsystemStatus,
  }),
});

export type DeepHealthCheckResponse = zod.infer<typeof DeepHealthCheckResponse>;

// ---------------------------------------------------------------------------
// Routes (navigation route planning) — shared Zod schemas
// ---------------------------------------------------------------------------

export const RouteWaypointSchema = zod.object({
  lon: zod.number(),
  lat: zod.number(),
  depth: zod.number(),
});

export const GetRoutesQuerySchema = zod.object({
  datasetId: zod.string().min(1),
});

export const PostRouteBodySchema = zod.object({
  datasetId: zod.string().min(1),
  name: zod.string().min(1).max(120),
  waypoints: zod.array(RouteWaypointSchema).min(2).max(20),
  totalDistanceM: zod.number().min(0),
});

export const RouteIdParamSchema = zod.object({
  id: zod.string().uuid(),
});

export const PatchRouteBodySchema = zod.object({
  name: zod.string().min(1).max(120),
});

// ---------------------------------------------------------------------------
// NCEI Geoportal search — shared query-param schema
// ---------------------------------------------------------------------------

export const nceiDefaultMax = 20;
export const nceiMaxResultsCap = 100;

// ---------------------------------------------------------------------------
// Federated multi-source search — shared query-param schema
// ---------------------------------------------------------------------------

export const FederatedSearchQuerySchema = zod.object({
  q: zod.string().max(500).optional().default(""),
  bbox: zod
    .string()
    .max(200)
    .optional()
    .default("")
    .refine(
      (v) => {
        if (!v) return true;
        const parts = v.split(",");
        if (parts.length !== 4) return false;
        return parts.every((p) => isFinite(parseFloat(p)));
      },
      { message: "bbox must be 'minLon,minLat,maxLon,maxLat' with four finite numbers" },
    ),
  sources: zod
    .string()
    .max(500)
    .optional()
    .default("")
    .refine((v) => /^[a-z0-9,_-]*$/i.test(v), {
      message: "sources must be a comma-separated list of connector ids",
    }),
});

export const NceiSearchQuerySchema = zod.object({
  q: zod.string().max(500).optional().default(""),
  bbox: zod
    .string()
    .max(200)
    .optional()
    .default("")
    .refine(
      (v) => {
        if (!v) return true;
        const parts = v.split(",");
        if (parts.length !== 4) return false;
        return parts.every((p) => isFinite(parseFloat(p)));
      },
      { message: "bbox must be 'minLon,minLat,maxLon,maxLat' with four finite numbers" },
    ),
  broad: zod
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  from: zod
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : 1))
    .pipe(zod.number().int().min(1, "from must be >= 1")),
  max: zod
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : nceiDefaultMax))
    .pipe(
      zod
        .number()
        .int()
        .min(1, "max must be >= 1")
        .max(nceiMaxResultsCap, `max must be <= ${nceiMaxResultsCap}`),
    ),
});
