export interface TerrainGrid {
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
}

export interface DatasetMeta {
  id: string;
  name: string;
  description: string;
  waterType: "saltwater" | "freshwater";
  minDepth: number;
  maxDepth: number;
  centerLon: number;
  centerLat: number;
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
}

// ---------------------------------------------------------------------------
// Preset dataset definitions
// ---------------------------------------------------------------------------

export const PRESET_DATASETS: DatasetMeta[] = [
  {
    id: "mariana-trench",
    name: "Mariana Trench",
    description: "Deepest oceanic trench on Earth — home of Challenger Deep at ~10,935 m",
    waterType: "saltwater",
    minDepth: 3200,
    maxDepth: 10935,
    centerLon: 142.2,
    centerLat: 11.35,
    bbox: { minLon: 141.0, minLat: 10.5, maxLon: 143.5, maxLat: 12.2 },
  },
  {
    id: "mid-atlantic-ridge",
    name: "Mid-Atlantic Ridge",
    description: "Divergent plate boundary with rift valley — active hydrothermal vents",
    waterType: "saltwater",
    minDepth: 1400,
    maxDepth: 4600,
    centerLon: -30.0,
    centerLat: 52.5,
    bbox: { minLon: -32.5, minLat: 51.0, maxLon: -27.5, maxLat: 54.0 },
  },
  {
    id: "mediterranean-basin",
    name: "Mediterranean Basin",
    description: "Semi-enclosed sea with heterogeneous bathymetry and ancient evaporite layers",
    waterType: "saltwater",
    minDepth: 10,
    maxDepth: 5267,
    centerLon: 18.5,
    centerLat: 35.5,
    bbox: { minLon: 15.0, minLat: 33.0, maxLon: 22.0, maxLat: 38.0 },
  },
  {
    id: "hawaii-seamount",
    name: "Hawaiian Ridge & Loihi",
    description: "Volcanic hotspot chain — Mauna Kea rises 10,210 m from the ocean floor",
    waterType: "saltwater",
    minDepth: 20,
    maxDepth: 5850,
    centerLon: -155.5,
    centerLat: 18.9,
    bbox: { minLon: -157.5, minLat: 17.5, maxLon: -153.5, maxLat: 20.3 },
  },
  {
    id: "arctic-basin",
    name: "Arctic Ocean Basin",
    description: "Lomonosov Ridge divides the Arctic into two deep basins, ice-covered year-round",
    waterType: "saltwater",
    minDepth: 50,
    maxDepth: 5450,
    centerLon: 0.0,
    centerLat: 87.5,
    bbox: { minLon: -30.0, minLat: 85.0, maxLon: 30.0, maxLat: 90.0 },
  },
  {
    id: "lake-baikal",
    name: "Lake Baikal",
    description: "World's deepest freshwater lake — contains 20% of Earth's unfrozen surface fresh water",
    waterType: "freshwater",
    minDepth: 5,
    maxDepth: 1642,
    centerLon: 108.0,
    centerLat: 53.5,
    bbox: { minLon: 103.0, minLat: 51.5, maxLon: 113.0, maxLat: 55.5 },
  },
];

// ---------------------------------------------------------------------------
// GEBCO WCS fetch
// ---------------------------------------------------------------------------

const GEBCO_WCS =
  "https://www.gebco.net/data_and_products/gebco_web_services/web_map_service/mapserv";

/**
 * Parse an ESRI Arc/Info ASCII Grid (AAIGRID) string.
 * Returns { ncols, nrows, nodata, values } where values is flat row-major array
 * of elevation values in metres (negative = below sea level).
 */
function parseAsciiGrid(text: string): {
  ncols: number;
  nrows: number;
  nodata: number;
  values: number[];
} {
  const lines = text.split(/\r?\n/);
  let ncols = 0;
  let nrows = 0;
  let nodata = -9999;
  let dataStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim().toLowerCase();
    if (!line) continue;
    if (line.startsWith("ncols")) {
      ncols = parseInt(line.split(/\s+/)[1]!, 10);
    } else if (line.startsWith("nrows")) {
      nrows = parseInt(line.split(/\s+/)[1]!, 10);
    } else if (line.startsWith("nodata_value") || line.startsWith("nodata")) {
      nodata = parseFloat(line.split(/\s+/)[1]!);
    } else if (!isNaN(parseFloat(line.split(/\s+/)[0]!))) {
      dataStart = i;
      break;
    }
  }

  const values: number[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const tokens = lines[i]!.trim().split(/\s+/);
    for (const tok of tokens) {
      if (tok) values.push(parseFloat(tok));
    }
  }

  return { ncols, nrows, nodata, values };
}

/**
 * Fetch real bathymetric data from GEBCO WCS for a given bounding box.
 * GEBCO elevation is negative for ocean depth; we convert to positive depth values.
 * Land cells (positive elevation) are replaced with 0.
 */
async function fetchGebcoGrid(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  resolution: number
): Promise<{ depths: number[]; minDepth: number; maxDepth: number }> {
  const { minLon, minLat, maxLon, maxLat } = bbox;
  const params = new URLSearchParams({
    service: "WCS",
    version: "1.0.0",
    request: "GetCoverage",
    coverage: "gebco_latest_2",
    crs: "EPSG:4326",
    bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
    format: "image/x-aaigrid",
    width: String(resolution),
    height: String(resolution),
  });

  const url = `${GEBCO_WCS}?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let text: string;
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`GEBCO WCS returned HTTP ${resp.status}`);
    text = await resp.text();
  } finally {
    clearTimeout(timeout);
  }

  const { ncols, nrows, nodata, values } = parseAsciiGrid(text);

  if (!ncols || !nrows || values.length === 0) {
    throw new Error("GEBCO WCS returned an empty or invalid grid");
  }

  // GEBCO uses row-major, top-to-bottom, left-to-right
  // Convert elevation (negative = ocean) to positive depth
  const depths: number[] = new Array(resolution * resolution).fill(0);
  let minDepth = Infinity;
  let maxDepth = -Infinity;

  for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      // Map our output grid indices to the raw grid indices
      const srcRow = Math.min(nrows - 1, Math.floor((row / resolution) * nrows));
      const srcCol = Math.min(ncols - 1, Math.floor((col / resolution) * ncols));
      const elev = values[srcRow * ncols + srcCol];

      let depth = 0;
      if (elev !== undefined && elev !== nodata && elev < 0) {
        depth = -elev; // positive depth below sea level
      }

      depths[row * resolution + col] = depth;
      if (depth < minDepth) minDepth = depth;
      if (depth > maxDepth) maxDepth = depth;
    }
  }

  if (!isFinite(minDepth)) minDepth = 0;
  if (!isFinite(maxDepth)) maxDepth = 0;

  return { depths, minDepth, maxDepth };
}

// ---------------------------------------------------------------------------
// Terrain cache & grid builder
// ---------------------------------------------------------------------------

const terrainCache = new Map<string, TerrainGrid>();

export async function buildTerrainGrid(
  datasetId: string,
  resolution = 128
): Promise<TerrainGrid | null> {
  const cacheKey = `${datasetId}:${resolution}`;
  const cached = terrainCache.get(cacheKey);
  if (cached) return cached;

  const meta = PRESET_DATASETS.find((d) => d.id === datasetId);
  if (!meta) return null;

  const N = Math.max(32, Math.min(512, resolution));

  let depths: number[];
  let minDepth: number;
  let maxDepth: number;

  try {
    const gebco = await fetchGebcoGrid(meta.bbox, N);
    depths = gebco.depths;
    minDepth = gebco.minDepth;
    maxDepth = gebco.maxDepth;
  } catch (err) {
    // Fallback to synthetic data if GEBCO is unreachable (dev / offline)
    console.warn(
      `[terrain] GEBCO WCS unavailable for ${datasetId}: ${(err as Error).message}. Using synthetic fallback.`
    );
    const synth = buildSyntheticGrid(datasetId, N, meta);
    depths = synth.depths;
    minDepth = synth.minDepth;
    maxDepth = synth.maxDepth;
  }

  const grid: TerrainGrid = {
    datasetId,
    name: meta.name,
    waterType: meta.waterType,
    resolution: N,
    width: N,
    height: N,
    depths,
    minDepth: Math.round(minDepth),
    maxDepth: Math.round(maxDepth),
    minLon: meta.bbox.minLon,
    maxLon: meta.bbox.maxLon,
    minLat: meta.bbox.minLat,
    maxLat: meta.bbox.maxLat,
    centerLon: meta.centerLon,
    centerLat: meta.centerLat,
  };

  terrainCache.set(cacheKey, grid);
  return grid;
}

// ---------------------------------------------------------------------------
// Synthetic fallback (value-noise, used when GEBCO WCS is unreachable)
// ---------------------------------------------------------------------------

function hash(n: number): number {
  const x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
}

function hash2(x: number, y: number): number {
  return hash(x * 127.1 + y * 311.7);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = smoothstep(fx);
  const uy = smoothstep(fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

function fbm(
  x: number,
  y: number,
  octaves: number,
  persistence: number,
  lacunarity: number
): number {
  let value = 0;
  let amplitude = 1.0;
  let frequency = 1.0;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxValue;
}

function buildSyntheticGrid(
  datasetId: string,
  N: number,
  meta: DatasetMeta
): { depths: number[]; minDepth: number; maxDepth: number } {
  const depthFns: Record<string, (nx: number, ny: number) => number> = {
    "mariana-trench": (nx, ny) => {
      const noise = fbm(nx * 8 + 10, ny * 8 + 10, 6, 0.5, 2.1);
      const trenchFactor = Math.pow(Math.max(0, 1 - Math.abs(ny - 0.5) * 3.5), 2.5);
      return 3200 + (10935 - 3200) * (trenchFactor * 0.78 + noise * 0.22);
    },
    "mid-atlantic-ridge": (nx, ny) => {
      const noise = fbm(nx * 6 + 20, ny * 6 + 20, 5, 0.55, 2.0);
      const ridgeFactor = Math.pow(Math.max(0, 1 - Math.abs(nx - 0.5) * 4), 1.8);
      const riftFactor = Math.pow(Math.max(0, 1 - Math.abs(nx - 0.5) * 12), 4);
      return Math.max(1400, 4600 - (4600 - 1400) * ridgeFactor * 0.8 + (3000 - 1400) * riftFactor * 0.3 + noise * 400 - 200);
    },
    "mediterranean-basin": (nx, ny) => {
      const noise = fbm(nx * 10 + 5, ny * 10 + 5, 5, 0.5, 2.0);
      const basins = 0.5 + 0.5 * Math.sin(nx * Math.PI * 3) * Math.sin(ny * Math.PI * 1.5);
      return 100 + (5267 - 100) * (basins * 0.6 + noise * 0.4);
    },
    "hawaii-seamount": (nx, ny) => {
      const noise = fbm(nx * 7 + 3, ny * 7 + 3, 6, 0.5, 2.1);
      const r = Math.sqrt((nx - 0.6) ** 2 + (ny - 0.4) ** 2);
      const seamount = Math.pow(Math.max(0, 1 - r * 2.5), 2.2);
      return Math.max(20, 5850 - (5850 - 20) * seamount * 0.85 + noise * 300 - 150);
    },
    "arctic-basin": (nx, ny) => {
      const noise = fbm(nx * 5 + 15, ny * 5 + 15, 5, 0.5, 2.1);
      const ridge = Math.pow(Math.max(0, 1 - Math.abs(nx - 0.45) * 5.5), 2.0);
      return 50 + ridge * 800 + (5450 - 50 - ridge * 800) * (ny * 0.65 + noise * 0.35);
    },
    "lake-baikal": (nx, ny) => {
      const noise = fbm(nx * 8 + 30, ny * 8 + 30, 5, 0.5, 2.0);
      const elongated = Math.pow(Math.max(0, 1 - Math.abs(nx - 0.5) * 3.0), 1.5);
      return 5 + (1642 - 5) * (elongated * 0.72 + noise * 0.28);
    },
  };

  const depthFn = depthFns[datasetId] ?? ((nx, ny) => {
    const noise = fbm(nx * 6 + 7, ny * 6 + 7, 5, 0.5, 2.0);
    return meta.minDepth + (meta.maxDepth - meta.minDepth) * noise;
  });

  const depths: number[] = new Array(N * N);
  let minDepth = Infinity;
  let maxDepth = -Infinity;

  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const d = depthFn(col / (N - 1), row / (N - 1));
      depths[row * N + col] = d;
      if (d < minDepth) minDepth = d;
      if (d > maxDepth) maxDepth = d;
    }
  }

  return { depths, minDepth, maxDepth };
}

// ---------------------------------------------------------------------------
// CSV / XYZ parser and gridder
// ---------------------------------------------------------------------------

interface RawPoint {
  lon: number;
  lat: number;
  depth: number;
}

export function parseXyzCsv(content: string, fileName: string): RawPoint[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  const isXyz = fileName.toLowerCase().endsWith(".xyz");
  const sep = isXyz ? /\s+/ : /[,\t\s]+/;

  let lonIdx = 0;
  let latIdx = 1;
  let depthIdx = 2;

  const first = lines[0]?.trim() ?? "";
  const firstNum = parseFloat(first.split(sep)[0] ?? "");
  const hasHeader = Number.isNaN(firstNum);
  const startLine = hasHeader ? 1 : 0;

  if (hasHeader) {
    const headers = first.toLowerCase().split(sep);
    lonIdx = Math.max(0, headers.findIndex((h) => h.includes("lon") || h === "x" || h === "long"));
    latIdx = Math.max(0, headers.findIndex((h) => h.includes("lat") || h === "y"));
    const dIdx = headers.findIndex(
      (h) => h.includes("dep") || h.includes("z") || h.includes("depth") || h.includes("elev")
    );
    depthIdx = dIdx >= 0 ? dIdx : 2;
  }

  const points: RawPoint[] = [];
  for (let i = startLine; i < lines.length; i++) {
    const parts = lines[i]!.trim().split(sep);
    const lon = parseFloat(parts[lonIdx] ?? "");
    const lat = parseFloat(parts[latIdx] ?? "");
    let z = parseFloat(parts[depthIdx] ?? "");
    if (Number.isNaN(lon) || Number.isNaN(lat) || Number.isNaN(z)) continue;
    if (z < 0) z = -z;
    points.push({ lon, lat, depth: z });
  }

  return points;
}

export function gridPoints(
  points: RawPoint[],
  resolution: number,
  datasetId: string,
  name: string
): TerrainGrid {
  const N = Math.max(32, Math.min(512, resolution));

  let minLon = Infinity,
    maxLon = -Infinity;
  let minLat = Infinity,
    maxLat = -Infinity;

  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }

  const lonRange = maxLon - minLon || 1;
  const latRange = maxLat - minLat || 1;

  const depths: number[] = new Array(N * N).fill(-1);
  const counts: number[] = new Array(N * N).fill(0);

  for (const p of points) {
    const col = Math.min(N - 1, Math.floor(((p.lon - minLon) / lonRange) * N));
    const row = Math.min(N - 1, Math.floor(((p.lat - minLat) / latRange) * N));
    const idx = row * N + col;
    if (depths[idx] === -1) {
      depths[idx] = p.depth;
    } else {
      depths[idx]! += p.depth;
    }
    counts[idx]!++;
  }

  let minDepth = Infinity;
  let maxDepth = -Infinity;

  for (let i = 0; i < N * N; i++) {
    if (counts[i]! > 0) {
      depths[i] = depths[i]! / counts[i]!;
    } else {
      depths[i] = 0;
    }
    if (depths[i]! < minDepth) minDepth = depths[i]!;
    if (depths[i]! > maxDepth) maxDepth = depths[i]!;
  }

  // 3×3 smoothing pass
  const smooth = new Array(N * N).fill(0);
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      let sum = 0,
        n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r2 = row + dr;
          const c2 = col + dc;
          if (r2 >= 0 && r2 < N && c2 >= 0 && c2 < N) {
            sum += depths[r2 * N + c2]!;
            n++;
          }
        }
      }
      smooth[row * N + col] = sum / n;
    }
  }

  return {
    datasetId,
    name,
    waterType: "saltwater",
    resolution: N,
    width: N,
    height: N,
    depths: smooth as number[],
    minDepth: Math.round(minDepth),
    maxDepth: Math.round(maxDepth),
    minLon,
    maxLon,
    minLat,
    maxLat,
    centerLon: (minLon + maxLon) / 2,
    centerLat: (minLat + maxLat) / 2,
  };
}
