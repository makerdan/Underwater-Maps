/**
 * build-aoos-intertidal-pow.ts — Fetch AOOS Intertidal Habitat polygons for
 * Prince of Wales Island (SE Alaska) and write them as a bundled GeoJSON asset.
 *
 * Source: Alaska Ocean Observing System (AOOS) ArcGIS portal
 *   Portal: https://gis.aoos.org/
 *   Bbox: minLon −134, minLat 54.7, maxLon −132, maxLat 56.3
 *         (Prince of Wales Island / Clarence Strait / surrounding waters)
 *
 * The fetcher queries the AOOS Coastal Habitats FeatureServer for intertidal
 * habitat polygons intersecting the PoW bbox, maps their fields to the same
 * SubstrateFeatureProperties + scoring-attribute shape used for ShoreZone
 * features, and adds `source: "aoos-intertidal-pow"` to every feature.
 *
 * If the AOOS endpoint is unreachable (network error or 404) the script writes
 * an empty-features bundle with an explanatory note rather than failing, so
 * the API server still starts with a valid JSON file present.
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
// Try the standard AOOS GIS portal REST endpoint.
const AOOS_CANDIDATE_URLS = [
  "https://gis.aoos.org/arcgis/rest/services/AKCoastalHabitats/IntertidHabitat/FeatureServer/0",
  "https://gis.aoos.org/arcgis/rest/services/AKCoastalHabitats/IntertidHabitat/FeatureServer/1",
];

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

async function fetchPageFromUrl(
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
  const json = await resp.json() as AoosFeatureCollection & { error?: unknown };
  if ((json as { error?: unknown }).error) return null;
  return json;
}

async function tryFetchAll(baseUrl: string): Promise<AoosRawFeature[] | null> {
  const all: AoosRawFeature[] = [];
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const fc = await fetchPageFromUrl(baseUrl, offset);
    if (!fc) return null;
    all.push(...fc.features);
    const more = fc.exceededTransferLimit === true || fc.features.length >= PAGE_SIZE;
    if (!more || fc.features.length === 0) break;
    offset += fc.features.length;
  }
  return all;
}

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

function buildBundle(raw: AoosRawFeature[], fetchedAt: string, note?: string) {
  const features: BundledFeature[] = [];
  for (const f of raw) {
    if (!f.geometry) continue;
    const p = f.properties;
    const habitatType = String(p["HABITAT_TYPE"] ?? p["HabitatType"] ?? p["habitat_type"] ?? "");
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
        areaSqM: typeof p["AREA_SQKM"] === "number" ? Math.round(p["AREA_SQKM"] * 1_000_000) : null,
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
      sourceService: AOOS_CANDIDATE_URLS[0],
      creditUrl: "https://portal.aoos.org/",
      fetchedAt,
      featureCount: features.length,
      generatorHash: computeGeneratorHash(),
      ...(note ? { note } : {}),
    },
  };
}

export async function main(): Promise<void> {
  console.log("=== build-aoos-intertidal-pow ===");
  console.log(`Target bbox: ${JSON.stringify(FETCH_BBOX)}`);

  let raw: AoosRawFeature[] | null = null;
  let note: string | undefined;

  for (const url of AOOS_CANDIDATE_URLS) {
    console.log(`  Trying ${url}…`);
    try {
      raw = await tryFetchAll(url);
      if (raw !== null) {
        console.log(`  Fetched ${raw.length} raw features from ${url}`);
        break;
      }
    } catch (err) {
      console.warn(`  Error fetching from ${url}: ${(err as Error).message}`);
    }
  }

  if (raw === null || raw.length === 0) {
    note =
      "AOOS intertidal-habitat service was unreachable or returned no features for the PoW bbox. " +
      "This is an empty placeholder bundle; re-run build-aoos-intertidal-pow when the service is available.";
    console.warn(`  ${note}`);
    raw = [];
  }

  const bundle = buildBundle(raw, new Date().toISOString(), note);
  console.log(`  Built ${bundle.features.length} features`);

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
    console.error("Fatal:", err);
    process.exit(1);
  });
}
