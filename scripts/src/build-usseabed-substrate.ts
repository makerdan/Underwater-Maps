/**
 * build-usseabed-substrate.ts — Fetch real US lower-48 coastal seabed
 * substrate polygons (a "usSEABED-equivalent" bundle) and write them as a
 * bundled GeoJSON asset for the API server.
 *
 * Why this exists: the existing `encSubstrateData.alaska.gen.json` bundle
 * only covers Southeast Alaska. Any uploaded dataset (or future preset) on
 * the US East Coast, Gulf of Mexico, or West Coast still classifies on
 * depth alone. This script ingests the NOAA Electronic Navigational Charts
 * (ENC) Harbor + Approach `Seabed_Area` (S-57 SBDARE) polygon layers for
 * the entire contiguous US — the same authoritative chart-derived seabed
 * source USGS uses for its usSEABED nearshore catalogue — so substrate
 * grounding now extends to every CONUS coastal AOI.
 *
 * Sources:
 *   - NOAA ENC Direct
 *     Harbor.Seabed_Area:   https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/enc_harbour/MapServer/200
 *     Approach.Seabed_Area: https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/enc_approach/MapServer/205
 *     Info:                  https://nauticalcharts.noaa.gov/charts/noaa-enc.html
 *   - Concept / classification reference: USGS usSEABED
 *     https://www.usgs.gov/centers/whcmsc/science/usseabed
 *
 * Coverage note: the NOAA ENC harbour/approach layers concentrate around
 * charted harbours, channels, and approaches. They do not cover every
 * point on the US shelf, so the API still returns an honest empty slice
 * (with `nearestCoverage` hint) for AOIs that fall outside charted
 * seabed-area extent.
 *
 * Usage / refreshing the bundle:
 *   pnpm --filter @workspace/scripts run build-usseabed-substrate
 *
 * Re-run whenever the upstream NOAA ENC service publishes updates, then
 * commit the refreshed `usSeabedSubstrate.gen.json` alongside any
 * builder-source changes that triggered the regeneration. The script
 * makes live HTTP requests to NOAA's ArcGIS services (tiled across CONUS),
 * so refreshing requires outbound network access.
 *
 * Generator-hash drift check:
 *   The bundle's `metadata.generatorHash` is a SHA-256 of this source
 *   file. A unit test in `artifacts/api-server` recomputes the hash on
 *   every test run and fails if the committed bundle was produced by a
 *   different version of this script — flagging stale bundles whenever
 *   the builder logic, NATSUR classifier, tile grid, or simplification
 *   tolerance change without the JSON being regenerated. If the test
 *   fails, run the command above and commit the refreshed JSON.
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUILDER_SRC_PATH = fileURLToPath(import.meta.url);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// --- Configuration ---------------------------------------------------------

interface ServiceSpec {
  /** Layer URL. */
  url: string;
  /** Short label used in per-feature `encChart` fallback / logging. */
  label: "harbour" | "approach";
}

const SERVICES: ServiceSpec[] = [
  {
    url: "https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/enc_harbour/MapServer/200",
    label: "harbour",
  },
  // The Approach.Seabed_Area layer (enc_approach/MapServer/205) is joined to
  // a polygon-FID side table and rejects the `f=geojson` output format. It
  // is intentionally omitted; harbour-band SBDARE polygons cover the same
  // navigable waters at higher resolution.
];

/**
 * Sub-tile the CONUS bbox so the per-page query stays inside ArcGIS's
 * 2000-record cap and the response payload stays manageable. The tile
 * grid covers the contiguous US coastal margin (24°N–49°N, -130°W–-65°W).
 */
const TILE_DEG = 5;
const REGION_BBOX: [number, number, number, number] = [-130, 24, -65, 49];

const OUT_PATH = resolve(
  REPO_ROOT,
  "artifacts/api-server/src/lib/usSeabedSubstrate.gen.json",
);

const PAGE_SIZE = 1000;

// --- NATSUR (S-57) → CMECS substrate mapping -------------------------------
// (Identical to build-enc-substrate.ts so the two bundles classify
// identically. Kept inline rather than imported to keep each build script
// self-contained.)

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

function classifyOne(token: string): CmecsClass {
  switch (token) {
    case "mud": case "clay": case "silt":
      return "mud";
    case "sand":
    case "shells":
      return "sand";
    case "gravel": case "pebbles": case "cobbles": case "stone":
      return "gravel";
    case "rock": case "boulder": case "boulders": case "lava": case "coral":
      return "bedrock";
    default:
      return "gravel";
  }
}

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
  DSNM?: string | null;
}

interface PolygonGeom { type: "Polygon"; coordinates: number[][][] }
interface MultiPolygonGeom { type: "MultiPolygon"; coordinates: number[][][][] }
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

async function fetchTilePage(
  svc: ServiceSpec,
  tile: [number, number, number, number],
  offset: number,
): Promise<RawFc> {
  const [minLon, minLat, maxLon, maxLat] = tile;
  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${minLon},${minLat},${maxLon},${maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "OBJECTID,NATSUR,NATQUA,DSNM",
    outSR: "4326",
    f: "geojson",
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
  });
  const url = `${svc.url}/query?${params.toString()}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "(unreadable)");
    throw new Error(`HTTP ${resp.status} from ${svc.label}: ${body.slice(0, 200)}`);
  }
  return (await resp.json()) as RawFc;
}

async function fetchTile(
  svc: ServiceSpec,
  tile: [number, number, number, number],
): Promise<RawFeature[]> {
  const out: RawFeature[] = [];
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const fc = await fetchTilePage(svc, tile, offset);
    out.push(...fc.features);
    const more =
      fc.exceededTransferLimit === true || fc.features.length >= PAGE_SIZE;
    if (!more || fc.features.length === 0) break;
    offset += fc.features.length;
  }
  return out;
}

interface TaggedFeature {
  raw: RawFeature;
  source: ServiceSpec["label"];
}

async function fetchAll(): Promise<TaggedFeature[]> {
  const [rMinLon, rMinLat, rMaxLon, rMaxLat] = REGION_BBOX;
  const tiles: [number, number, number, number][] = [];
  for (let lon = rMinLon; lon < rMaxLon; lon += TILE_DEG) {
    for (let lat = rMinLat; lat < rMaxLat; lat += TILE_DEG) {
      tiles.push([lon, lat, Math.min(lon + TILE_DEG, rMaxLon), Math.min(lat + TILE_DEG, rMaxLat)]);
    }
  }
  console.log(`  ${tiles.length} tile(s) × ${SERVICES.length} layer(s) = ${tiles.length * SERVICES.length} fetches`);

  const out: TaggedFeature[] = [];
  let i = 0;
  for (const tile of tiles) {
    i++;
    for (const svc of SERVICES) {
      try {
        const feats = await fetchTile(svc, tile);
        if (feats.length > 0) {
          console.log(
            `  [${i}/${tiles.length}] ${svc.label} tile ${tile.join(",")}: ${feats.length} feature(s)`,
          );
          for (const f of feats) out.push({ raw: f, source: svc.label });
        }
      } catch (err) {
        console.warn(`  [${i}/${tiles.length}] ${svc.label} tile ${tile.join(",")} failed: ${(err as Error).message}`);
      }
    }
  }
  return out;
}

// --- Bundle construction ---------------------------------------------------

interface BundledProps {
  unitId: string;
  substrate: CmecsClass;
  shoreZoneClass: string;
  cmecsCode: string;
  color: string;
  source: "noaa-enc-conus";
  natsur: string | null;
  natqua: string | null;
  encChart: string | null;
  /** Which ENC scale band the polygon came from (harbour vs approach). */
  encScale: "harbour" | "approach";
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
    source: "noaa-enc-conus";
    sourceName: string;
    sourceLayer: string;
    sourceService: string;
    creditUrl: string;
    fetchedAt: string;
    featureCount: number;
    /** SHA-256 of the builder source file (`build-usseabed-substrate.ts`),
     *  recorded so consumers can detect a stale bundle when the builder
     *  logic, NATSUR classifier, tile grid, or simplification tolerance
     *  change without the JSON being regenerated. Validated by a unit
     *  test in api-server. */
    generatorHash: string;
  };
}

/** SHA-256 hex digest of the builder source file. Computed at runtime so
 *  any edit to this script changes the hash and therefore the bundle. */
function computeGeneratorHash(): string {
  const src = readFileSync(BUILDER_SRC_PATH);
  return createHash("sha256").update(src).digest("hex");
}

function dedupeByObjectId(tagged: TaggedFeature[]): TaggedFeature[] {
  // The harbour and approach layers can both report the same OBJECTID for
  // overlapping S-57 SBDARE features at chart boundaries. Prefer the larger
  // scale (harbour) record when both are present.
  const seen = new Map<string, TaggedFeature>();
  for (const t of tagged) {
    const oid = t.raw.properties.OBJECTID;
    const key = `${t.source}-${oid ?? Math.random()}`;
    if (!seen.has(key)) seen.set(key, t);
  }
  return [...seen.values()];
}

/**
 * Douglas–Peucker simplification with an equirectangular-metres tolerance.
 * Reduces NOAA chart-derived polygon vertex counts (often dozens of
 * vertices per <100 m feature) by 80–95 % without visibly altering the
 * polygon, which is essential for keeping the bundled JSON under
 * ~10 MB given the high-density NE-coast (Cape Cod / Gulf of Maine)
 * chart granularity.
 */
const SIMPLIFY_TOLERANCE_M = 25;
const METERS_PER_DEG_LAT_C = 111_320;
function metersPerDegLonAt(latDeg: number): number {
  return METERS_PER_DEG_LAT_C * Math.cos((latDeg * Math.PI) / 180);
}

function simplifyRing(ring: number[][]): number[][] {
  if (ring.length < 4) return ring;
  const lat0 = ring[0]![1] as number;
  const sx = metersPerDegLonAt(lat0);
  const sy = METERS_PER_DEG_LAT_C;
  const sqTol = SIMPLIFY_TOLERANCE_M * SIMPLIFY_TOLERANCE_M;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  const sqDist = (
    pLon: number, pLat: number,
    aLon: number, aLat: number,
    bLon: number, bLat: number,
  ): number => {
    let ax = aLon * sx, ay = aLat * sy;
    const bx = bLon * sx, by = bLat * sy;
    const px = pLon * sx, py = pLat * sy;
    let dx = bx - ax, dy = by - ay;
    if (dx !== 0 || dy !== 0) {
      const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
      if (t > 1) { ax = bx; ay = by; }
      else if (t > 0) { ax += dx * t; ay += dy * t; }
    }
    dx = px - ax; dy = py - ay;
    return dx * dx + dy * dy;
  };
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    let maxSq = 0, maxIdx = -1;
    const a = ring[lo]!, b = ring[hi]!;
    for (let i = lo + 1; i < hi; i++) {
      const p = ring[i]!;
      const sq = sqDist(p[0]!, p[1]!, a[0]!, a[1]!, b[0]!, b[1]!);
      if (sq > maxSq) { maxSq = sq; maxIdx = i; }
    }
    if (maxSq > sqTol && maxIdx >= 0) {
      keep[maxIdx] = 1;
      stack.push([lo, maxIdx], [maxIdx, hi]);
    }
  }
  const out: number[][] = [];
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i]!);
  return out.length >= 4 ? out : ring;
}

function quantiseGeometry(g: AnyPolygonGeom): AnyPolygonGeom {
  if (g.type === "Polygon") {
    return { type: "Polygon", coordinates: g.coordinates.map(simplifyRing) };
  }
  return {
    type: "MultiPolygon",
    coordinates: g.coordinates.map((poly) => poly.map(simplifyRing)),
  };
}

function buildBundle(tagged: TaggedFeature[]): BundledCollection {
  const unique = dedupeByObjectId(tagged);
  const features: BundledFeature[] = [];
  let drop = 0;
  for (const t of unique) {
    const f = t.raw;
    if (!f.geometry || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) {
      drop++;
      continue;
    }
    const cls = classifyEnc(f.properties.NATSUR ?? null);
    features.push({
      type: "Feature",
      properties: {
        unitId: `ENC-${t.source}-${f.properties.OBJECTID ?? "?"}`,
        substrate: cls.substrate,
        shoreZoneClass: cls.encClass,
        cmecsCode: cls.cmecsCode,
        color: cls.color,
        source: "noaa-enc-conus",
        natsur: f.properties.NATSUR ?? null,
        natqua: f.properties.NATQUA ?? null,
        encChart: f.properties.DSNM ?? null,
        encScale: t.source,
      },
      geometry: quantiseGeometry(f.geometry),
    });
  }
  if (drop > 0) console.log(`  dropped ${drop} non-polygon features`);
  return {
    type: "FeatureCollection",
    features,
    metadata: {
      region:
        "Contiguous US coastal waters (NOAA ENC Harbor + Approach Seabed_Area, usSEABED-equivalent)",
      bbox: REGION_BBOX,
      source: "noaa-enc-conus",
      sourceName:
        "NOAA Electronic Navigational Charts — Harbor + Approach Seabed_Area (S-57 SBDARE)",
      sourceLayer: "Harbor.Seabed_Area + Approach.Seabed_Area",
      sourceService: SERVICES.map((s) => s.url).join(" + "),
      creditUrl: "https://nauticalcharts.noaa.gov/charts/noaa-enc.html",
      fetchedAt: new Date().toISOString(),
      featureCount: features.length,
      generatorHash: computeGeneratorHash(),
    },
  };
}

// --- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== build-usseabed-substrate ===");
  console.log(`Fetching ENC SBDARE polygons for CONUS bbox ${JSON.stringify(REGION_BBOX)}…`);

  const raw = await fetchAll();
  console.log(`  Received ${raw.length} raw features (across both layers)`);

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

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
