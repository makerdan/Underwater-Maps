/**
 * Shared Zod schemas for API route validation.
 *
 * Import these in route handlers to replace manual parseFloat / isNaN guards
 * with a single safeParse check that returns consistent 400 responses.
 */
import { z } from "zod";

/**
 * Validates lat/lon query parameters.
 * Coerces string values (as supplied by req.query) to numbers,
 * then checks finite-ness and geographic range.
 */
export const LatLonQuerySchema = z.object({
  lat: z.coerce
    .number({ invalid_type_error: "lat must be a valid number" })
    .finite("lat must be a finite number")
    .gte(-90, "lat must be between -90 and 90")
    .lte(90, "lat must be between -90 and 90"),
  lon: z.coerce
    .number({ invalid_type_error: "lon must be a valid number" })
    .finite("lon must be a finite number")
    .gte(-180, "lon must be between -180 and 180")
    .lte(180, "lon must be between -180 and 180"),
});

export type LatLonQuery = z.infer<typeof LatLonQuerySchema>;

/**
 * Validates query parameters for GET /datasets/catalog/search.
 * `q` is optional but when provided must be a non-empty string capped at 500
 * characters. Multi-value injection (?q[]=a&q[]=b) is rejected because Zod
 * z.string() rejects non-string values.
 * `dataType` and `waterType` are validated as enums.
 * Bbox coordinates are coerced from strings and validated as finite numbers
 * within geographic range. Array injection is rejected because z.coerce.number()
 * applied to an array produces NaN, which fails .finite().
 */
export const CatalogSearchQuerySchema = z
  .object({
    q: z
      .string({ invalid_type_error: "q must be a string" })
      .min(1, "q must not be empty")
      .max(500, "q must not exceed 500 characters")
      .optional(),
    dataType: z
      .enum(["bathymetry", "substrate", "habitat", "lidar", "chart"], {
        invalid_type_error: "dataType must be a string",
        message: "dataType must be one of: bathymetry, substrate, habitat, lidar, chart",
      })
      .optional(),
    waterType: z
      .enum(["saltwater", "freshwater"], {
        invalid_type_error: "waterType must be a string",
        message: "waterType must be 'saltwater' or 'freshwater'",
      })
      .optional(),
    minLon: z.coerce
      .number({ invalid_type_error: "minLon must be a valid number" })
      .finite("minLon must be a finite number")
      .gte(-180, "minLon must be between -180 and 180")
      .lte(180, "minLon must be between -180 and 180")
      .optional(),
    minLat: z.coerce
      .number({ invalid_type_error: "minLat must be a valid number" })
      .finite("minLat must be a finite number")
      .gte(-90, "minLat must be between -90 and 90")
      .lte(90, "minLat must be between -90 and 90")
      .optional(),
    maxLon: z.coerce
      .number({ invalid_type_error: "maxLon must be a valid number" })
      .finite("maxLon must be a finite number")
      .gte(-180, "maxLon must be between -180 and 180")
      .lte(180, "maxLon must be between -180 and 180")
      .optional(),
    maxLat: z.coerce
      .number({ invalid_type_error: "maxLat must be a valid number" })
      .finite("maxLat must be a finite number")
      .gte(-90, "maxLat must be between -90 and 90")
      .lte(90, "maxLat must be between -90 and 90")
      .optional(),
  })
  .refine((d) => d.minLon === undefined || d.maxLon === undefined || d.minLon <= d.maxLon, {
    message: "minLon must be less than or equal to maxLon",
    path: ["minLon"],
  })
  .refine((d) => d.minLat === undefined || d.maxLat === undefined || d.minLat <= d.maxLat, {
    message: "minLat must be less than or equal to maxLat",
    path: ["minLat"],
  });

export type CatalogSearchQuery = z.infer<typeof CatalogSearchQuerySchema>;

/**
 * Validates query parameters for GET /datasets.
 * `waterType` is optional but when provided must be one of the known enum
 * values. Multi-value injection (?waterType[]=saltwater&waterType[]=freshwater)
 * and unknown values (e.g. "brackish") are both rejected with 400.
 */
export const DatasetsQuerySchema = z.object({
  waterType: z
    .enum(["saltwater", "freshwater"], {
      invalid_type_error: "waterType must be a string",
      message: "waterType must be 'saltwater' or 'freshwater'",
    })
    .optional(),
});

export type DatasetsQuery = z.infer<typeof DatasetsQuerySchema>;

/**
 * Validates the multipart body fields for POST /datasets/upload/chunk.
 *
 * All three fields arrive as plain strings from the multipart body.
 * Using z.string() (not z.coerce) for each field ensures that array-injected
 * values (e.g. duplicate uploadId fields sent by a malicious client, which
 * multer collects into a JS array) are rejected with a type error before
 * any coercion or regex checks run.
 */
export const ChunkUploadBodySchema = z.object({
  uploadId: z
    .string({ invalid_type_error: "uploadId must be a string" })
    .regex(
      /^[a-zA-Z0-9_-]{8,64}$/,
      "uploadId must be 8–64 alphanumeric characters, hyphens, or underscores",
    ),
  chunkIndex: z
    .string({ invalid_type_error: "chunkIndex must be a string" })
    .regex(
      /^(0|[1-9]\d*)$/,
      "chunkIndex must be a non-negative integer with no leading zeros",
    )
    .transform((val, ctx) => {
      const n = Number(val);
      if (n > 99_999) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "chunkIndex must be between 0 and 99999",
        });
        return z.NEVER;
      }
      return n;
    }),
  totalChunks: z
    .string({ invalid_type_error: "totalChunks must be a string" })
    .regex(
      /^[1-9]\d*$/,
      "totalChunks must be a positive integer with no leading zeros",
    )
    .transform((val, ctx) => {
      const n = Number(val);
      if (n > 4096) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "totalChunks must be between 1 and 4096",
        });
        return z.NEVER;
      }
      return n;
    }),
});

export type ChunkUploadBody = z.infer<typeof ChunkUploadBodySchema>;

/**
 * Validates query parameters for GET /datasets/:id/zones.
 * - h: lowercase hex grid fingerprint (8-char FNV-1a or 64-char SHA-256)
 * - w: waterType enum
 * z.string() on both fields rejects array injection (?h[]=...&h[]=...).
 */
export const ZonesQuerySchema = z.object({
  h: z
    .string({ invalid_type_error: "h must be a string" })
    .regex(
      /^([a-f0-9]{8}|[a-f0-9]{64})$/,
      "h must be a lowercase hex string (8 or 64 chars)",
    ),
  w: z.enum(["saltwater", "freshwater"], {
    invalid_type_error: "w must be a string",
    message: "w must be 'saltwater' or 'freshwater'",
  }),
});

export type ZonesQuery = z.infer<typeof ZonesQuerySchema>;

/**
 * Parses a comma-separated bbox string "minLon,minLat,maxLon,maxLat" into a
 * tuple of four finite numbers.  z.string() up-front rejects array injection
 * (?bbox[]=...); the transform rejects non-finite values and wrong element
 * counts.
 */
const bboxCoordsSchema = z
  .string({ invalid_type_error: "bbox must be a string, not an array" })
  .transform((s, ctx) => {
    const parts = s.split(",").map((p) => parseFloat(p.trim()));
    if (parts.length !== 4 || parts.some((v) => !isFinite(v))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'bbox must be "minLon,minLat,maxLon,maxLat" (four finite numbers)',
      });
      return z.NEVER;
    }
    return parts as [number, number, number, number];
  });

/**
 * Validates query parameters for GET /terrain/land (Copernicus DEM).
 * - bbox: comma-separated "minLon,minLat,maxLon,maxLat"
 * - size: optional integer; clamped to [32, 256] by the route handler
 * z.string() on size rejects array injection (?size[]=64&size[]=128).
 */
export const TerrainLandQuerySchema = z.object({
  bbox: bboxCoordsSchema,
  size: z
    .string({ invalid_type_error: "size must be a string" })
    .optional()
    .transform((s) => (s === undefined ? 128 : parseInt(s, 10))),
});

export type TerrainLandQuery = z.infer<typeof TerrainLandQuerySchema>;

/**
 * Validates query parameters for GET /terrain/satellite-tile.
 * - bbox: comma-separated "minLon,minLat,maxLon,maxLat"
 * - size: optional integer; clamped to [64, 1024] by the route handler
 * z.string() on size rejects array injection.
 */
export const TerrainSatelliteQuerySchema = z.object({
  bbox: bboxCoordsSchema,
  size: z
    .string({ invalid_type_error: "size must be a string" })
    .optional()
    .transform((s) => (s === undefined ? 512 : parseInt(s, 10))),
});

export type TerrainSatelliteQuery = z.infer<typeof TerrainSatelliteQuerySchema>;

/**
 * A lat coord that rejects array injection: z.string() first, then coerce.
 * This prevents ?north[]=45&north[]=50 → parseFloat("45,50") → 45 bypass.
 */
const latCoordSchema = z
  .string({ invalid_type_error: "coordinate must be a string, not an array" })
  .pipe(
    z.coerce
      .number({ invalid_type_error: "coordinate must be a valid number" })
      .finite("coordinate must be a finite number")
      .gte(-90, "latitude must be between -90 and 90")
      .lte(90, "latitude must be between -90 and 90"),
  );

const lonCoordSchema = z
  .string({ invalid_type_error: "coordinate must be a string, not an array" })
  .pipe(
    z.coerce
      .number({ invalid_type_error: "coordinate must be a valid number" })
      .finite("coordinate must be a finite number")
      .gte(-180, "longitude must be between -180 and 180")
      .lte(180, "longitude must be between -180 and 180"),
  );

/**
 * Validates query parameters for GET /terrain/download/info.
 * Rejects array injection on all four cardinal params.
 */
export const TerrainDownloadInfoQuerySchema = z
  .object({
    north: latCoordSchema,
    south: latCoordSchema,
    east: lonCoordSchema,
    west: lonCoordSchema,
  })
  .refine((d) => d.north > d.south, {
    message: "north must be greater than south",
    path: ["north"],
  })
  .refine((d) => d.east > d.west, {
    message: "east must be greater than west",
    path: ["east"],
  })
  .refine((d) => d.north - d.south <= 10, {
    message: "Bounding box must be at most 10° latitude span",
    path: ["north"],
  })
  .refine((d) => d.east - d.west <= 10, {
    message: "Bounding box must be at most 10° longitude span",
    path: ["east"],
  });

export type TerrainDownloadInfoQuery = z.infer<typeof TerrainDownloadInfoQuerySchema>;

/**
 * Validates the JSON body for POST /datasets/upload/chunk/finalize.
 *
 * uploadId uses z.string() (not z.coerce) so that array-injected values
 * (e.g. {"uploadId": ["a","b"]}) are rejected before the regex runs.
 * totalChunks and resolution arrive as JSON numbers; z.number() is used
 * directly (no coerce needed) and validated with .int() + range checks.
 */
export const ChunkFinalizeBodySchema = z.object({
  uploadId: z
    .string({ invalid_type_error: "uploadId must be a string" })
    .regex(
      /^[a-zA-Z0-9_-]{8,64}$/,
      "uploadId must be 8–64 alphanumeric characters, hyphens, or underscores",
    ),
  fileName: z
    .string({ invalid_type_error: "fileName must be a string" })
    .min(1, "fileName must not be empty")
    .max(255, "fileName must not exceed 255 characters"),
  totalChunks: z
    .number({ invalid_type_error: "totalChunks must be a number" })
    .int("totalChunks must be an integer")
    .min(1, "totalChunks must be at least 1")
    .max(4096, "totalChunks must be at most 4096"),
  resolution: z
    .number({ invalid_type_error: "resolution must be a number" })
    .int("resolution must be an integer")
    .min(32, "resolution must be at least 32")
    .max(512, "resolution must be at most 512")
    .default(256),
});

export type ChunkFinalizeBody = z.infer<typeof ChunkFinalizeBodySchema>;

/**
 * Optional ISO-ish datetime string. An empty string (e.g. `?datetime=`) is
 * treated as absent. Array injection (?datetime[]=a&datetime[]=b) is rejected
 * because z.string() rejects arrays.
 */
const optionalDateStringSchema = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z
    .string({ invalid_type_error: "datetime must be a string" })
    .refine((s) => !isNaN(new Date(s).getTime()), "must be a parseable datetime")
    .optional(),
);

/**
 * Optional days count coerced from a query string. `min`/`max` bound the
 * accepted range; out-of-range or non-integer input fails validation (400)
 * instead of being silently clamped. Empty string is treated as absent.
 */
function daysSchema(min: number, max: number) {
  return z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string({ invalid_type_error: "days must be a string, not an array" })
      .regex(/^\d+$/, "days must be a non-negative integer")
      .transform(Number)
      .pipe(
        z
          .number()
          .int()
          .min(min, `days must be between ${min} and ${max}`)
          .max(max, `days must be between ${min} and ${max}`),
      )
      .optional(),
  );
}

/**
 * Validates query parameters for GET /tidal.
 * lat/lon use string-first schemas so array injection (?lat[]=1&lat[]=2) is
 * rejected with a type error rather than producing NaN behaviour.
 */
export const TidalQuerySchema = z.object({
  lat: latCoordSchema,
  lon: lonCoordSchema,
  datetime: optionalDateStringSchema,
});

export type TidalQuery = z.infer<typeof TidalQuerySchema>;

/** Validates query parameters for GET /tidal/schedule (days ∈ [1, 14]). */
export const TidalScheduleQuerySchema = z.object({
  lat: latCoordSchema,
  lon: lonCoordSchema,
  days: daysSchema(1, 14),
  start: optionalDateStringSchema,
});

export type TidalScheduleQuery = z.infer<typeof TidalScheduleQuerySchema>;

/** Validates query parameters for GET /tidal/pack (days ∈ [3, 14]). */
export const TidalPackQuerySchema = z.object({
  lat: latCoordSchema,
  lon: lonCoordSchema,
  days: daysSchema(3, 14),
});

export type TidalPackQuery = z.infer<typeof TidalPackQuerySchema>;

/**
 * Validates query parameters for GET /admin/rate-limit/usage.
 * Both params are optional; when provided they must be positive integers
 * within sane bounds. Array injection and non-numeric values return 400
 * instead of silently falling back to defaults.
 */
export const AdminRateLimitUsageQuerySchema = z.object({
  windowMs: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string({ invalid_type_error: "windowMs must be a string, not an array" })
      .regex(/^\d+$/, "windowMs must be a positive integer")
      .transform(Number)
      .pipe(
        z
          .number()
          .int()
          .min(1000, "windowMs must be between 1000 and 604800000")
          .max(604_800_000, "windowMs must be between 1000 and 604800000"),
      )
      .optional(),
  ),
  limit: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string({ invalid_type_error: "limit must be a string, not an array" })
      .regex(/^\d+$/, "limit must be a positive integer")
      .transform(Number)
      .pipe(
        z
          .number()
          .int()
          .min(1, "limit must be between 1 and 200")
          .max(200, "limit must be between 1 and 200"),
      )
      .optional(),
  ),
});

export type AdminRateLimitUsageQuery = z.infer<typeof AdminRateLimitUsageQuerySchema>;

/**
 * Validates the :id path param for POST /datasets/catalog/:id/save.
 * Catalog IDs are slug-like (e.g. "ncei-portal-…"); constrain the charset and
 * length so arbitrary junk never reaches catalog lookup or the database.
 */
export const CatalogIdParamSchema = z
  .string({ invalid_type_error: "catalog id must be a string" })
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/,
    "catalog id must be 1–200 characters of letters, digits, dots, colons, underscores, or hyphens",
  );

/** Validates the :id path param for save rows (DB UUID primary keys). */
export const SaveIdParamSchema = z
  .string({ invalid_type_error: "save id must be a string" })
  .uuid("save id must be a valid UUID");

/**
 * Validates the :uploadId path param for GET /datasets/upload/chunk/status/:uploadId.
 * Rejects array injection (z.string()) and enforces the same charset/length
 * constraints as ChunkUploadBodySchema and ChunkFinalizeBodySchema so a malformed
 * uploadId is caught at the route boundary with a logged 400 instead of silently
 * producing an empty session lookup.
 */
export const UploadIdParamSchema = z.object({
  uploadId: z
    .string({ invalid_type_error: "uploadId must be a string" })
    .regex(
      /^[a-zA-Z0-9_-]{8,64}$/,
      "uploadId must be 8–64 alphanumeric characters, hyphens, or underscores",
    ),
});

export type UploadIdParam = z.infer<typeof UploadIdParamSchema>;

/**
 * Validates the :jobId path param for GET /datasets/upload/jobs/:jobId.
 * The upload_jobs table uses gen_random_uuid() as its primary key so the
 * param must be a valid UUID; anything else is caught here before it reaches
 * the DB query.
 */
export const JobIdParamSchema = z.object({
  jobId: z
    .string({ invalid_type_error: "jobId must be a string" })
    .uuid("jobId must be a valid UUID"),
});

export type JobIdParam = z.infer<typeof JobIdParamSchema>;

/**
 * Validates query parameters for GET /datasets/upload/gcs-job-status.
 * z.string() up-front rejects array injection (?objectKey[]=a&objectKey[]=b);
 * min(1) ensures the key is non-empty; max(512) caps the value at a sane
 * length before it reaches the ownership-check and GCS look-up paths.
 */
export const GcsJobStatusQuerySchema = z.object({
  objectKey: z
    .string({ invalid_type_error: "objectKey must be a string" })
    .min(1, "objectKey is required")
    .max(512, "objectKey must not exceed 512 characters"),
});

export type GcsJobStatusQuery = z.infer<typeof GcsJobStatusQuerySchema>;
