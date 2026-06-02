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
 */
export const CatalogSearchQuerySchema = z.object({
  q: z
    .string({ invalid_type_error: "q must be a string" })
    .min(1, "q must not be empty")
    .max(500, "q must not exceed 500 characters")
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
