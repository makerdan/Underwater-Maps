import { promises as fsPromises } from "fs";
import path from "path";
import { createHash } from "crypto";
import { PNG } from "pngjs";
import { registerCache } from "./cacheRegistry.js";
import { logger } from "./logger.js";

/**
 * A cached USGS hillshaded terrain tile for a given geographic bounding box.
 *
 * The image is sourced from the USGS National Map Shaded Relief MapServer
 * export endpoint, which is publicly accessible and requires no API key.
 * The server proxies and caches the result so repeated requests for the same
 * region skip the upstream round-trip.
 *
 * Antimeridian-crossing bounding boxes (minLon > maxLon, e.g. Bering Sea
 * datasets) are handled by splitting into a west half (minLon → 180) and an
 * east half (-180 → maxLon), fetching each at a proportional pixel width, and
 * compositing them side-by-side into a single PNG — identical logic to
 * satelliteTile.ts.
 */

const TERRAIN_CACHE_DIR = "/tmp/terrain-tile-cache";

/** In-memory cache: key → PNG buffer */
const terrainMemoryCache = new Map<string, Buffer>();
registerCache(() => terrainMemoryCache.clear());

/**
 * USGS National Map Shaded Relief — publicly accessible, no API key required.
 * The `export` operation returns a geo-registered PNG for any EPSG:4326 bbox.
 */
const USGS_TERRAIN_EXPORT =
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/export";

function terrainCacheKey(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  size: number,
): string {
  const payload = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat},${size}`;
  return createHash("sha256").update(payload).digest("hex");
}

async function readTerrainDiskCache(key: string): Promise<Buffer | null> {
  try {
    const file = path.join(TERRAIN_CACHE_DIR, `${key}.png`);
    return await fsPromises.readFile(file);
  } catch {
    return null;
  }
}

async function writeTerrainDiskCache(key: string, data: Buffer): Promise<void> {
  try {
    await fsPromises.mkdir(TERRAIN_CACHE_DIR, { recursive: true });
    const file = path.join(TERRAIN_CACHE_DIR, `${key}.png`);
    await fsPromises.writeFile(file, data);
  } catch (err) {
    logger.warn({ err, key }, `[terrain-tile] Failed to write disk cache for ${key}: ${(err as Error).message}`);
  }
}

/**
 * Fetch a USGS hillshaded terrain PNG for a simple (non-antimeridian-crossing)
 * bbox at the given pixel dimensions.
 *
 * @param bbox       Geographic bounding box in EPSG:4326 where minLon < maxLon.
 * @param pxWidth    Output image width in pixels.
 * @param pxHeight   Output image height in pixels.
 * @returns          A PNG `Buffer`.
 */
async function fetchTerrainTileFromUsgs(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  pxWidth: number,
  pxHeight: number,
): Promise<Buffer> {
  const { minLon, minLat, maxLon, maxLat } = bbox;

  const params = new URLSearchParams({
    bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
    bboxSR: "4326",
    size: `${pxWidth},${pxHeight}`,
    imageSR: "4326",
    format: "png",
    f: "image",
    transparent: "false",
  });

  const url = `${USGS_TERRAIN_EXPORT}?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`USGS terrain export returned HTTP ${resp.status}`);
    }
    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("image/")) {
      const body = await resp.text();
      throw new Error(
        `USGS terrain export returned unexpected content-type "${contentType}": ${body.slice(0, 200)}`,
      );
    }
    const arrayBuf = await resp.arrayBuffer();
    return Buffer.from(arrayBuf);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Decode a PNG buffer into a `pngjs` PNG object (with raw RGBA pixel data).
 */
function decodePng(buf: Buffer): Promise<PNG> {
  return new Promise((resolve, reject) => {
    const png = new PNG();
    png.parse(buf, (err, parsed) => {
      if (err) reject(err);
      else resolve(parsed);
    });
  });
}

/**
 * Encode a `pngjs` PNG object back to a Buffer synchronously.
 */
function encodePng(png: PNG): Buffer {
  return PNG.sync.write(png);
}

/**
 * Composite two PNG images (left, right) side-by-side into a single PNG.
 * Both images must have the same height. The output width = left.width + right.width.
 *
 * Pixel data is raw RGBA (4 bytes per pixel), row-major.
 */
async function compositeHorizontal(leftBuf: Buffer, rightBuf: Buffer): Promise<Buffer> {
  const [left, right] = await Promise.all([decodePng(leftBuf), decodePng(rightBuf)]);

  if (left.height !== right.height) {
    throw new Error(
      `[terrain-tile] Cannot composite PNGs with different heights (${left.height} vs ${right.height})`,
    );
  }

  const outWidth = left.width + right.width;
  const outHeight = left.height;
  const out = new PNG({ width: outWidth, height: outHeight });

  for (let row = 0; row < outHeight; row++) {
    const leftRowStart = row * left.width * 4;
    const rightRowStart = row * right.width * 4;
    const outRowStart = row * outWidth * 4;

    left.data.copy(out.data, outRowStart, leftRowStart, leftRowStart + left.width * 4);
    right.data.copy(
      out.data,
      outRowStart + left.width * 4,
      rightRowStart,
      rightRowStart + right.width * 4,
    );
  }

  return encodePng(out);
}

/**
 * Return a USGS hillshaded terrain PNG buffer for the given bounding box and size.
 *
 * Results are cached in memory and on disk. Subsequent calls for the same
 * region and size are served from cache without an upstream round-trip.
 *
 * **Antimeridian support**: if `minLon > maxLon` (e.g. a Bering Sea dataset
 * that straddles 180°/-180°), the bbox is split at the antimeridian into a
 * west half (minLon → 180) and an east half (-180 → maxLon). Each half is
 * fetched from USGS at a pixel width proportional to its longitude span, then
 * the two tiles are composited side-by-side into a single `size × size` PNG.
 *
 * On any upstream failure the error propagates so the caller can 502 cleanly.
 */
export async function fetchTerrainTile(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  size: number,
): Promise<Buffer> {
  const key = terrainCacheKey(bbox, size);

  const inMemory = terrainMemoryCache.get(key);
  if (inMemory) return inMemory;

  const onDisk = await readTerrainDiskCache(key);
  if (onDisk) {
    terrainMemoryCache.set(key, onDisk);
    return onDisk;
  }

  let data: Buffer;

  if (bbox.minLon > bbox.maxLon) {
    // ── Antimeridian-crossing bbox ────────────────────────────────────────────
    // Split at ±180° and composite the two halves.
    const westSpan = 180 - bbox.minLon;
    const eastSpan = bbox.maxLon - -180;
    const totalSpan = westSpan + eastSpan;

    // Clamp to [1, size-1] so both halves are at least 1 px wide and their
    // sum is exactly `size` (no rounding overshoot).
    const westPxWidth = Math.min(size - 1, Math.max(1, Math.round((westSpan / totalSpan) * size)));
    const eastPxWidth = size - westPxWidth;

    logger.info(
      { bbox, westPxWidth, eastPxWidth, size },
      `[terrain-tile] Antimeridian split: west (${bbox.minLon}→180, ${westPxWidth}px) + east (-180→${bbox.maxLon}, ${eastPxWidth}px) at ${size}px tall`,
    );

    const [westBuf, eastBuf] = await Promise.all([
      fetchTerrainTileFromUsgs(
        { minLon: bbox.minLon, minLat: bbox.minLat, maxLon: 180, maxLat: bbox.maxLat },
        westPxWidth,
        size,
      ),
      fetchTerrainTileFromUsgs(
        { minLon: -180, minLat: bbox.minLat, maxLon: bbox.maxLon, maxLat: bbox.maxLat },
        eastPxWidth,
        size,
      ),
    ]);

    data = await compositeHorizontal(westBuf, eastBuf);
    logger.info({ bytes: data.length }, `[terrain-tile] Antimeridian composite complete — ${data.length} bytes`);
  } else {
    // ── Normal (non-crossing) bbox ────────────────────────────────────────────
    logger.info(
      { bbox, size },
      `[terrain-tile] Fetching USGS Shaded Relief for bbox (${bbox.minLon},${bbox.minLat})→(${bbox.maxLon},${bbox.maxLat}) at ${size}×${size}…`,
    );
    data = await fetchTerrainTileFromUsgs(bbox, size, size);
    logger.info({ bytes: data.length }, `[terrain-tile] Fetch complete — ${data.length} bytes`);
  }

  terrainMemoryCache.set(key, data);
  void writeTerrainDiskCache(key, data);

  return data;
}
