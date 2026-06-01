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
