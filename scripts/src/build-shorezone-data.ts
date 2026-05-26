/**
 * build-shorezone-data.ts — Fetch real Alaska ShoreZone substrate polygons
 * and write them as a bundled GeoJSON asset for the API server.
 *
 * Source: ShoreZone Coastal Habitat Mapping Program — Alaska layer
 *   AGOL service: https://services9.arcgis.com/ayzk2J4kDK5FpHqs/arcgis/rest/services/AK_SZ_ITZ_Polygons/FeatureServer/9
 *   Program info: https://alaskafisheries.noaa.gov/shorezone/
 *
 * Coverage note: the publicly-served Alaska ShoreZone polygon layer
 * (AK_SZ_ITZ_Polygons) currently covers ~58.4–59.1°N / 137.1–135.8°W
 * (Glacier Bay / Icy Strait area). Other Alaska ShoreZone surveys exist as
 * separate program shapefiles but are not published through this service.
 * The bundle is therefore a *regional* Alaska ShoreZone collection — the
 * `/api/substrate/:id` route filters features to each dataset's bbox at
 * request time, and any dataset whose AOI does not overlap published
 * ShoreZone coverage will (honestly) receive an empty FeatureCollection
 * with a `nearestCoverage` note in the response metadata.
 *
 * What this script does:
 *   1. Pages through AK_SZ_ITZ_Polygons FeatureServer for the full layer
 *      extent (the layer is small enough to bundle in its entirety).
 *   2. Maps each polygon's ShoreZone Mat_Desc + Form_Desc attributes onto
 *      a CMECS broad substrate class (bedrock / gravel / sand / mud).
 *   3. Writes the result to
 *      artifacts/api-server/src/lib/shoreZoneData.alaska.gen.ts
 *      as a TypeScript constant that the API server bundles directly.
 *
 * Usage / refreshing the bundle:
 *   pnpm --filter @workspace/scripts run build-shorezone
 *
 * Re-run whenever the upstream ShoreZone service publishes updates, then
 * commit the refreshed `shoreZoneData.alaska.gen.json` alongside any
 * builder-source changes that triggered the regeneration. The script
 * makes live HTTP requests to the AGOL FeatureServer, so refreshing
 * requires outbound network access.
 *
 * Generator-hash drift check:
 *   The bundle's `metadata.generatorHash` is a SHA-256 of this source
 *   file. A unit test in `artifacts/api-server` recomputes the hash on
 *   every test run and fails if the committed bundle was produced by a
 *   different version of this script — flagging stale bundles whenever
 *   the builder logic, classifier, or region bbox change without the
 *   JSON being regenerated. If the test fails, run the command above
 *   and commit the refreshed JSON.
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUILDER_SRC_PATH = fileURLToPath(import.meta.url);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// --- Configuration ---------------------------------------------------------

const SERVICE =
  "https://services9.arcgis.com/ayzk2J4kDK5FpHqs/arcgis/rest/services/AK_SZ_ITZ_Polygons/FeatureServer/9";

/** Fetch bbox: full Alaska ShoreZone polygon layer extent (Glacier Bay /
 *  Icy Strait area, ~58.4–59.1°N, –137.1 to –135.8°W per the AGOL service
 *  extent). A bit of padding so any boundary polygons are not clipped. */
const FETCH_BBOX = { minLon: -138.0, minLat: 58.0, maxLon: -135.0, maxLat: 59.5 };

/** Output bbox stamped into the bundle metadata. Identifies the geographic
 *  extent of the bundled real-world ShoreZone polygons. Widened to match
 *  the upstream AGOL service extent so every fetched polygon lies inside
 *  the declared region bbox. */
const REGION_BBOX: [number, number, number, number] = [-137.2, 58.3, -135.7, 59.2];

const OUT_PATH = resolve(
  REPO_ROOT,
  "artifacts/api-server/src/lib/shoreZoneData.alaska.gen.json",
);

const PAGE_SIZE = 1000;

// --- ShoreZone → CMECS substrate mapping -----------------------------------

type CmecsClass = "bedrock" | "gravel" | "sand" | "mud";

interface Classification {
  substrate: CmecsClass;
  cmecsCode: string;
  shoreZoneClass: string;
  color: string;
}

const CMECS: Record<CmecsClass, string> = {
  bedrock: "2.1.1 Consolidated Mineral Substrate",
  gravel:  "2.2.1 Mixed Coarse Unconsolidated Substrate",
  sand:    "2.2.2 Sand",
  mud:     "2.2.4 Fine Unconsolidated Substrate",
};

const COLOR: Record<CmecsClass, string> = {
  bedrock: "#6b6b6b",
  gravel:  "#b0956a",
  sand:    "#e2d5a0",
  mud:     "#8b7355",
};

/**
 * Map a ShoreZone ITZ polygon (Mat_Desc + Form_Desc) onto a CMECS class.
 *
 * Per the ShoreZone Coastal Imaging & Habitat Mapping Protocol (2017):
 *   Mat_Desc "Rock"     — consolidated bedrock (R/)
 *   Mat_Desc "Clastic"  — unconsolidated sediment (boulders → mud)
 *   Mat_Desc "Biogenic" — organic substrate (marshes, peat)
 *
 * Form_Desc refines the substrate texture:
 *   Cliff / Platform / Ramp — coarse-dominant
 *   Beach                   — sand-to-gravel beach (sand-dominant)
 *   Tidal Flat / Marsh      — fine sediment / organics
 */
function classifyShoreZone(matDesc: string | null, formDesc: string | null): Classification {
  const m = (matDesc ?? "").trim();
  const f = (formDesc ?? "").trim();

  let substrate: CmecsClass;
  if (m === "Rock") {
    substrate = "bedrock";
  } else if (m === "Biogenic") {
    substrate = "mud";
  } else {
    // Clastic (or unknown) — pick by form
    if (f === "Tidal Flat" || f === "Marsh" || f === "Lagoon") substrate = "mud";
    else if (f === "Beach") substrate = "sand";
    else substrate = "gravel"; // Cliff / Platform / Ramp / unknown clastic
  }

  return {
    substrate,
    cmecsCode: CMECS[substrate],
    shoreZoneClass: [m, f].filter(Boolean).join(" ") || "Unclassified",
    color: COLOR[substrate],
  };
}

// --- GeoJSON types ---------------------------------------------------------

interface RawProps {
  OBJECTID?: number;
  PHY_IDENT?: string;
  Material?: string;
  Mat_Desc?: string;
  Form?: string;
  Form_Desc?: string;
  ORI?: number;
  ORI_Desc?: string;
  Area?: number;
}

interface PolygonGeom {
  type: "Polygon";
  coordinates: number[][][];
}
interface MultiPolygonGeom {
  type: "MultiPolygon";
  coordinates: number[][][][];
}
type AnyPolygonGeom = PolygonGeom | MultiPolygonGeom;

interface RawFeature {
  type: "Feature";
  properties: RawProps;
  geometry: AnyPolygonGeom;
}

interface RawFc {
  type: "FeatureCollection";
  features: RawFeature[];
  exceededTransferLimit?: boolean;
}

// --- Fetching --------------------------------------------------------------

async function fetchPage(offset: number): Promise<RawFc> {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${FETCH_BBOX.minLon},${FETCH_BBOX.minLat},${FETCH_BBOX.maxLon},${FETCH_BBOX.maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "OBJECTID,PHY_IDENT,Material,Mat_Desc,Form,Form_Desc,ORI,ORI_Desc,Area",
    outSR: "4326",
    f: "geojson",
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
  });
  const url = `${SERVICE}/query?${params.toString()}`;
  console.log(`  GET ${url.slice(0, 110)}…  (offset=${offset})`);
  const resp = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "(unreadable)");
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }
  return (await resp.json()) as RawFc;
}

async function fetchAll(): Promise<RawFeature[]> {
  const all: RawFeature[] = [];
  let offset = 0;
  // ArcGIS Online soft-caps at 1000–2000 features per page. Page until done.
  // Note: with `f=geojson`, ArcGIS does NOT include `exceededTransferLimit`
  // in the response (that flag only appears with `f=json`). Detect "more
  // pages remain" by checking whether we got a full page back.
  // Hard upper bound to avoid runaway loops.
  for (let page = 0; page < 50; page++) {
    const fc = await fetchPage(offset);
    all.push(...fc.features);
    const more =
      fc.exceededTransferLimit === true || fc.features.length >= PAGE_SIZE;
    if (!more || fc.features.length === 0) break;
    offset += fc.features.length;
  }
  return all;
}

// --- Bundle construction ---------------------------------------------------

/** Quick bbox-intersection test against REGION_BBOX. */
function geomIntersectsRegion(geom: AnyPolygonGeom): boolean {
  const [minLon, minLat, maxLon, maxLat] = REGION_BBOX;
  const rings: number[][][] =
    geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon! >= minLon && lon! <= maxLon && lat! >= minLat && lat! <= maxLat) return true;
    }
  }
  return false;
}

interface BundledProps {
  unitId: string;
  substrate: CmecsClass;
  shoreZoneClass: string;
  cmecsCode: string;
  color: string;
  szMaterial: string | null;
  szForm: string | null;
  areaSqM: number | null;
}

interface BundledFeature {
  type: "Feature";
  properties: BundledProps;
  geometry: AnyPolygonGeom;
}

interface BundledCollection {
  type: "FeatureCollection";
  features: BundledFeature[];
  metadata: {
    region: string;
    bbox: [number, number, number, number];
    source: "alaska-shorezone";
    sourceName: string;
    sourceLayer: string;
    sourceService: string;
    creditUrl: string;
    fetchedAt: string;
    featureCount: number;
    /** SHA-256 of the builder source file (`build-shorezone-data.ts`),
     *  recorded so consumers can detect a stale bundle when the builder
     *  logic, classifier, or region bbox change without the JSON being
     *  regenerated. Validated by a unit test in api-server. */
    generatorHash: string;
  };
}

/** SHA-256 hex digest of the builder source file. Computed at runtime so
 *  any edit to this script changes the hash and therefore the bundle. */
function computeGeneratorHash(): string {
  const src = readFileSync(BUILDER_SRC_PATH);
  return createHash("sha256").update(src).digest("hex");
}

function buildBundle(raw: RawFeature[]): BundledCollection {
  const features: BundledFeature[] = [];
  for (const f of raw) {
    if (!f.geometry || !geomIntersectsRegion(f.geometry)) continue;
    const cls = classifyShoreZone(
      f.properties.Mat_Desc ?? null,
      f.properties.Form_Desc ?? null,
    );
    features.push({
      type: "Feature",
      properties: {
        unitId: f.properties.PHY_IDENT ?? `SZ-${f.properties.OBJECTID ?? "?"}`,
        substrate: cls.substrate,
        shoreZoneClass: cls.shoreZoneClass,
        cmecsCode: cls.cmecsCode,
        color: cls.color,
        szMaterial: f.properties.Mat_Desc ?? null,
        szForm: f.properties.Form_Desc ?? null,
        areaSqM: typeof f.properties.Area === "number" ? Math.round(f.properties.Area) : null,
      },
      geometry: f.geometry,
    });
  }
  return {
    type: "FeatureCollection",
    features,
    metadata: {
      region: "Glacier Bay / Icy Strait, SE Alaska (AK_SZ_ITZ_Polygons layer extent)",
      bbox: REGION_BBOX,
      source: "alaska-shorezone",
      sourceName: "Alaska ShoreZone Coastal Habitat Mapping Program (NOAA AKR / ADF&G)",
      sourceLayer: "AK_SZ_ITZ_Polygons",
      sourceService: SERVICE,
      creditUrl: "https://alaskafisheries.noaa.gov/shorezone/",
      fetchedAt: new Date().toISOString(),
      featureCount: features.length,
      generatorHash: computeGeneratorHash(),
    },
  };
}

// --- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== build-shorezone-data ===");
  console.log(`Fetching ShoreZone ITZ polygons for bbox ${JSON.stringify(FETCH_BBOX)}…`);

  const raw = await fetchAll();
  console.log(`  Received ${raw.length} raw features`);

  const bundle = buildBundle(raw);
  console.log(`  Region-filtered: ${bundle.features.length} features`);

  const counts: Record<string, number> = {};
  for (const f of bundle.features) {
    counts[f.properties.substrate] = (counts[f.properties.substrate] ?? 0) + 1;
  }
  console.log(`  Substrate distribution: ${JSON.stringify(counts)}`);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  // Emit as a plain JSON file so TypeScript doesn't have to parse a 10+ MB
  // source file (which previously OOM'd `tsc`). The API server reads this
  // file at runtime via fs.readFileSync.
  writeFileSync(OUT_PATH, JSON.stringify(bundle), "utf8");
  console.log(`  Wrote ${OUT_PATH}`);
  console.log("=== done ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
