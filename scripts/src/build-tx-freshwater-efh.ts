/**
 * build-tx-freshwater-efh.ts — Fetch real Texas Parks & Wildlife (TPWD) fish
 * habitat structure points and USGS NHD reservoir / river polygons for the
 * three Texas freshwater preset reservoirs, and write them as a bundled
 * GeoJSON asset for the API server.
 *
 * Replaces the hand-authored "approximate" rectangles in
 *   artifacts/api-server/src/lib/txFreshwaterEfhData.ts
 * with polygons that actually follow shoreline coves, creek channels, and
 * TPWD-deployed brushpile clusters.
 *
 * Sources:
 *   1) TPWD Inland Fisheries — Texas Fish Habitat Structures (FeatureServer)
 *      https://services1.arcgis.com/1mtXwieMId59thmg/arcgis/rest/services/
 *        Texas_Fish_Habitat_Structures_20221206/FeatureServer/1
 *      Item:    https://tpwd.maps.arcgis.com/home/item.html?id=e9e4d4de85ce4a379600ffc7978cc1c6
 *      Viewer:  https://experience.arcgis.com/experience/2bc3b75711b7496fac31455dddb0d060
 *      Used for brushpile / artificial-habitat point clusters.
 *
 *   2) USGS National Hydrography Dataset — Waterbody (large scale, layer 12)
 *      and Flowline (large scale, layer 6) MapServer at
 *      https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer
 *      Used for the real reservoir shoreline polygon and the principal
 *      river / creek-channel polylines (buffered to thin polygons).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run build-tx-freshwater-efh
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const OUT_PATH = resolve(
  REPO_ROOT,
  "artifacts/api-server/src/lib/txFreshwaterEfhData.gen.json",
);

const TPWD_SERVICE =
  "https://services1.arcgis.com/1mtXwieMId59thmg/arcgis/rest/services/Texas_Fish_Habitat_Structures_20221206/FeatureServer/1";
const TPWD_ITEM_URL =
  "https://tpwd.maps.arcgis.com/home/item.html?id=e9e4d4de85ce4a379600ffc7978cc1c6";
const TPWD_VIEWER_URL =
  "https://experience.arcgis.com/experience/2bc3b75711b7496fac31455dddb0d060";

const NHD_WATERBODY =
  "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12";
const NHD_FLOWLINE =
  "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6";

// ---------------------------------------------------------------------------
// Lake catalogue
// ---------------------------------------------------------------------------

interface LakeSpec {
  datasetId: string;
  region: string;
  bbox: [number, number, number, number];
  /** Waterbody name (Waterbody field in TPWD service). */
  tpwdWaterbody: string;
  /** NHD GNIS_NAME(s) for the main reservoir polygon — first match wins.
   *  Some reservoirs are mis-labelled in NHD (Lake Fork → "Case Lake"). */
  nhdLakeNames: string[];
  /** Optional fallback: pick the single largest NHD waterbody polygon
   *  inside the bbox if no GNIS_NAME match was found. */
  nhdLakeByLargestInBbox: boolean;
  /** Tributary GNIS names whose flowlines we keep as channels. */
  tributaryGnisNames: string[];
  /** TPWD lake info page (used as creditUrl). */
  lakePageUrl: string;
}

const LAKES: LakeSpec[] = [
  {
    datasetId: "lake-fork",
    region: "Lake Fork Reservoir — East Texas",
    bbox: [-95.65, 32.78, -95.42, 32.95],
    tpwdWaterbody: "Lake Fork",
    nhdLakeNames: ["Lake Fork Reservoir"],
    nhdLakeByLargestInBbox: true,
    tributaryGnisNames: [
      "Lake Fork Creek",
      "Big Caney Creek",
      "Little Caney Creek",
      "Coffee Creek",
      "Birch Creek",
    ],
    lakePageUrl: "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/fork/",
  },
  {
    datasetId: "sam-rayburn",
    region: "Sam Rayburn Reservoir — East Texas",
    bbox: [-94.30, 31.05, -93.95, 31.60],
    tpwdWaterbody: "Sam Rayburn",
    nhdLakeNames: ["Sam Rayburn Reservoir"],
    nhdLakeByLargestInBbox: true,
    tributaryGnisNames: [
      "Angelina River",
      "Attoyac Bayou",
      "Ayish Bayou",
    ],
    lakePageUrl:
      "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/samrayburn/",
  },
  {
    datasetId: "lake-ray-roberts",
    region: "Lake Ray Roberts — North Texas",
    bbox: [-97.15, 33.30, -96.92, 33.52],
    tpwdWaterbody: "Ray Roberts",
    nhdLakeNames: ["Lake Ray Roberts", "Ray Roberts Lake"],
    nhdLakeByLargestInBbox: true,
    tributaryGnisNames: [
      "Elm Fork Trinity River",
      "Isle du Bois Creek",
      "Range Creek",
      "Johnson Branch",
    ],
    lakePageUrl:
      "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/rayroberts/",
  },
  {
    datasetId: "toledo-bend",
    region: "Toledo Bend Reservoir — Texas / Louisiana",
    bbox: [-93.95, 31.15, -93.55, 32.20],
    tpwdWaterbody: "Toledo Bend",
    nhdLakeNames: ["Toledo Bend Reservoir"],
    nhdLakeByLargestInBbox: true,
    tributaryGnisNames: [
      "Sabine River",
      "Patroon Bayou",
      "Six Mile Creek",
      "Housen Bayou",
    ],
    lakePageUrl:
      "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/toledobend/",
  },
];

// ---------------------------------------------------------------------------
// Output schema (must match what txFreshwaterEfhData.ts expects)
// ---------------------------------------------------------------------------

interface BundledFeature {
  type: "Feature";
  properties: {
    species: string;
    commonName: string;
    fmp: string;
    depthRangeM: [number, number];
    habitatDescription: string;
    lifeStage?: string;
    season?: string;
    source: string;
    creditUrl: string;
    color: string;
    /** Provenance tag — which raw upstream layer this polygon came from. */
    sourceLayer:
      | "tpwd-fish-habitat-structures"
      | "nhd-waterbody"
      | "nhd-flowline";
  };
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}

interface BundledCollection {
  type: "FeatureCollection";
  features: BundledFeature[];
  metadata: {
    region: string;
    bbox: [number, number, number, number];
    creditUrl: string;
    lastUpdated: string;
    sources: string[];
  };
}

type BundledOut = Record<string, BundledCollection>;

// ---------------------------------------------------------------------------
// Geometry helpers (lon/lat, equirectangular at the lake's latitude)
// ---------------------------------------------------------------------------

const METERS_PER_DEG_LAT = 111_320;
function metersPerDegLon(latDeg: number): number {
  return METERS_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180);
}

interface XY { x: number; y: number }
function toLocal(lon: number, lat: number, originLat: number): XY {
  return {
    x: lon * metersPerDegLon(originLat),
    y: lat * METERS_PER_DEG_LAT,
  };
}
function toLonLat(xy: XY, originLat: number): [number, number] {
  return [
    xy.x / metersPerDegLon(originLat),
    xy.y / METERS_PER_DEG_LAT,
  ];
}

/** Andrew's monotone-chain convex hull in 2D. */
function convexHull(points: XY[]): XY[] {
  if (points.length < 3) return [...points];
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: XY, a: XY, b: XY): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: XY[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: XY[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Outward-buffer a polygon by `r` metres (Minkowski sum with disc).
 *  Approximated by widening each edge perpendicularly and inserting an arc
 *  of `arcSegments` segments at each vertex. */
function bufferPolygon(ring: XY[], r: number, arcSegments = 8): XY[] {
  if (ring.length === 0) return [];
  if (ring.length === 1) {
    // Just emit a circle around the single point.
    const out: XY[] = [];
    const p = ring[0]!;
    for (let k = 0; k < arcSegments * 4; k++) {
      const t = (k / (arcSegments * 4)) * 2 * Math.PI;
      out.push({ x: p.x + r * Math.cos(t), y: p.y + r * Math.sin(t) });
    }
    return out;
  }
  const n = ring.length;
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n]!;
    const curr = ring[i]!;
    const next = ring[(i + 1) % n]!;
    const inAngle = Math.atan2(curr.y - prev.y, curr.x - prev.x);
    const outAngle = Math.atan2(next.y - curr.y, next.x - curr.x);
    // Left-perpendicular = +90deg from edge direction = outward for CCW ring.
    const nIn = inAngle + Math.PI / 2;
    const nOut = outAngle + Math.PI / 2;
    let delta = nOut - nIn;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    if (delta >= 0) {
      // Convex corner — arc.
      for (let k = 0; k <= arcSegments; k++) {
        const t = nIn + (delta * k) / arcSegments;
        out.push({ x: curr.x + r * Math.cos(t), y: curr.y + r * Math.sin(t) });
      }
    } else {
      // Reflex corner — simple miter (good enough for thin polylines).
      const mid = nIn + delta / 2;
      const mlen = r / Math.max(0.2, Math.cos(delta / 2));
      out.push({ x: curr.x + mlen * Math.cos(mid), y: curr.y + mlen * Math.sin(mid) });
    }
  }
  return out;
}

/** Douglas–Peucker polyline simplification in local-metres coordinates. */
function simplifyLocal(points: XY[], toleranceMeters: number, closed = false): XY[] {
  if (points.length < 3) return [...points];
  const sqTol = toleranceMeters * toleranceMeters;
  const pts = closed && points.length > 1 ? [...points, points[0]!] : points;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const sqDistSeg = (p: XY, a: XY, b: XY): number => {
    let { x, y } = a;
    let dx = b.x - x;
    let dy = b.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b.x; y = b.y; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p.x - x; dy = p.y - y;
    return dx * dx + dy * dy;
  };
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    let maxSq = 0;
    let maxIdx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const sq = sqDistSeg(pts[i]!, pts[lo]!, pts[hi]!);
      if (sq > maxSq) { maxSq = sq; maxIdx = i; }
    }
    if (maxSq > sqTol && maxIdx >= 0) {
      keep[maxIdx] = 1;
      stack.push([lo, maxIdx], [maxIdx, hi]);
    }
  }
  const out: XY[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]!);
  if (closed) out.pop();
  return out;
}

function simplifyLonLatRing(
  ring: number[][],
  toleranceMeters: number,
  originLat: number,
): number[][] {
  const local = ring.map(([lo, la]) => toLocal(lo!, la!, originLat));
  const isClosed =
    ring.length > 1 &&
    ring[0]![0] === ring[ring.length - 1]![0] &&
    ring[0]![1] === ring[ring.length - 1]![1];
  const working = isClosed ? local.slice(0, -1) : local;
  const simplified = simplifyLocal(working, toleranceMeters, isClosed);
  const lonLat = simplified.map((xy) => toLonLat(xy, originLat));
  return isClosed ? closeRing(lonLat.map(([lo, la]) => [lo, la])) : lonLat.map(([lo, la]) => [lo, la]);
}

/** Sutherland–Hodgman polygon clip against an axis-aligned bbox. */
function clipRingToBbox(
  ring: number[][],
  bbox: [number, number, number, number],
): number[][] {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  // Open ring (drop duplicate closing vertex if present).
  let poly: number[][] =
    ring.length > 1 &&
    ring[0]![0] === ring[ring.length - 1]![0] &&
    ring[0]![1] === ring[ring.length - 1]![1]
      ? ring.slice(0, -1)
      : ring.slice();
  const clipEdge = (
    inside: (p: number[]) => boolean,
    intersect: (a: number[], b: number[]) => number[],
  ): void => {
    if (poly.length === 0) return;
    const out: number[][] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const aIn = inside(a);
      const bIn = inside(b);
      if (aIn) {
        out.push(a);
        if (!bIn) out.push(intersect(a, b));
      } else if (bIn) {
        out.push(intersect(a, b));
      }
    }
    poly = out;
  };
  clipEdge(
    (p) => p[0]! >= minLon,
    (a, b) => {
      const t = (minLon - a[0]!) / (b[0]! - a[0]!);
      return [minLon, a[1]! + t * (b[1]! - a[1]!)];
    },
  );
  clipEdge(
    (p) => p[0]! <= maxLon,
    (a, b) => {
      const t = (maxLon - a[0]!) / (b[0]! - a[0]!);
      return [maxLon, a[1]! + t * (b[1]! - a[1]!)];
    },
  );
  clipEdge(
    (p) => p[1]! >= minLat,
    (a, b) => {
      const t = (minLat - a[1]!) / (b[1]! - a[1]!);
      return [a[0]! + t * (b[0]! - a[0]!), minLat];
    },
  );
  clipEdge(
    (p) => p[1]! <= maxLat,
    (a, b) => {
      const t = (maxLat - a[1]!) / (b[1]! - a[1]!);
      return [a[0]! + t * (b[0]! - a[0]!), maxLat];
    },
  );
  if (poly.length < 3) return [];
  // Re-close.
  poly.push([poly[0]![0]!, poly[0]![1]!]);
  return poly;
}

/** Ensure a ring is closed (first === last). */
function closeRing(ring: number[][]): number[][] {
  if (ring.length === 0) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0]!, first[1]!]);
  return ring;
}

// ---------------------------------------------------------------------------
// Cluster TPWD points (single-link, max-link distance D)
// ---------------------------------------------------------------------------

interface AttractorPt {
  lon: number;
  lat: number;
  typeGeneral: string;
  typeDetail: string;
  site: string;
  installed: number | null;
}

function clusterPoints(pts: AttractorPt[], maxMeters: number, originLat: number): AttractorPt[][] {
  const n = pts.length;
  if (n === 0) return [];
  const xy = pts.map((p) => toLocal(p.lon, p.lat, originLat));
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i]! !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const r2 = maxMeters * maxMeters;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = xy[i]!.x - xy[j]!.x;
      const dy = xy[i]!.y - xy[j]!.y;
      if (dx * dx + dy * dy <= r2) union(i, j);
    }
  }
  const groups = new Map<number, AttractorPt[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = groups.get(r);
    if (!g) {
      g = [];
      groups.set(r, g);
    }
    g.push(pts[i]!);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// ArcGIS fetch helpers
// ---------------------------------------------------------------------------

async function arcgisQuery<T = unknown>(
  service: string,
  params: Record<string, string>,
): Promise<T> {
  const url = `${service}/query?${new URLSearchParams(params).toString()}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} from ${url.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

interface EsriPoint { x: number; y: number }
interface EsriPolygon { rings: number[][][] }
interface EsriPolyline { paths: number[][][] }
interface EsriFeature<G, A> { attributes: A; geometry: G }

async function fetchTpwdPoints(spec: LakeSpec): Promise<AttractorPt[]> {
  const fc = await arcgisQuery<{
    features: EsriFeature<EsriPoint, {
      Site: string; Type_General: string; Type_Detail: string;
      LatDD: number; LongDD: number; Waterbody: string; Installed: number | null;
    }>[];
  }>(TPWD_SERVICE, {
    where: `Waterbody='${spec.tpwdWaterbody}'`,
    outFields: "Site,Type_General,Type_Detail,LatDD,LongDD,Waterbody,Installed",
    outSR: "4326",
    returnGeometry: "true",
    f: "json",
  });
  return fc.features.map((f) => ({
    lon: f.geometry?.x ?? f.attributes.LongDD,
    lat: f.geometry?.y ?? f.attributes.LatDD,
    typeGeneral: f.attributes.Type_General ?? "",
    typeDetail: f.attributes.Type_Detail ?? "",
    site: f.attributes.Site ?? "",
    installed: f.attributes.Installed,
  }));
}

async function fetchNhdWaterbody(spec: LakeSpec): Promise<EsriPolygon | null> {
  // Try by GNIS_NAME first.
  for (const name of spec.nhdLakeNames) {
    const fc = await arcgisQuery<{
      features: EsriFeature<EsriPolygon, { AREASQKM: number; GNIS_NAME: string }>[];
    }>(NHD_WATERBODY, {
      where: `GNIS_NAME='${name}' AND FTYPE=390 AND AREASQKM>5`,
      outFields: "AREASQKM,GNIS_NAME",
      outSR: "4326",
      returnGeometry: "true",
      f: "json",
    });
    if (fc.features.length > 0) {
      const biggest = fc.features.reduce((a, b) =>
        a.attributes.AREASQKM > b.attributes.AREASQKM ? a : b);
      console.log(
        `    NHD waterbody via GNIS '${name}': ${biggest.attributes.AREASQKM.toFixed(1)} km²`,
      );
      return biggest.geometry;
    }
  }
  // Fallback: largest NHD waterbody intersecting bbox.
  if (spec.nhdLakeByLargestInBbox) {
    const [minLon, minLat, maxLon, maxLat] = spec.bbox;
    const fc = await arcgisQuery<{
      features: EsriFeature<EsriPolygon, { AREASQKM: number; GNIS_NAME: string }>[];
    }>(NHD_WATERBODY, {
      geometry: `${minLon},${minLat},${maxLon},${maxLat}`,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      where: "FTYPE=390 AND AREASQKM>10",
      outFields: "AREASQKM,GNIS_NAME",
      outSR: "4326",
      returnGeometry: "true",
      f: "json",
    });
    if (fc.features.length > 0) {
      const biggest = fc.features.reduce((a, b) =>
        a.attributes.AREASQKM > b.attributes.AREASQKM ? a : b);
      console.log(
        `    NHD waterbody fallback (largest in bbox): GNIS '${biggest.attributes.GNIS_NAME ?? "(none)"}' ${biggest.attributes.AREASQKM.toFixed(1)} km²`,
      );
      return biggest.geometry;
    }
  }
  return null;
}

async function fetchNhdFlowlines(spec: LakeSpec): Promise<{ name: string; paths: number[][][] }[]> {
  const out: { name: string; paths: number[][][] }[] = [];
  for (const name of spec.tributaryGnisNames) {
    const [minLon, minLat, maxLon, maxLat] = spec.bbox;
    const fc = await arcgisQuery<{
      features: EsriFeature<EsriPolyline, { GNIS_NAME: string; LENGTHKM: number }>[];
    }>(NHD_FLOWLINE, {
      geometry: `${minLon},${minLat},${maxLon},${maxLat}`,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      where: `GNIS_NAME='${name}'`,
      outFields: "GNIS_NAME,LENGTHKM",
      outSR: "4326",
      returnGeometry: "true",
      f: "json",
    });
    if (fc.features.length === 0) continue;
    const paths = fc.features.flatMap((f) => f.geometry?.paths ?? []);
    if (paths.length > 0) {
      console.log(`    NHD flowline '${name}': ${paths.length} segment(s)`);
      out.push({ name, paths });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-lake feature templates (species / FMP / depth / colour metadata).
// The geometries come from real upstream data; only the labelling metadata
// is curated per-lake to stay consistent with the previous bundle.
// ---------------------------------------------------------------------------

interface SpeciesTemplate {
  species: string;
  commonName: string;
  fmp: string;
  depthRangeM: [number, number];
  habitatDescription: string;
  lifeStage?: string;
  season?: string;
  color: string;
}

interface LakeTemplates {
  shoreline: SpeciesTemplate;
  channel: SpeciesTemplate;
  brushpile: SpeciesTemplate;
}

const TEMPLATES: Record<string, LakeTemplates> = {
  "lake-fork": {
    shoreline: {
      species: "micropterus_salmoides",
      commonName: "Largemouth Bass (spawning flats)",
      fmp: "TPWD Priority Spawning Habitat",
      depthRangeM: [1, 4],
      habitatDescription:
        "Shallow standing-timber flats and shoreline coves on Lake Fork hold the trophy " +
        "Florida-strain largemouth spawn from late February through April.",
      lifeStage: "Adults (spawning)",
      season: "Late Feb–Apr",
      color: "#22c55e",
    },
    channel: {
      species: "ictalurus_punctatus",
      commonName: "Channel Catfish (creek channels)",
      fmp: "TPWD Priority Habitat",
      depthRangeM: [4, 12],
      habitatDescription:
        "Old creek channels and the inundated Sabine-headwater bed are the primary channel-catfish habitat in Lake Fork.",
      lifeStage: "Adults",
      season: "Year-round",
      color: "#0ea5e9",
    },
    brushpile: {
      species: "pomoxis_nigromaculatus",
      commonName: "Black Crappie (brushpiles)",
      fmp: "TPWD Priority Habitat",
      depthRangeM: [3, 9],
      habitatDescription:
        "TPWD-deployed PVC cubes, artificial habitat, and natural brush clusters in Lake Fork hold crappie year-round.",
      lifeStage: "All life stages",
      season: "Year-round; peak Mar–Apr & Oct–Nov",
      color: "#a855f7",
    },
  },
  "sam-rayburn": {
    shoreline: {
      species: "micropterus_salmoides",
      commonName: "Largemouth Bass (spawning flats)",
      fmp: "TPWD Priority Spawning Habitat",
      depthRangeM: [1, 5],
      habitatDescription:
        "Hydrilla mats on the broad northern flats of Sam Rayburn host nationally renowned largemouth spawning.",
      lifeStage: "Adults (spawning)",
      season: "Mar–May",
      color: "#22c55e",
    },
    channel: {
      species: "ictalurus_furcatus",
      commonName: "Blue Catfish (river channels)",
      fmp: "TPWD Priority Habitat",
      depthRangeM: [5, 18],
      habitatDescription:
        "The submerged Angelina River channel through Sam Rayburn is the principal blue catfish corridor.",
      lifeStage: "Adults",
      season: "Year-round",
      color: "#0ea5e9",
    },
    brushpile: {
      species: "pomoxis_annularis",
      commonName: "White Crappie (brushpiles)",
      fmp: "TPWD Priority Habitat",
      depthRangeM: [3, 10],
      habitatDescription:
        "TPWD-deployed PVC cubes and natural brush clusters on Sam Rayburn's main lake hold prolific crappie populations.",
      lifeStage: "All life stages",
      season: "Year-round; peak spring & fall",
      color: "#a855f7",
    },
  },
  "lake-ray-roberts": {
    shoreline: {
      species: "micropterus_salmoides",
      commonName: "Largemouth Bass (spawning flats)",
      fmp: "TPWD Priority Spawning Habitat",
      depthRangeM: [1, 5],
      habitatDescription:
        "Shallow vegetated coves and standing-timber flats in the Isle du Bois and Johnson Branch arms of Lake Ray Roberts host the largemouth spawn from late February through May.",
      lifeStage: "Adults (spawning)",
      season: "Late Feb–May",
      color: "#22c55e",
    },
    channel: {
      species: "ictalurus_furcatus",
      commonName: "Channel & Blue Catfish (creek channels)",
      fmp: "TPWD Priority Habitat",
      depthRangeM: [4, 15],
      habitatDescription:
        "The submerged Elm Fork Trinity River channel and feeder-creek mouths are the dominant channel and blue catfish habitat in Lake Ray Roberts.",
      lifeStage: "Adults",
      season: "Year-round",
      color: "#0ea5e9",
    },
    brushpile: {
      species: "pomoxis_annularis",
      commonName: "White & Black Crappie (brushpiles)",
      fmp: "TPWD Priority Habitat",
      depthRangeM: [3, 9],
      habitatDescription:
        "TPWD-deployed PVC cubes, artificial habitat, and natural brush clusters across Lake Ray Roberts hold white and black crappie year-round.",
      lifeStage: "All life stages",
      season: "Year-round; peak Mar–Apr & Oct–Nov",
      color: "#a855f7",
    },
  },
  "toledo-bend": {
    shoreline: {
      species: "micropterus_salmoides",
      commonName: "Largemouth Bass (spawning flats)",
      fmp: "TPWD Priority Spawning Habitat",
      depthRangeM: [1, 5],
      habitatDescription:
        "Shallow vegetated shoreline pockets and timber-covered flats throughout Toledo Bend support a Top-10 nationally ranked largemouth fishery.",
      lifeStage: "Adults (spawning)",
      season: "Feb–May",
      color: "#22c55e",
    },
    channel: {
      species: "ictalurus_punctatus",
      commonName: "Channel Catfish (creek channels)",
      fmp: "TPWD Priority Habitat",
      depthRangeM: [4, 14],
      habitatDescription:
        "The submerged Sabine River channel and feeder-creek mouths are the dominant catfish habitat in Toledo Bend.",
      lifeStage: "Adults",
      season: "Year-round",
      color: "#0ea5e9",
    },
    brushpile: {
      species: "pomoxis_nigromaculatus",
      commonName: "Black Crappie (brushpiles)",
      fmp: "TPWD Priority Habitat",
      depthRangeM: [3, 10],
      habitatDescription:
        "TPWD-deployed PVC cubes and natural brush clusters in Toledo Bend's mid-lake creeks hold black and white crappie year-round.",
      lifeStage: "All life stages",
      season: "Year-round",
      color: "#a855f7",
    },
  },
};

const TPWD_SOURCE = "TPWD — Texas Parks & Wildlife Fish Habitat Structures";
const NHD_SOURCE = "USGS National Hydrography Dataset (NHD)";

// ---------------------------------------------------------------------------
// Geometry conversions Esri → GeoJSON
// ---------------------------------------------------------------------------

/** Esri rings can be a mix of outer + holes; classify by winding (clockwise =
 *  outer in Esri convention) and emit a GeoJSON MultiPolygon. */
function esriRingsToMultiPolygon(rings: number[][][]): number[][][][] {
  // Determine signed area to detect outer vs hole; collect outers + group
  // holes (we just attach all holes to the first outer for simplicity since
  // the consumer treats them as display polygons, not as topology).
  const outers: number[][][][] = [];
  const holes: number[][][] = [];
  for (const ring of rings) {
    if (ring.length < 4) continue;
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]!;
      const b = ring[i + 1]!;
      area += (a[0]! * b[1]!) - (b[0]! * a[1]!);
    }
    // Esri convention: clockwise = outer (negative signed area in screen coords,
    // which equals positive in GeoJSON's CCW-positive convention).
    const isOuter = area < 0;
    if (isOuter) outers.push([ring]);
    else holes.push(ring);
  }
  if (outers.length > 0 && holes.length > 0) {
    outers[0]!.push(...holes);
  }
  return outers;
}

function flowlineToBufferedPolygon(
  paths: number[][][],
  bufferMeters: number,
  originLat: number,
  simplifyToleranceMeters = 40,
): { type: "MultiPolygon"; coordinates: number[][][][] } {
  const polys: number[][][][] = [];
  for (const path of paths) {
    if (path.length < 2) continue;
    const rawLocal = path.map(([lon, lat]) => toLocal(lon!, lat!, originLat));
    const local = simplifyLocal(rawLocal, simplifyToleranceMeters, false);
    if (local.length < 2) continue;
    // Build a closed ring around the polyline by buffering both sides.
    const forward: XY[] = [];
    const backward: XY[] = [];
    for (let i = 0; i < local.length; i++) {
      const prev = local[Math.max(0, i - 1)]!;
      const next = local[Math.min(local.length - 1, i + 1)]!;
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const c = local[i]!;
      forward.push({ x: c.x + nx * bufferMeters, y: c.y + ny * bufferMeters });
      backward.push({ x: c.x - nx * bufferMeters, y: c.y - ny * bufferMeters });
    }
    const ring = [...forward, ...backward.reverse()];
    const lonLatRing = ring.map((xy) => toLonLat(xy, originLat));
    polys.push([closeRing(lonLatRing.map(([lo, la]) => [lo, la]))]);
  }
  return { type: "MultiPolygon", coordinates: polys };
}

function clusterToPolygon(
  cluster: AttractorPt[],
  bufferMeters: number,
  originLat: number,
): { type: "Polygon"; coordinates: number[][][] } {
  const local = cluster.map((p) => toLocal(p.lon, p.lat, originLat));
  let ring: XY[];
  if (local.length === 1) {
    ring = bufferPolygon([local[0]!], bufferMeters);
  } else if (local.length === 2) {
    // Convex hull degenerates; build a capsule around the segment.
    ring = bufferPolygon(local, bufferMeters);
  } else {
    const hull = convexHull(local);
    ring = bufferPolygon(hull, bufferMeters);
  }
  const lonLat = ring.map((xy) => toLonLat(xy, originLat));
  return { type: "Polygon", coordinates: [closeRing(lonLat.map(([lo, la]) => [lo, la]))] };
}

// ---------------------------------------------------------------------------
// Main per-lake builder
// ---------------------------------------------------------------------------

async function buildLake(spec: LakeSpec): Promise<BundledCollection> {
  console.log(`\n--- ${spec.datasetId} (${spec.tpwdWaterbody}) ---`);
  const tmpl = TEMPLATES[spec.datasetId]!;
  const originLat = (spec.bbox[1] + spec.bbox[3]) / 2;
  const features: BundledFeature[] = [];

  // 1) Shoreline polygon (NHD waterbody → spawning-flats feature).
  const waterbody = await fetchNhdWaterbody(spec);
  if (waterbody && waterbody.rings.length > 0) {
    const multi = esriRingsToMultiPolygon(waterbody.rings);
    // Simplify each ring (75m tolerance keeps coves but cuts file size 200x),
    // then clip to the dataset's preset bbox so features stay within the AOI.
    const simplified: number[][][][] = multi.map((poly) =>
      poly
        .map((ring) => simplifyLonLatRing(ring, 75, originLat))
        .map((ring) => clipRingToBbox(ring, spec.bbox))
        .filter((ring) => ring.length >= 4),
    ).filter((poly) => poly.length > 0);
    if (simplified.length > 0) {
      features.push({
        type: "Feature",
        properties: {
          ...tmpl.shoreline,
          source: NHD_SOURCE,
          creditUrl: "https://www.usgs.gov/national-hydrography/national-hydrography-dataset",
          sourceLayer: "nhd-waterbody",
        },
        geometry: { type: "MultiPolygon", coordinates: simplified },
      });
    }
  } else {
    console.warn(`    !! no NHD waterbody polygon for ${spec.datasetId}`);
  }

  // 2) Creek-channel polylines (NHD flowlines → buffered polygon).
  const flowlines = await fetchNhdFlowlines(spec);
  if (flowlines.length > 0) {
    const allPaths = flowlines.flatMap((f) => f.paths);
    const buffered = flowlineToBufferedPolygon(allPaths, 80, originLat);
    // Clip each polygon ring to the dataset bbox.
    buffered.coordinates = buffered.coordinates
      .map((poly) =>
        poly
          .map((ring) => clipRingToBbox(ring, spec.bbox))
          .filter((ring) => ring.length >= 4),
      )
      .filter((poly) => poly.length > 0);
    if (buffered.coordinates.length > 0) {
      const names = flowlines.map((f) => f.name).join(", ");
      features.push({
        type: "Feature",
        properties: {
          ...tmpl.channel,
          habitatDescription:
            `${tmpl.channel.habitatDescription} (Mapped tributary channels: ${names}.)`,
          source: NHD_SOURCE,
          creditUrl: "https://www.usgs.gov/national-hydrography/national-hydrography-dataset",
          sourceLayer: "nhd-flowline",
        },
        geometry: buffered,
      });
    }
  } else {
    console.warn(`    !! no NHD flowlines for ${spec.datasetId}`);
  }

  // 3) TPWD brushpile / attractor clusters → one polygon per cluster.
  const points = await fetchTpwdPoints(spec);
  console.log(`    TPWD attractors: ${points.length}`);
  const clusters = clusterPoints(points, 1500, originLat);
  console.log(`    -> ${clusters.length} cluster(s)`);
  for (const cluster of clusters) {
    const geom = clusterToPolygon(cluster, 120, originLat);
    const clipped = clipRingToBbox(geom.coordinates[0]!, spec.bbox);
    if (clipped.length < 4) continue;
    geom.coordinates = [clipped];
    const detail = Array.from(new Set(cluster.map((c) => c.typeDetail).filter(Boolean))).join(" / ");
    const sites = cluster.map((c) => c.site).filter(Boolean).join(", ");
    const installedYears = Array.from(new Set(cluster.map((c) => c.installed).filter(
      (y): y is number => typeof y === "number" && y > 0,
    ))).sort();
    features.push({
      type: "Feature",
      properties: {
        ...tmpl.brushpile,
        habitatDescription:
          `${tmpl.brushpile.habitatDescription} (TPWD site${cluster.length > 1 ? "s" : ""} ${sites || "(unnumbered)"}: ${detail || "fish attractor"}${installedYears.length ? `; installed ${installedYears.join("/")}` : ""}.)`,
        source: TPWD_SOURCE,
        creditUrl: TPWD_ITEM_URL,
        sourceLayer: "tpwd-fish-habitat-structures",
      },
      geometry: geom,
    });
  }

  return {
    type: "FeatureCollection",
    features,
    metadata: {
      region: spec.region,
      bbox: spec.bbox,
      creditUrl: spec.lakePageUrl,
      lastUpdated: new Date().toISOString().slice(0, 10),
      sources: [
        `${TPWD_SOURCE} — ${TPWD_VIEWER_URL}`,
        `${NHD_SOURCE} — https://www.usgs.gov/national-hydrography/national-hydrography-dataset`,
      ],
    },
  };
}

async function main(): Promise<void> {
  console.log("=== build-tx-freshwater-efh ===");
  const out: BundledOut = {};
  for (const spec of LAKES) {
    out[spec.datasetId] = await buildLake(spec);
  }
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT_PATH}`);
  for (const [id, c] of Object.entries(out)) {
    console.log(`  ${id}: ${c.features.length} feature(s)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
