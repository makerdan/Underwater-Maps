/**
 * build-enc-substrate.ts — Fetch real NOAA ENC seabed substrate polygons
 * for Southeast Alaska and write them as a bundled GeoJSON asset for the
 * API server.
 *
 * Why this exists: the published Alaska ShoreZone polygon layer only covers
 * Glacier Bay / Icy Strait. The rest of SE Alaska (Sitka, Juneau, Ketchikan,
 * Thorne Bay / Prince of Wales Island) has no public ShoreZone polygon
 * coverage. NOAA Electronic Navigational Charts (ENC) publish a
 * `Coastal.Seabed_Area` polygon layer (S-57 SBDARE feature) covering all
 * US navigable waters — including the rest of SE Alaska — with a
 * `NATSUR` (nature of surface) attribute that we map onto the same CMECS
 * substrate classes (bedrock / gravel / sand / mud) the ShoreZone bundle
 * uses. This gives every SE Alaska preset real, attributable substrate
 * polygons.
 *
 * Source: NOAA Office of Coast Survey ENC Direct
 *   Service: https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/enc_coastal/MapServer/144
 *   Layer:   Coastal.Seabed_Area (S-57 SBDARE polygons, NATSUR attribute)
 *   Info:    https://nauticalcharts.noaa.gov/charts/noaa-enc.html
 *
 * Usage / refreshing the bundle:
 *   pnpm --filter @workspace/scripts run build-enc-substrate
 *
 * Re-run whenever the upstream NOAA ENC service publishes updates, then
 * commit the refreshed `encSubstrateData.alaska.gen.json` alongside any
 * builder-source changes that triggered the regeneration. The script
 * makes live HTTP requests to NOAA's ArcGIS service, so refreshing
 * requires outbound network access.
 *
 * Generator-hash drift check:
 *   The bundle's `metadata.generatorHash` is a SHA-256 of this source
 *   file. A unit test in `artifacts/api-server` recomputes the hash on
 *   every test run and fails if the committed bundle was produced by a
 *   different version of this script — flagging stale bundles whenever
 *   the builder logic, NATSUR classifier, or region bbox change without
 *   the JSON being regenerated. If the test fails, run the command
 *   above and commit the refreshed JSON.
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUILDER_SRC_PATH = fileURLToPath(import.meta.url);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// --- Configuration ---------------------------------------------------------

const SERVICE =
  "https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/enc_coastal/MapServer/144";

/** Fetch bbox: full SE Alaska Inside Passage — covers every current preset
 *  (Thorne Bay / Ketchikan in the south, Sitka, Juneau, Glacier Bay /
 *  Icy Strait in the north) with generous padding. */
const FETCH_BBOX = { minLon: -138.5, minLat: 54.5, maxLon: -130.0, maxLat: 60.0 };

/** Output bbox stamped into bundle metadata. */
const REGION_BBOX: [number, number, number, number] = [-138.5, 54.5, -130.0, 60.0];

export const OUT_PATH = resolve(
  REPO_ROOT,
  "artifacts/api-server/src/lib/encSubstrateData.alaska.gen.json",
);

const PAGE_SIZE = 1000;

// --- NATSUR (S-57) → CMECS substrate mapping -------------------------------

type CmecsClass = "bedrock" | "gravel" | "sand" | "mud";

interface Classification {
  substrate: CmecsClass;
  cmecsCode: string;
  encClass: string;
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
 * Map a single S-57 NATSUR token (lower-case) to a CMECS class.
 *
 * S-57 NATSUR codes (per IHO S-57 Appendix A, Chapter 2 attribute catalogue):
 *   1 mud, 2 clay, 3 silt, 4 sand, 5 stone, 6 gravel, 7 pebbles, 8 cobbles,
 *   9 rock, 14 shells, 17 boulders, 18 ice (NOAA's ENC export resolves the
 *   numeric codes to their English keywords in the NATSUR string).
 */
function classifyOne(token: string): CmecsClass {
  switch (token) {
    case "mud":
    case "clay":
    case "silt":
      return "mud";
    case "sand":
      return "sand";
    case "shells": // treat shell hash as coarse sand-equivalent
      return "sand";
    case "gravel":
    case "pebbles":
    case "cobbles":
    case "stone":
      return "gravel";
    case "rock":
    case "boulder":
    case "boulders":
    case "lava":
    case "coral":
      return "bedrock";
    default:
      return "gravel"; // unknown — coarse-unspecified default
  }
}

/**
 * NATSUR may be a comma-separated list ("rock,sand") representing mixed
 * substrate. We pick the dominant (first-listed) class per S-57 convention
 * but record the full original string in `encClass` for traceability.
 */
function classifyEnc(natsur: string | null): Classification {
  const raw = (natsur ?? "").trim();
  const first = raw.split(/[,;\s]+/).filter(Boolean)[0]?.toLowerCase() ?? "";
  const substrate: CmecsClass = first ? classifyOne(first) : "gravel";
  return {
    substrate,
    cmecsCode: CMECS[substrate],
    encClass: raw || "Unclassified",
    color: COLOR[substrate],
  };
}

// --- GeoJSON types ---------------------------------------------------------

interface RawProps {
  OBJECTID?: number;
  NATSUR?: string | null;
  NATQUA?: string | null;
  COLOUR?: string | null;
  OBJNAM?: string | null;
  INFORM?: string | null;
  DSNM?: string | null;
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
    outFields: "OBJECTID,NATSUR,NATQUA,COLOUR,OBJNAM,INFORM,DSNM",
    outSR: "4326",
    f: "geojson",
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
  });
  const url = `${SERVICE}/query?${params.toString()}`;
  console.log(`  GET ${url.slice(0, 110)}…  (offset=${offset})`);
  const resp = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "(unreadable)");
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }
  return (await resp.json()) as RawFc;
}

async function fetchAll(): Promise<RawFeature[]> {
  const all: RawFeature[] = [];
  let offset = 0;
  for (let page = 0; page < 200; page++) {
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

interface BundledProps {
  unitId: string;
  substrate: CmecsClass;
  shoreZoneClass: string; // kept compatible with ShoreZone bundle for shared rendering
  cmecsCode: string;
  color: string;
  /** Source-of-record so /api/substrate/:id can render per-feature attribution. */
  source: "noaa-enc-coastal";
  /** Raw S-57 NATSUR string (e.g. "rock", "sand,mud"). */
  natsur: string | null;
  /** Raw S-57 NATQUA qualifier (e.g. "fine", "broken"). */
  natqua: string | null;
  /** ENC dataset name (e.g. "US3AK1DY.000") — chart-level provenance. */
  encChart: string | null;
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
    source: "noaa-enc-coastal";
    sourceName: string;
    sourceLayer: string;
    sourceService: string;
    creditUrl: string;
    fetchedAt: string;
    featureCount: number;
    /** SHA-256 of the builder source file (`build-enc-substrate.ts`),
     *  recorded so consumers can detect a stale bundle when the builder
     *  logic, NATSUR classifier, or region bbox change without the JSON
     *  being regenerated. Validated by a unit test in api-server. */
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
  let drop = 0;
  for (const f of raw) {
    if (!f.geometry || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) {
      drop++;
      continue;
    }
    const cls = classifyEnc(f.properties.NATSUR ?? null);
    features.push({
      type: "Feature",
      properties: {
        unitId: `ENC-${f.properties.OBJECTID ?? "?"}`,
        substrate: cls.substrate,
        shoreZoneClass: cls.encClass,
        cmecsCode: cls.cmecsCode,
        color: cls.color,
        source: "noaa-enc-coastal",
        natsur: f.properties.NATSUR ?? null,
        natqua: f.properties.NATQUA ?? null,
        encChart: f.properties.DSNM ?? null,
      },
      geometry: f.geometry,
    });
  }
  if (drop > 0) console.log(`  dropped ${drop} non-polygon features`);
  return {
    type: "FeatureCollection",
    features,
    metadata: {
      region: "Southeast Alaska Inside Passage (NOAA ENC Coastal.Seabed_Area)",
      bbox: REGION_BBOX,
      source: "noaa-enc-coastal",
      sourceName: "NOAA Electronic Navigational Charts — Coastal.Seabed_Area (S-57 SBDARE)",
      sourceLayer: "Coastal.Seabed_Area",
      sourceService: SERVICE,
      creditUrl: "https://nauticalcharts.noaa.gov/charts/noaa-enc.html",
      fetchedAt: new Date().toISOString(),
      featureCount: features.length,
      generatorHash: computeGeneratorHash(),
    },
  };
}

// --- Main ------------------------------------------------------------------

export async function main(): Promise<void> {
  console.log("=== build-enc-substrate ===");
  console.log(`Fetching ENC Seabed_Area polygons for bbox ${JSON.stringify(FETCH_BBOX)}…`);

  const raw = await fetchAll();
  console.log(`  Received ${raw.length} raw features`);

  const bundle = buildBundle(raw);
  console.log(`  Bundled: ${bundle.features.length} features`);

  const counts: Record<string, number> = {};
  for (const f of bundle.features) {
    counts[f.properties.substrate] = (counts[f.properties.substrate] ?? 0) + 1;
  }
  console.log(`  Substrate distribution: ${JSON.stringify(counts)}`);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(bundle), "utf8");
  console.log(`  Wrote ${OUT_PATH}`);
  console.log("=== done ===");
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "");

if (invokedDirectly) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
