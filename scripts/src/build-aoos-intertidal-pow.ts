/**
 * build-aoos-intertidal-pow.ts — Fetch AOOS Intertidal Habitat polygons for
 * Prince of Wales Island (SE Alaska) and write them as a bundled GeoJSON asset.
 *
 * Primary source: Alaska Ocean Observing System (AOOS) ArcGIS portal
 *   Portal: https://gis.aoos.org/
 *   Bbox: minLon −134, minLat 54.7, maxLon −132, maxLat 56.3
 *         (Prince of Wales Island / Clarence Strait / surrounding waters)
 *
 * Fallback source (used when AOOS endpoint is unreachable):
 *   NOAA Electronic Navigational Charts — Coastal.Seabed_Area (S-57 SBDARE)
 *   Service: https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/enc_coastal/MapServer/144
 *   This is the same ENC service used by the SE Alaska substrate bundle; it
 *   provides real substrate polygons for the PoW bbox via NATSUR attributes.
 *
 * The fetcher queries the primary source for intertidal habitat polygons
 * intersecting the PoW bbox, maps their fields to the same
 * SubstrateFeatureProperties + scoring-attribute shape used for ShoreZone
 * features, and adds `source: "aoos-intertidal-pow"` to every feature.
 *
 * If the AOOS endpoint is unreachable (network error or 404) the script
 * automatically falls back to the NOAA ENC coastal layer for the same bbox.
 * The fallback uses ENC NATSUR substrate classification and records the
 * actual data source in the bundle metadata.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run build-aoos-intertidal-pow
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUILDER_SRC_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Prince of Wales Island bbox
const FETCH_BBOX = { minLon: -134.0, minLat: 54.7, maxLon: -132.0, maxLat: 56.3 };
const REGION_BBOX: [number, number, number, number] = [-134, 54.7, -132, 56.3];

export const OUT_PATH = resolve(
  REPO_ROOT,
  "artifacts/api-server/src/lib/aoosIntertidalPow.gen.json",
);

// AOOS ArcGIS FeatureServer endpoint — intertidal habitat layer.
const AOOS_CANDIDATE_URLS = [
  "https://gis.aoos.org/arcgis/rest/services/AKCoastalHabitats/IntertidHabitat/FeatureServer/0",
  "https://gis.aoos.org/arcgis/rest/services/AKCoastalHabitats/IntertidHabitat/FeatureServer/1",
];

// NOAA ENC coastal service — fallback for when AOOS is unreachable.
// Layer 144 = Coastal.Seabed_Area (S-57 SBDARE polygons with NATSUR attribute).
const ENC_FALLBACK_SERVICE =
  "https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/enc_coastal/MapServer/144";

const PAGE_SIZE = 500;
const FETCH_TIMEOUT_MS = 30_000;

type CmecsClass = "bedrock" | "gravel" | "sand" | "mud";

const CMECS: Record<CmecsClass, string> = {
  bedrock: "2.1.1 Consolidated Mineral Substrate",
  gravel: "2.2.1 Mixed Coarse Unconsolidated Substrate",
  sand: "2.2.2 Sand",
  mud: "2.2.4 Fine Unconsolidated Substrate",
};

const COLOR: Record<CmecsClass, string> = {
  bedrock: "#6b6b6b",
  gravel: "#b0956a",
  sand: "#e2d5a0",
  mud: "#8b7355",
};

// ---------------------------------------------------------------------------
// AOOS habitat-type classifier
// ---------------------------------------------------------------------------

function classifyAoosHabitat(habitatType: string | null): {
  substrate: CmecsClass;
  cmecsCode: string;
  color: string;
} {
  const h = (habitatType ?? "").toLowerCase();
  let substrate: CmecsClass = "mud";
  if (h.includes("bedrock") || h.includes("boulder") || h.includes("rock")) {
    substrate = "bedrock";
  } else if (h.includes("cobble") || h.includes("gravel") || h.includes("rubble")) {
    substrate = "gravel";
  } else if (h.includes("sand") || h.includes("beach")) {
    substrate = "sand";
  } else if (h.includes("mud") || h.includes("flat") || h.includes("marsh")) {
    substrate = "mud";
  }
  return { substrate, cmecsCode: CMECS[substrate], color: COLOR[substrate] };
}

// ---------------------------------------------------------------------------
// ENC NATSUR classifier (S-57 substrate tokens → CMECS)
// ---------------------------------------------------------------------------

function classifyEncNatsur(natsur: string | null): {
  substrate: CmecsClass;
  cmecsCode: string;
  color: string;
  encClass: string;
} {
  const raw = (natsur ?? "").trim();
  const first = raw.split(/[,;\s]+/).filter(Boolean)[0]?.toLowerCase() ?? "";

  let substrate: CmecsClass = "gravel";
  switch (first) {
    case "mud":
    case "clay":
    case "silt":
      substrate = "mud";
      break;
    case "sand":
    case "shells":
      substrate = "sand";
      break;
    case "gravel":
    case "pebbles":
    case "cobbles":
    case "stone":
      substrate = "gravel";
      break;
    case "rock":
    case "boulder":
    case "boulders":
    case "lava":
    case "coral":
      substrate = "bedrock";
      break;
  }

  return {
    substrate,
    cmecsCode: CMECS[substrate],
    color: COLOR[substrate],
    encClass: raw || "Unclassified",
  };
}

// ---------------------------------------------------------------------------
// GeoJSON / ArcGIS response types
// ---------------------------------------------------------------------------

interface AoosRawFeature {
  type: string;
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown>;
}

interface AoosFeatureCollection {
  type: string;
  features: AoosRawFeature[];
  exceededTransferLimit?: boolean;
}

// ArcGIS MapServer query returns features with "attributes"/"geometry"
interface EncRawFeature {
  attributes: Record<string, unknown>;
  geometry: { rings?: number[][][] } | null;
}

interface EncQueryResponse {
  features?: EncRawFeature[];
  exceededTransferLimit?: boolean;
  error?: unknown;
}

// ---------------------------------------------------------------------------
// AOOS paginated fetch
// ---------------------------------------------------------------------------

async function fetchAoosPageFromUrl(
  baseUrl: string,
  offset: number,
): Promise<AoosFeatureCollection | null> {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${FETCH_BBOX.minLon},${FETCH_BBOX.minLat},${FETCH_BBOX.maxLon},${FETCH_BBOX.maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    outSR: "4326",
    f: "geojson",
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
  });
  const url = `${baseUrl}/query?${params.toString()}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) return null;
  const json = (await resp.json()) as AoosFeatureCollection & { error?: unknown };
  if ((json as { error?: unknown }).error) return null;
  return json;
}

async function tryFetchAoosAll(baseUrl: string): Promise<AoosRawFeature[] | null> {
  const all: AoosRawFeature[] = [];
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const fc = await fetchAoosPageFromUrl(baseUrl, offset);
    if (!fc) return null;
    all.push(...fc.features);
    const more = fc.exceededTransferLimit === true || fc.features.length >= PAGE_SIZE;
    if (!more || fc.features.length === 0) break;
    offset += fc.features.length;
  }
  return all;
}

// ---------------------------------------------------------------------------
// ENC fallback paginated fetch
// ---------------------------------------------------------------------------

async function fetchEncPage(offset: number): Promise<EncQueryResponse | null> {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${FETCH_BBOX.minLon},${FETCH_BBOX.minLat},${FETCH_BBOX.maxLon},${FETCH_BBOX.maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "OBJECTID,NATSUR,NATQUA,DSNM",
    outSR: "4326",
    f: "json",
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
  });
  const url = `${ENC_FALLBACK_SERVICE}/query?${params.toString()}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) return null;
  const json = (await resp.json()) as EncQueryResponse;
  if (json.error) return null;
  return json;
}

async function tryFetchEncAll(): Promise<EncRawFeature[] | null> {
  const all: EncRawFeature[] = [];
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const r = await fetchEncPage(offset);
    if (!r || !r.features) return null;
    all.push(...r.features);
    const more = r.exceededTransferLimit === true || r.features.length >= PAGE_SIZE;
    if (!more || r.features.length === 0) break;
    offset += r.features.length;
  }
  return all.length > 0 ? all : null;
}

// ---------------------------------------------------------------------------
// Bundle builders
// ---------------------------------------------------------------------------

function computeGeneratorHash(): string {
  const src = readFileSync(BUILDER_SRC_PATH);
  return createHash("sha256").update(src).digest("hex");
}

interface BundledFeature {
  type: "Feature";
  properties: {
    unitId: string;
    substrate: CmecsClass;
    shoreZoneClass: string;
    cmecsCode: string;
    color: string;
    source: "aoos-intertidal-pow";
    szMaterial: string | null;
    szForm: string | null;
    areaSqM: number | null;
    itzSubclass: string | null;
  };
  geometry: unknown;
}

function buildBundleFromAoos(
  raw: AoosRawFeature[],
  fetchedAt: string,
  serviceUrl: string,
  note?: string,
) {
  const features: BundledFeature[] = [];
  for (const f of raw) {
    if (!f.geometry) continue;
    const p = f.properties;
    const habitatType = String(
      p["HABITAT_TYPE"] ?? p["HabitatType"] ?? p["habitat_type"] ?? "",
    );
    const cls = classifyAoosHabitat(habitatType);
    const unitId = String(
      p["OBJECTID"] ?? p["ObjectID"] ?? p["FID"] ?? `AOOS-${features.length}`,
    );
    features.push({
      type: "Feature",
      properties: {
        unitId: `AOOS-POW-${unitId}`,
        substrate: cls.substrate,
        shoreZoneClass: habitatType || "AOOS Intertidal Habitat",
        cmecsCode: cls.cmecsCode,
        color: cls.color,
        source: "aoos-intertidal-pow",
        szMaterial: null,
        szForm: habitatType || null,
        areaSqM:
          typeof p["AREA_SQKM"] === "number"
            ? Math.round((p["AREA_SQKM"] as number) * 1_000_000)
            : null,
        itzSubclass: habitatType || null,
      },
      geometry: f.geometry,
    });
  }

  return {
    type: "FeatureCollection",
    features,
    metadata: {
      region: "Prince of Wales Island, SE Alaska (AOOS Intertidal Habitats)",
      bbox: REGION_BBOX,
      source: "aoos-intertidal-pow",
      sourceName: "AOOS Alaska Coastal Habitats — Intertidal (Prince of Wales Island)",
      sourceLayer: "IntertidHabitat",
      sourceService: serviceUrl,
      creditUrl: "https://portal.aoos.org/",
      fetchedAt,
      featureCount: features.length,
      generatorHash: computeGeneratorHash(),
      ...(note ? { note } : {}),
    },
  };
}

function buildBundleFromEnc(
  raw: EncRawFeature[],
  fetchedAt: string,
  note?: string,
) {
  const features: BundledFeature[] = [];
  for (const f of raw) {
    if (!f.geometry) continue;
    const p = f.attributes;
    const natsur = typeof p["NATSUR"] === "string" ? (p["NATSUR"] as string) : null;
    const cls = classifyEncNatsur(natsur);
    const oid = String(p["OBJECTID"] ?? `ENC-${features.length}`);
    features.push({
      type: "Feature",
      properties: {
        unitId: `AOOS-POW-ENC-${oid}`,
        substrate: cls.substrate,
        shoreZoneClass: cls.encClass,
        cmecsCode: cls.cmecsCode,
        color: cls.color,
        source: "aoos-intertidal-pow",
        szMaterial: null,
        szForm: natsur,
        areaSqM: null,
        itzSubclass: natsur,
      },
      geometry: { type: "Polygon", coordinates: f.geometry.rings ?? [] },
    });
  }

  return {
    type: "FeatureCollection",
    features,
    metadata: {
      region: "Prince of Wales Island, SE Alaska (AOOS Intertidal Habitats)",
      bbox: REGION_BBOX,
      source: "aoos-intertidal-pow",
      sourceName:
        "AOOS Prince of Wales Island — Intertidal (NOAA ENC coastal fallback)",
      sourceLayer: "Coastal.Seabed_Area (S-57 SBDARE)",
      sourceService: ENC_FALLBACK_SERVICE,
      creditUrl: "https://nauticalcharts.noaa.gov/charts/noaa-enc.html",
      fetchedAt,
      featureCount: features.length,
      generatorHash: computeGeneratorHash(),
      ...(note ? { note } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
  console.log("=== build-aoos-intertidal-pow ===");
  console.log(`Target bbox: ${JSON.stringify(FETCH_BBOX)}`);

  let aoosRaw: AoosRawFeature[] | null = null;

  for (const url of AOOS_CANDIDATE_URLS) {
    console.log(`  Trying AOOS: ${url}…`);
    try {
      aoosRaw = await tryFetchAoosAll(url);
      if (aoosRaw !== null) {
        console.log(`  Fetched ${aoosRaw.length} raw features from AOOS ${url}`);
        break;
      }
    } catch (err) {
      console.warn(`  Error fetching from ${url}: ${(err as Error).message}`);
    }
  }

  const fetchedAt = new Date().toISOString();

  // AOOS succeeded — build from AOOS data
  if (aoosRaw !== null && aoosRaw.length > 0) {
    const bundle = buildBundleFromAoos(aoosRaw, fetchedAt, AOOS_CANDIDATE_URLS[0]!);
    console.log(`  Built ${bundle.features.length} features from AOOS`);
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(bundle), "utf8");
    console.log(`  Wrote ${OUT_PATH}`);
    console.log("=== done ===");
    return;
  }

  // AOOS unreachable or empty — try NOAA ENC fallback
  console.log(
    "  AOOS endpoints unreachable or returned no features; trying NOAA ENC coastal fallback…",
  );
  console.log(`  Trying ENC fallback: ${ENC_FALLBACK_SERVICE}…`);

  let encRaw: EncRawFeature[] | null = null;
  try {
    encRaw = await tryFetchEncAll();
    if (encRaw !== null) {
      console.log(`  Fetched ${encRaw.length} raw features from NOAA ENC`);
    }
  } catch (err) {
    console.warn(`  Error fetching from ENC: ${(err as Error).message}`);
  }

  if (encRaw !== null && encRaw.length > 0) {
    const note =
      "AOOS intertidal-habitat service was unreachable; this bundle was built from NOAA ENC " +
      "coastal Seabed_Area (S-57 SBDARE) polygons for the Prince of Wales Island bbox. " +
      "Re-run build-aoos-intertidal-pow when gis.aoos.org is reachable to refresh with " +
      "authoritative AOOS intertidal-habitat polygons.";
    const bundle = buildBundleFromEnc(encRaw, fetchedAt, note);
    console.log(`  Built ${bundle.features.length} features from NOAA ENC fallback`);
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(bundle), "utf8");
    console.log(`  Wrote ${OUT_PATH}`);
    console.log("=== done (ENC fallback) ===");
    return;
  }

  // Both sources failed — write empty placeholder
  const note =
    "Both the AOOS intertidal-habitat service and the NOAA ENC coastal fallback were " +
    "unreachable or returned no features for the PoW bbox. " +
    "This is an empty placeholder bundle; re-run build-aoos-intertidal-pow when " +
    "network access is available.";
  console.warn(`  ${note}`);
  const bundle = buildBundleFromAoos([], fetchedAt, AOOS_CANDIDATE_URLS[0]!, note);
  console.log(`  Built ${bundle.features.length} features (empty placeholder)`);
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(bundle), "utf8");
  console.log(`  Wrote ${OUT_PATH}`);
  console.log("=== done (empty placeholder) ===");
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "");

if (invokedDirectly) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
