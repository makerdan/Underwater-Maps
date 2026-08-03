import { pgTable, text, real, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { datasetFoldersTable } from "./dataset-folders.js";
import { z } from "zod";

/**
 * Shape of the terrain/overview JSON blobs stored in custom_datasets.
 * Mirrors the TerrainData schema in openapi.yaml — only the fields that are
 * always present (required) are non-optional here; supplementary provenance
 * and topography fields remain optional to allow forward compatibility.
 */
export interface StoredTerrainJson {
  datasetId: string;
  name: string;
  waterType: "saltwater" | "freshwater";
  resolution: number;
  width: number;
  height: number;
  depths: number[];
  minDepth: number;
  maxDepth: number;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  centerLon: number;
  centerLat: number;
  topography?: number[];
  hasTopography?: boolean;
  /**
   * Which upstream source produced this grid's bathymetry.
   *
   * "synthetic" is intentionally absent: the fbm procedural fallback was
   * removed and buildTerrainGrid now throws NoDataError instead.  Any
   * legacy DB row with dataSource = 'synthetic' pre-dates that change; on
   * the read path, treat such a value as null (unknown source) rather than
   * forwarding it to the client where validateResponse would reject it.
   */
  dataSource?: "ncei" | "gebco" | "twdb" | "usace" | "usgs-3dep" | "usgs-sciencebase" | "noaa-great-lakes" | "nysdec" | "mn-dnr";
  bathymetrySource?: "ncei" | "gebco" | "twdb" | "usace" | "usgs-3dep" | "usgs-sciencebase" | "noaa-great-lakes" | "nysdec" | "mn-dnr";
  topographySource?: "ncei" | "gebco" | "twdb" | "usace" | "usgs-3dep" | "usgs-sciencebase" | "noaa-great-lakes" | "nysdec" | "mn-dnr";
  bathymetrySourceLabel?: string;
  topographySourceLabel?: string;
  bathymetryCreditUrl?: string;
  topographyCreditUrl?: string;
  habitatPolygons?: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      properties: Record<string, unknown>;
      geometry: Record<string, unknown>;
    }>;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Zod schema mirroring the `StoredTerrainJson` interface.
 * Use this to validate worker/gridPoints output before any DB write so that
 * shape drift surfaces as a clear `terrain_schema_mismatch` error rather than
 * silently storing corrupt data.
 */
const _terrainDataSourceEnum = z.enum([
  "ncei", "gebco", "twdb", "usace", "usgs-3dep",
  "usgs-sciencebase", "noaa-great-lakes", "nysdec", "mn-dnr",
]);

export const StoredTerrainJsonSchema = z.object({
  datasetId: z.string(),
  name: z.string(),
  waterType: z.enum(["saltwater", "freshwater"]),
  resolution: z.number(),
  width: z.number(),
  height: z.number(),
  depths: z.array(z.number()),
  minDepth: z.number(),
  maxDepth: z.number(),
  minLon: z.number(),
  maxLon: z.number(),
  minLat: z.number(),
  maxLat: z.number(),
  centerLon: z.number(),
  centerLat: z.number(),
  topography: z.array(z.number()).optional(),
  hasTopography: z.boolean().optional(),
  dataSource: _terrainDataSourceEnum.optional(),
  bathymetrySource: _terrainDataSourceEnum.optional(),
  topographySource: _terrainDataSourceEnum.optional(),
  bathymetrySourceLabel: z.string().optional(),
  topographySourceLabel: z.string().optional(),
  bathymetryCreditUrl: z.string().optional(),
  topographyCreditUrl: z.string().optional(),
  habitatPolygons: z
    .object({
      type: z.literal("FeatureCollection"),
      features: z.array(
        z.object({
          type: z.literal("Feature"),
          properties: z.record(z.unknown()),
          geometry: z.record(z.unknown()),
        }),
      ),
      metadata: z.record(z.unknown()).optional(),
    })
    .optional(),
});

/** A single HYD93 cartographic annotation point stored alongside a dataset. */
export interface StoredHyd93Feature {
  lon: number;
  lat: number;
  featureCode: number;
}

/**
 * A single NOAA historical bottom-sample point extracted from a
 * `Bottom_Samples/*_BSText.txt` file inside a NOAA tar.gz archive.
 */
export interface StoredNoaaSubstrateSample {
  lat: number;
  lon: number;
  /** Normalised substrate category (mud / rock / sand / gravel / kelp / <raw>) */
  substrateType: string;
  /** Unmodified COLOUR+NAT string from the source file */
  rawLabel: string;
}

/**
 * A single georeferencing control point: maps a pixel coordinate on the
 * scanned raster to a real-world WGS84 longitude/latitude.
 */
export interface GeorefControlPoint {
  /** Pixel X (column), 0 = left edge of image. */
  px: number;
  /** Pixel Y (row), 0 = top edge of image. */
  py: number;
  /** WGS84 longitude (decimal degrees, negative west). */
  lon: number;
  /** WGS84 latitude (decimal degrees, positive north). */
  lat: number;
}

/**
 * Nearest NOAA tide station binding resolved from the dataset's bbox
 * centroid at upload/processing time. Null when resolution failed (NOAA
 * unreachable) or the dataset predates the tides feature.
 */
export interface StoredTideStation {
  stationId: string;
  stationName: string;
  /** Station location (WGS84). */
  lat: number;
  lon: number;
  /** Great-circle distance from the dataset centroid, statute miles. */
  distanceMiles: number;
}

export const customDatasetsTable = pgTable("custom_datasets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  minDepth: real("min_depth").notNull(),
  maxDepth: real("max_depth").notNull(),
  terrainJson: jsonb("terrain_json").notNull().$type<StoredTerrainJson>(),
  overviewJson: jsonb("overview_json").notNull().$type<StoredTerrainJson>(),
  folderId: uuid("folder_id").references(() => datasetFoldersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /**
   * HYD93 cartographic annotation points extracted from .a93.gz files during
   * upload (feature codes 89=rocks, 103=kelp, 146=ledges, 530=rocky reefs,
   * 988=obstructions). Null when the dataset was not sourced from a HYD93 archive
   * or the archive contained no annotation rows.
   */
  hyd93FeaturesJson: jsonb("hyd93_features_json").$type<StoredHyd93Feature[]>(),
  /**
   * NOAA historical bottom-sample points extracted from
   * `Bottom_Samples/*_BSText.txt` files inside a NOAA tar.gz archive.
   * Each entry carries a geolocated substrate observation with a normalised
   * category label.  Null when the archive contained no BSText file.
   */
  noaaSubstrateSamplesJson: jsonb("noaa_substrate_samples_json").$type<StoredNoaaSubstrateSample[]>(),
  /**
   * True when an inner GeoTIFF from a Smooth_Sheets archive lacked georeferencing
   * tags and the user needs to manually pin it to geographic coordinates.
   * Cleared to false once control points have been submitted.
   */
  needsGeoreferencing: jsonb("needs_georeferencing").$type<boolean>(),
  /**
   * Base64-encoded gzip bytes of the raw inner .tif.gz raster, stored only
   * when needsGeoreferencing is true.  Used to serve a preview image in the
   * georeferencing wizard and cleared once the user has submitted control
   * points.  Capped at MAX_RASTER_STORE_BYTES during upload.
   */
  pendingRasterGzBase64: text("pending_raster_gz_base64"),
  /**
   * User-supplied control points mapping pixel coords → WGS84 lon/lat.
   * Set when the user submits the georeferencing wizard; null until then.
   */
  georefControlPointsJson: jsonb("georef_control_points_json").$type<GeorefControlPoint[]>(),
  /**
   * Nearest NOAA tide station resolved from the dataset bbox centroid when
   * the upload was processed. Used by the tide-prediction engine so the
   * client does not need to re-resolve the station on every load.
   */
  tideStationJson: jsonb("tide_station_json").$type<StoredTideStation>(),
}, (table) => [
  index("custom_datasets_user_id_idx").on(table.userId),
]);

export type CustomDataset = typeof customDatasetsTable.$inferSelect;
