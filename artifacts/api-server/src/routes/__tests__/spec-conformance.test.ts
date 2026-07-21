/**
 * spec-conformance.test.ts — guard against OpenAPI ↔ implementation drift
 *
 * Strict response validation (validateResponse + generated Zod schemas)
 * turns silent spec drift into runtime 500s. This suite catches that drift
 * at test time instead: for EVERY structured-response route, realistic
 * success and error payloads (mirroring what the handlers actually build)
 * are fed through the generated schemas from `@workspace/api-zod`.
 *
 * Precedent: the gcs-job-status enum had drifted from the implementation
 * (spec was missing `failed` / `complete` / `unknown`), which strict
 * validation exposed as production 500s. Each fixture here pins one route's
 * real payload shape so the equivalent drift fails in CI.
 *
 * Coverage is enforced mechanically: a meta-test scans every route source
 * file for `validateResponse(<Schema>, …)` call sites and fails if a schema
 * is neither in the FIXTURES registry below nor in the documented
 * LOCAL_SCHEMA_ALLOWLIST. Adding a new structured route without adding a
 * fixture (or an allowlist entry with rationale) breaks this suite.
 *
 * If a fixture test fails after a route change, update
 * `lib/api-spec/openapi.yaml` to match reality (then re-run codegen), or fix
 * the handler — never delete the fixture.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { z } from "zod";
import * as apiZod from "@workspace/api-zod";

/** Assert a payload conforms to a generated spec schema, with a readable diff. */
function expectConforms(schema: z.ZodTypeAny, payload: unknown, label: string): void {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    expect.fail(
      `${label} drifted from the OpenAPI spec:\n` +
        parsed.error.issues
          .map((i) => `  - [${i.path.join(".") || "(root)"}] ${i.message}`)
          .join("\n"),
    );
  }
}

// ---------------------------------------------------------------------------
// Shared realistic sub-fixtures
// ---------------------------------------------------------------------------

const CATALOG_ENTRY = {
  id: "noaa-ncei-puget-sound",
  name: "Puget Sound Multibeam Mosaic",
  sourceAgency: "NOAA/NCEI",
  dataType: "bathymetry",
  resolutionMMin: 1,
  resolutionMMax: 8,
  coverageBbox: { minLon: -123.2, minLat: 47.0, maxLon: -122.1, maxLat: 48.5 },
  endpointUrl: "https://gis.ngdc.noaa.gov/arcgis/rest/services/bag_mosaic",
  accessNotes: null,
  description: "High-resolution multibeam survey mosaic",
  keywords: "bathymetry,multibeam,puget sound",
  lastUpdated: "2026-01-15",
  waterType: "saltwater",
  createdAt: "2026-07-19T10:00:00.000Z",
};

const SAVE_ROW = {
  id: "5e0a1b2c-3d4e-4f5a-8b7c-9d0e1f2a3b4c",
  catalogId: CATALOG_ENTRY.id,
  status: "ready",
  requestedAt: "2026-07-19T10:00:00.000Z",
  readyAt: "2026-07-19T10:02:00.000Z",
  cacheKey: "cache-abc",
  errorMessage: null,
  displayLabel: "My Puget Sound",
  folderId: null,
  datasetId: "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
  catalog: CATALOG_ENTRY,
};

const FAILED_SAVE_ROW = {
  ...SAVE_ROW,
  id: "5e0a1b2c-3d4e-4f5a-8b7c-9d0e1f2a3b4d",
  status: "failed",
  readyAt: null,
  cacheKey: null,
  datasetId: null,
  errorMessage: "Upstream WCS timed out",
};

const QUICK_DROP_CONDITIONS = {
  capturedAt: "2026-07-19T10:05:00.000Z",
  gpsAccuracyM: 4.2,
  speedMps: 1.1,
  headingDeg: 270,
  depthM: 12,
  depthSource: "terrain",
  tideHeightM: null,
  currentSpeedKt: null,
  currentDirDeg: null,
  tideSource: "unavailable",
  windSpeedKnots: 8,
  windDirDeg: 180,
  tempC: 14.5,
  weatherObservedAt: "2026-07-19T09:50:00.000Z",
  weatherSource: "pack",
};

const MARKER = {
  id: "8a2f2f9e-1111-4222-8333-444455556666",
  datasetId: "ds-1",
  lon: -122.41,
  lat: 47.61,
  depth: 35.2,
  type: "fish",
  label: "Halibut hole",
  notes: null,
  catchSeq: null,
  conditions: null,
  createdAt: "2026-07-19T10:00:00.000Z",
};

const QUICK_DROP_MARKER = {
  ...MARKER,
  id: "8a2f2f9e-1111-4222-8333-444455557777",
  datasetId: null,
  type: "custom",
  label: "Catch 3",
  catchSeq: 3,
  conditions: QUICK_DROP_CONDITIONS,
};

const CATCH_ENTRY = {
  id: "c1a2b3c4-d5e6-4f70-8123-456789abcdef",
  markerId: MARKER.id,
  symbol: "🐟",
  symbolName: "Salmon",
  notes: null,
  photos: ["/objects/catch-photos/user-1/photo1.jpg"],
  createdAt: "2026-07-19T10:00:00.000Z",
  updatedAt: "2026-07-19T10:00:00.000Z",
};

const ROUTE_ROW = {
  id: "3f1b1a4e-9c1d-4e5f-8a7b-2c3d4e5f6a7b",
  userId: "user-1",
  datasetId: "ds-1",
  name: "Morning troll",
  waypoints: [
    { lon: -122.41, lat: 47.61, depth: 20 },
    { lon: -122.42, lat: 47.62, depth: 25 },
  ],
  waypointCount: 2,
  totalDistanceM: 1345.6,
  createdAt: "2026-07-19T10:00:00.000Z",
};

const TRAIL_ROW = {
  id: "trail-1",
  userId: "user-1",
  datasetId: "ds-1",
  name: "Drift 1",
  colour: "#ff6600",
  startedAt: "2026-07-19T09:00:00.000Z",
  endedAt: "2026-07-19T09:45:00.000Z",
  pointCount: 812,
  createdAt: "2026-07-19T09:46:00.000Z",
};

const BUCKET_ITEM = {
  key: "uploads/user-1/lake-survey.laz",
  owner: "user-1",
  sizeBytes: 73400320,
  ageMs: 120000,
};

// ---------------------------------------------------------------------------
// Fixture registry — one entry per generated schema used with
// validateResponse(...) (or safeParse'd, for proxy routes) in src/routes.
// The coverage meta-test at the bottom enforces completeness.
// ---------------------------------------------------------------------------

const FIXTURES: Record<string, { schema: z.ZodTypeAny; payloads: unknown[] }> = {
  // ── Upload pipeline ────────────────────────────────────────────────────
  GetGcsJobStatusResponse: {
    schema: apiZod.GetGcsJobStatusResponse,
    payloads: [
      // Every status the handler + recoverGcsJobStatus can actually emit —
      // `failed` / `complete` / `unknown` are the historical drift precedent.
      ...["pending", "queued", "processing", "done", "error", "failed", "complete", "unknown"].map(
        (status) => ({ status }),
      ),
      { status: "unknown", error: "Job not found — please re-upload your file." },
      { status: "done", datasetId: "ds-abc-123" },
    ],
  },
  GetUploadJobStatusResponse: {
    schema: apiZod.GetUploadJobStatusResponse,
    payloads: [
      ...["queued", "processing", "done", "error"].map((status) => ({ status, progress: 42 })),
      { status: "error", progress: 80, error: "Parse failed: unsupported format" },
      { status: "done", progress: 100, datasetId: "ds-xyz" },
    ],
  },
  UploadDatasetChunkResponse: {
    schema: apiZod.UploadDatasetChunkResponse,
    payloads: [{ received: 7 }],
  },
  GetChunkUploadStatusResponse: {
    schema: apiZod.GetChunkUploadStatusResponse,
    payloads: [{ uploadId: "up-123", receivedChunks: [0, 1, 2, 5] }],
  },
  FinalizeChunkedUploadResponse: {
    schema: apiZod.FinalizeChunkedUploadResponse,
    payloads: [{ jobId: "job-abc" }],
  },
  RequestGcsUploadUrlResponse: {
    schema: apiZod.RequestGcsUploadUrlResponse,
    payloads: [
      {
        uploadUrl: "https://storage.googleapis.com/bucket/uploads/user-1/file.laz?X-Goog-Signature=abc",
        objectKey: "uploads/user-1/file.laz",
      },
    ],
  },

  // ── Datasets / terrain ─────────────────────────────────────────────────
  GetDatasetsIdPreviewResponse: {
    schema: apiZod.GetDatasetsIdPreviewResponse,
    payloads: [
      {
        datasetId: "ds-1",
        name: "Puget Sound",
        bbox: { minLon: -123.2, minLat: 47.0, maxLon: -122.1, maxLat: 48.5 },
        dataSource: "ncei",
      },
      {
        datasetId: "ds-2",
        name: "Nowhere Lake",
        bbox: { minLon: -100, minLat: 40, maxLon: -99.9, maxLat: 40.1 },
        dataSource: "synthetic",
        syntheticReason: "outside NCEI/GEBCO coverage",
      },
      {
        datasetId: "ds-3",
        name: "Timeout Lake",
        bbox: { minLon: -100, minLat: 40, maxLon: -99.9, maxLat: 40.1 },
        dataSource: "unknown",
        syntheticReason: "upstream bathymetry services unreachable",
      },
    ],
  },
  GetDatasetZonesResponse: {
    schema: apiZod.GetDatasetZonesResponse,
    payloads: [
      {
        zones: Array(1024).fill("sandy_shelf"),
        fromCache: true,
        source: "ai",
        substrateFp: "00000000",
        coarseWidth: 32,
        coarseHeight: 32,
        tilesTotal: 1,
        tilesAi: 1,
        tilesHeuristic: 0,
      },
      { zones: Array(1024).fill("deep_basin"), fromCache: false, source: "heuristic" },
    ],
  },
  GetTerrainLandResponse: {
    schema: apiZod.GetTerrainLandResponse,
    payloads: [
      {
        width: 64,
        height: 64,
        depths: Array(4096).fill(12.5),
        bbox: { minLon: -123.2, minLat: 47.0, maxLon: -122.1, maxLat: 48.5 },
      },
    ],
  },
  GetTerrainDownloadInfoResponse: {
    schema: apiZod.GetTerrainDownloadInfoResponse,
    payloads: [
      { sourceName: "NCEI Bag Mosaic", dataSource: "ncei", nominalResolutionM: 4, waterFraction: 0.82 },
      { sourceName: "Synthetic terrain", dataSource: "synthetic", nominalResolutionM: 0, waterFraction: 0 },
    ],
  },
  GetUserDatasetsIdHyd93FeaturesResponse: {
    schema: apiZod.GetUserDatasetsIdHyd93FeaturesResponse,
    payloads: [
      [],
      [
        { lon: -122.41, lat: 47.61, featureCode: 89 },
        { lon: -122.42, lat: 47.62, featureCode: 988 },
      ],
    ],
  },
  PostUserDatasetsIdGeorefResponse: {
    schema: apiZod.PostUserDatasetsIdGeorefResponse,
    payloads: [
      {
        id: "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
        name: "smooth_sheet_H12345",
        minDepth: 2,
        maxDepth: 88,
        folderId: null,
        createdAt: "2026-07-19T10:00:00.000Z",
      },
    ],
  },

  // ── Catalog / saves ────────────────────────────────────────────────────
  GetDatasetsCatalogResponse: {
    schema: apiZod.GetDatasetsCatalogResponse,
    payloads: [[], [CATALOG_ENTRY]],
  },
  GetDatasetsCatalogSearchResponse: {
    schema: apiZod.GetDatasetsCatalogSearchResponse,
    payloads: [[{ ...CATALOG_ENTRY, relevanceScore: 0.87 }]],
  },
  PostDatasetsBboxQueryResponse: {
    schema: apiZod.PostDatasetsBboxQueryResponse,
    payloads: [
      {
        bbox: { north: 48.5, south: 47.0, east: -122.1, west: -123.2 },
        datasets: [{ ...CATALOG_ENTRY, relevanceScore: 1 }],
      },
    ],
  },
  PostDatasetsPointRadiusQueryResponse: {
    schema: apiZod.PostDatasetsPointRadiusQueryResponse,
    payloads: [
      {
        center: { lat: 47.6, lon: -122.4 },
        radiusKm: 25,
        bbox: { north: 47.8, south: 47.4, east: -122.1, west: -122.7 },
        datasets: [{ ...CATALOG_ENTRY, relevanceScore: 0.5 }],
      },
    ],
  },
  GetDatasetsMySavesResponse: {
    schema: apiZod.GetDatasetsMySavesResponse,
    payloads: [[], [SAVE_ROW, FAILED_SAVE_ROW]],
  },
  GetDatasetsMySavesResponseItem: {
    schema: apiZod.GetDatasetsMySavesResponseItem,
    payloads: [SAVE_ROW, { ...SAVE_ROW, status: "queued", readyAt: null, datasetId: null }],
  },
  GetDatasetsMySavesIdStatusResponse: {
    schema: apiZod.GetDatasetsMySavesIdStatusResponse,
    payloads: [SAVE_ROW, FAILED_SAVE_ROW],
  },
  PostDatasetsMySavesIdRetryResponse: {
    schema: apiZod.PostDatasetsMySavesIdRetryResponse,
    payloads: [{ ...FAILED_SAVE_ROW, status: "processing", errorMessage: null }],
  },
  PatchDatasetsMySavesIdRenameResponse: {
    schema: apiZod.PatchDatasetsMySavesIdRenameResponse,
    payloads: [{ ...SAVE_ROW, displayLabel: "Renamed save" }],
  },
  PatchDatasetsMySavesIdMoveResponse: {
    schema: apiZod.PatchDatasetsMySavesIdMoveResponse,
    payloads: [{ ...SAVE_ROW, folderId: "9f8e7d6c-5b4a-4392-8171-605f4e3d2c1b" }],
  },

  // ── Markers / catches / routes / trails ────────────────────────────────
  GetMarkersResponse: {
    schema: apiZod.GetMarkersResponse,
    payloads: [[], [MARKER, QUICK_DROP_MARKER]],
  },
  GetMarkersResponseItem: {
    schema: apiZod.GetMarkersResponseItem,
    payloads: [MARKER, QUICK_DROP_MARKER],
  },
  PatchMarkersIdResponse: {
    schema: apiZod.PatchMarkersIdResponse,
    payloads: [{ ...MARKER, label: "Renamed spot" }],
  },
  DeleteMarkersMineResponse: {
    schema: apiZod.DeleteMarkersMineResponse,
    payloads: [{ deleted: 12 }, { deleted: 0 }],
  },
  GetCatchesResponse: {
    schema: apiZod.GetCatchesResponse,
    payloads: [[], [CATCH_ENTRY]],
  },
  GetMarkersMarkerIdCatchesResponse: {
    schema: apiZod.GetMarkersMarkerIdCatchesResponse,
    payloads: [[CATCH_ENTRY]],
  },
  GetMarkersMarkerIdCatchesResponseItem: {
    schema: apiZod.GetMarkersMarkerIdCatchesResponseItem,
    payloads: [CATCH_ENTRY],
  },
  PatchCatchesIdResponse: {
    schema: apiZod.PatchCatchesIdResponse,
    payloads: [{ ...CATCH_ENTRY, notes: "Released" }],
  },
  PostCatchPhotosUploadUrlResponse: {
    schema: apiZod.PostCatchPhotosUploadUrlResponse,
    payloads: [
      {
        uploadURL: "https://storage.googleapis.com/bucket/catch-photos/user-1/p.jpg?sig=abc",
        objectPath: "/objects/catch-photos/user-1/p.jpg",
      },
    ],
  },
  GetRoutesResponse: {
    schema: apiZod.GetRoutesResponse,
    payloads: [[], [ROUTE_ROW]],
  },
  GetRoutesResponseItem: {
    schema: apiZod.GetRoutesResponseItem,
    payloads: [ROUTE_ROW],
  },
  PatchRouteResponse: {
    schema: apiZod.PatchRouteResponse,
    payloads: [{ ...ROUTE_ROW, name: "Evening troll" }],
  },
  GetTrailsResponse: {
    schema: apiZod.GetTrailsResponse,
    payloads: [[], [TRAIL_ROW]],
  },
  GetTrailsResponseItem: {
    schema: apiZod.GetTrailsResponseItem,
    payloads: [TRAIL_ROW],
  },

  // ── Tides / tidal ──────────────────────────────────────────────────────
  GetTidesStationResponse: {
    schema: apiZod.GetTidesStationResponse,
    payloads: [
      { available: false },
      {
        available: true,
        station: { id: "9447130", name: "Seattle", lat: 47.602, lon: -122.339, distanceMiles: 3.4 },
      },
    ],
  },
  GetTidesStationIdResponse: {
    schema: apiZod.GetTidesStationIdResponse,
    payloads: [
      {
        stationId: "9447130",
        windowStart: "2026-07-20T00:00:00.000Z",
        windowEnd: "2026-08-20T00:00:00.000Z",
        datum: "MLLW",
        units: "feet",
        predictions: [
          { t: "2026-07-20T00:00:00.000Z", v: 5.1 },
          { t: "2026-07-20T00:06:00.000Z", v: 5.2 },
        ],
      },
    ],
  },
  GetTidesStationIdDatumsResponse: {
    schema: apiZod.GetTidesStationIdDatumsResponse,
    payloads: [
      { stationId: "9447130", mhwFt: 10.5, mhhwFt: 11.4, datum: "MLLW", units: "feet" },
      { stationId: "9447130", mhwFt: null, mhhwFt: null, datum: "MLLW", units: "feet" },
    ],
  },
  // GetTidalResponse: strict validateResponse is intentionally avoided in
  // tidal.ts (see comment there), but the spec schema still documents the
  // shape — pin a realistic payload so spec drift is still caught.
  GetTidalResponse: {
    schema: apiZod.GetTidalResponse,
    payloads: [
      {
        available: true,
        tideHeight: 1.8,
        currentDirection: 210,
        currentSpeed: 0.6,
        nextEvent: { type: "high", time: "2026-07-20T04:12:00.000Z", height: 3.1 },
        source: "noaa",
      },
      { available: false },
    ],
  },
  GetTidalScheduleResponse: {
    schema: apiZod.GetTidalScheduleResponse,
    payloads: [
      {
        available: true,
        source: "noaa",
        stationId: "9447130",
        stationName: "Seattle",
        rangeStart: "2026-07-20T00:00:00.000Z",
        rangeEnd: "2026-07-21T00:00:00.000Z",
        events: [
          {
            type: "high",
            time: "2026-07-20T04:12:00.000Z",
            height: 3.1,
            nextDirectionDeg: 210,
            windowStart: "2026-07-20T03:42:00.000Z",
            windowEnd: "2026-07-20T04:42:00.000Z",
          },
        ],
      },
      { available: false },
    ],
  },
  GetTidalPackResponse: {
    schema: apiZod.GetTidalPackResponse,
    payloads: [
      {
        station: "Seattle (9447130)",
        generatedAt: "2026-07-20T00:00:00.000Z",
        tidalExpiresAt: "2026-07-23T00:00:00.000Z",
        heightPredictions: [{ t: "2026-07-20T00:00:00.000Z", v: 1.55 }],
        currentPredictions: [{ t: "2026-07-20T00:00:00.000Z", speed: 0.3, dir: 210 }],
      },
      {
        station: null,
        generatedAt: "2026-07-20T00:00:00.000Z",
        tidalExpiresAt: "2026-07-23T00:00:00.000Z",
        heightPredictions: [],
        currentPredictions: [],
      },
    ],
  },

  // ── Intertidal ─────────────────────────────────────────────────────────
  GetIntertidalSpotsResponse: {
    schema: apiZod.GetIntertidalSpotsResponse,
    payloads: [
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              unitId: "PHY-12345",
              substrate: "bedrock",
              shoreZoneClass: "Rock platform",
              tidepoolScore: 87,
              beachcombingScore: 42,
              szMaterial: "bedrock",
              szForm: "platform",
              scoreSignals: {
                tidepool: { substrate: "bedrock", whySummary: "Bedrock platform holds pools" },
              },
            },
            geometry: { type: "Polygon", coordinates: [] },
          },
        ],
        metadata: { source: "ShoreZone" },
      },
      { type: "FeatureCollection", features: [] },
    ],
  },

  // ── Account ────────────────────────────────────────────────────────────
  ExportUserDataResponse: {
    schema: apiZod.ExportUserDataResponse,
    payloads: [
      {
        exportedAt: "2026-07-20T00:00:00.000Z",
        userId: "user-1",
        settings: { theme: "dark" },
        markers: [MARKER],
        customDatasets: [{ id: "ds-1", name: "Puget Sound" }],
        trails: [TRAIL_ROW],
      },
    ],
  },
  DeleteAccountResponse: {
    schema: apiZod.DeleteAccountResponse,
    payloads: [{ ok: true, deletedAt: "2026-07-20T00:00:00.000Z" }],
  },

  // ── Admin ──────────────────────────────────────────────────────────────
  AdminBucketMonitorResponse: {
    schema: apiZod.AdminBucketMonitorResponse,
    payloads: [
      {
        counts: { pending: 1, processing: 0, done: 5, failed: 1 },
        pending: [BUCKET_ITEM],
        processing: [],
        done: [BUCKET_ITEM],
        failed: [{ ...BUCKET_ITEM, error: "Parse failed" }],
        lifecycle: {
          processedDatasetsTtlDays: 30,
          failedDatasetsTtlDays: 14,
          note: "Applied via bucket lifecycle rules",
          permissionDenied: false,
          lastAppliedAt: "2026-07-19T00:00:00.000Z",
          lastApplyError: null,
        },
      },
    ],
  },
  AdminLargeDatasetsDiffResponse: {
    schema: apiZod.AdminLargeDatasetsDiffResponse,
    payloads: [
      {
        changedCount: 1,
        unimportedCount: 1,
        entries: [
          { filename: "lake_a.laz", largeDatasetsMd5: "abc", recordedSourceMd5: "def", status: "changed" },
          { filename: "lake_b.laz", largeDatasetsMd5: "abc", recordedSourceMd5: null, status: "unimported" },
        ],
      },
    ],
  },

  // ── Poe AI ─────────────────────────────────────────────────────────────
  PoeClassifyResponse: {
    schema: apiZod.PoeClassifyResponse,
    payloads: [
      {
        zones: Array(1024).fill("sandy_shelf"),
        fromCache: false,
        source: "ai",
        substrateFp: "00000000",
        coarseWidth: 32,
        coarseHeight: 32,
        tilesTotal: 1,
        tilesAi: 1,
        tilesHeuristic: 0,
      },
      { zones: Array(1024).fill("deep_basin"), fromCache: false, source: "heuristic" },
      { zones: Array(4096).fill("kelp_forest"), fromCache: false, source: "partial", coarseWidth: 64, coarseHeight: 64, tilesTotal: 4, tilesAi: 3, tilesHeuristic: 1 },
    ],
  },
  PoeQueryResponse: {
    schema: apiZod.PoeQueryResponse,
    payloads: [
      {
        toolCalls: [{ name: "flyTo", args: { lon: -122.4, lat: 47.6 }, id: "call_1" }],
        text: null,
        responseId: "resp_123",
      },
      { toolCalls: [], text: "The deepest point is 214 m.", responseId: null },
    ],
  },
  PoeHelpResponse: {
    schema: apiZod.PoeHelpResponse,
    payloads: [{ answer: "Use the sidebar to load a lake." }],
  },
  PoeUpscaleResponse: {
    schema: apiZod.PoeUpscaleResponse,
    payloads: [{ imageBase64: "iVBORw0KGgoAAAANSUhEUg==" }],
  },
  // GET /api/poe/models validates a lenient consumed-fields schema in the
  // route (see poe.ts) and forwards the raw payload; the generated spec
  // schema documents the known fields, so a realistic catalog must satisfy it.
  GetPoeModelsResponse: {
    schema: apiZod.GetPoeModelsResponse,
    payloads: [
      {
        object: "list",
        data: [
          { id: "Claude-Sonnet-4.5", object: "model", owned_by: "anthropic", description: "Fast reasoning" },
          { id: "GPT-5.4", object: "model", owned_by: "openai" },
        ],
      },
    ],
  },
};

// Schemas used with validateResponse(...) that are hand-written zod objects
// co-located with their route handler (NOT generated from openapi.yaml).
// They cannot drift from the handler via codegen — the schema lives in the
// same file as the payload construction — and their routes have dedicated
// suites. Listed here explicitly so the coverage meta-test documents (rather
// than silently ignores) their exclusion.
const LOCAL_SCHEMA_ALLOWLIST = new Set([
  "SurfaceConditionsResponseSchema", // surface-conditions.ts (local, passthrough)
  "TemperatureProfileResponseSchema", // temperature-profile.ts (local union)
  "AdminRateLimitUsageResponseSchema", // admin.ts (local)
  "AdminUpscaleCacheStatsResponseSchema", // admin.ts (local)
]);

// ---------------------------------------------------------------------------
// Fixture conformance tests
// ---------------------------------------------------------------------------

describe("spec conformance — realistic payloads validate against generated schemas", () => {
  for (const [name, { schema, payloads }] of Object.entries(FIXTURES)) {
    describe(name, () => {
      payloads.forEach((payload, idx) => {
        it(`payload #${idx + 1} conforms`, () => {
          expectConforms(schema, payload, name);
        });
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Negative cases — prove the guard actually bites on drift
// ---------------------------------------------------------------------------

describe("spec conformance — drift is rejected", () => {
  it("rejects a gcs-job-status value outside the spec enum", () => {
    expect(apiZod.GetGcsJobStatusResponse.safeParse({ status: "cancelled" }).success).toBe(false);
  });

  it("rejects an upload-job status value outside the spec enum", () => {
    expect(apiZod.GetUploadJobStatusResponse.safeParse({ status: "stalled" }).success).toBe(false);
  });

  it("rejects a marker type outside the spec enum", () => {
    expect(
      apiZod.GetMarkersResponseItem.safeParse({ ...MARKER, type: "sea_monster" }).success,
    ).toBe(false);
  });

  it("rejects a route response missing waypointCount", () => {
    const { waypointCount: _omitted, ...rest } = ROUTE_ROW;
    expect(apiZod.GetRoutesResponseItem.safeParse(rest).success).toBe(false);
  });

  it("rejects a classify source outside the spec enum", () => {
    expect(
      apiZod.PoeClassifyResponse.safeParse({ zones: ["a"], fromCache: false, source: "cached-ai" }).success,
    ).toBe(false);
  });

  it("rejects a my-saves status outside the spec enum", () => {
    expect(
      apiZod.GetDatasetsMySavesResponseItem.safeParse({ ...SAVE_ROW, status: "archived" }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Coverage meta-test — every validateResponse(...) call site must be covered
// ---------------------------------------------------------------------------

describe("spec conformance — coverage", () => {
  it("every schema used with validateResponse() has a fixture or a documented allowlist entry", () => {
    const routesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const routeFiles = readdirSync(routesDir).filter((f) => f.endsWith(".ts"));

    const used = new Set<string>();
    for (const file of routeFiles) {
      const src = readFileSync(path.join(routesDir, file), "utf8");
      // Match call sites (including multi-line calls); skip comments by
      // requiring the schema identifier to start with an uppercase letter.
      for (const m of src.matchAll(/validateResponse\(\s*([A-Z][A-Za-z0-9_]*)\s*,/g)) {
        used.add(m[1]!);
      }
    }

    expect(used.size).toBeGreaterThan(30); // sanity: the scan actually found routes

    const uncovered = [...used].filter(
      (name) => !(name in FIXTURES) && !LOCAL_SCHEMA_ALLOWLIST.has(name),
    );
    expect(
      uncovered,
      `Structured-response schemas without a spec-conformance fixture: ${uncovered.join(", ")}. ` +
        "Add a realistic payload fixture to FIXTURES (or, for hand-written local " +
        "schemas, an entry in LOCAL_SCHEMA_ALLOWLIST with rationale).",
    ).toEqual([]);
  });

  it("no fixture or allowlist entry is stale (schema no longer used by any route)", () => {
    const routesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const combined = readdirSync(routesDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readFileSync(path.join(routesDir, f), "utf8"))
      .join("\n");

    const stale = [...Object.keys(FIXTURES), ...LOCAL_SCHEMA_ALLOWLIST].filter(
      (name) => !combined.includes(name),
    );
    expect(
      stale,
      `Fixtures/allowlist entries for schemas no longer referenced in src/routes: ${stale.join(", ")}`,
    ).toEqual([]);
  });
});
