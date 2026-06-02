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
export const CatalogSearchQuerySchema = z.object({
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
