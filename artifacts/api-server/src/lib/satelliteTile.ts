import { promises as fsPromises } from "fs";
import path from "path";
import { createHash } from "crypto";
import { registerCache } from "./cacheRegistry.js";

/**
 * A cached satellite/aerial image tile for a given geographic bounding box.
 *
 * The image is sourced from the ESRI World Imagery MapServer export endpoint,
 * which is publicly accessible and requires no API key. The server proxies and
 * caches the result so repeated requests for the same region skip the upstream
 * round-trip.
 */

const SATELLITE_CACHE_DIR = "/tmp/satellite-tile-cache";

/** In-memory cache: key → PNG buffer */
const satelliteMemoryCache = new Map<string, Buffer>();
registerCache(() => satelliteMemoryCache.clear());

/**
 * ESRI World Imagery MapServer — publicly accessible, no API key required.
 * The `export` operation returns a geo-registered PNG for any EPSG:4326 bbox.
 */
const ESRI_IMAGERY_EXPORT =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export";

function satelliteCacheKey(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  size: number,
): string {
  const payload = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat},${size}`;
  return createHash("sha256").update(payload).digest("hex");
}

async function readSatelliteDiskCache(key: string): Promise<Buffer | null> {
  try {
    const file = path.join(SATELLITE_CACHE_DIR, `${key}.png`);
    return await fsPromises.readFile(file);
  } catch {
    return null;
  }
}

async function writeSatelliteDiskCache(key: string, data: Buffer): Promise<void> {
  try {
    await fsPromises.mkdir(SATELLITE_CACHE_DIR, { recursive: true });
    const file = path.join(SATELLITE_CACHE_DIR, `${key}.png`);
    await fsPromises.writeFile(file, data);
  } catch (err) {
    console.warn(
      `[satellite-tile] Failed to write disk cache for ${key}: ${(err as Error).message}`,
    );
  }
}

/**
 * Fetch a satellite imagery PNG from ESRI World Imagery for the given bbox.
 *
 * @param bbox    Geographic bounding box in EPSG:4326.
 * @param size    Output image width and height in pixels (square). Clamped to
 *                [64, 1024] by the caller.
 * @returns       A PNG `Buffer` ready to stream directly as `image/png`.
 *
 * Throws on network or upstream failure — the route handler catches this and
 * returns a 502 so the client can fall back to the procedural colour ramp.
 */
async function fetchSatelliteTileFromEsri(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  size: number,
): Promise<Buffer> {
  const { minLon, minLat, maxLon, maxLat } = bbox;

  const params = new URLSearchParams({
    bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
    bboxSR: "4326",
    size: `${size},${size}`,
    imageSR: "4326",
    format: "png",
    f: "image",
    transparent: "false",
  });

  const url = `${ESRI_IMAGERY_EXPORT}?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`ESRI imagery export returned HTTP ${resp.status}`);
    }
    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("image/")) {
      // ESRI returns JSON errors with content-type text/plain or application/json
      const body = await resp.text();
      throw new Error(
        `ESRI imagery export returned unexpected content-type "${contentType}": ${body.slice(0, 200)}`,
      );
    }
    const arrayBuf = await resp.arrayBuffer();
    return Buffer.from(arrayBuf);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Return a satellite imagery PNG buffer for the given bounding box and size.
 *
 * Results are cached in memory and on disk. Subsequent calls for the same
 * region and size are served from cache without an upstream round-trip.
 *
 * On any upstream failure the error propagates so the caller can 502 cleanly;
 * the client is expected to fall back to the procedural land colour ramp.
 */
export async function fetchSatelliteTile(
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  size: number,
): Promise<Buffer> {
  const key = satelliteCacheKey(bbox, size);

  const inMemory = satelliteMemoryCache.get(key);
  if (inMemory) return inMemory;

  const onDisk = await readSatelliteDiskCache(key);
  if (onDisk) {
    satelliteMemoryCache.set(key, onDisk);
    return onDisk;
  }

  console.info(
    `[satellite-tile] Fetching ESRI World Imagery for bbox (${bbox.minLon},${bbox.minLat})→(${bbox.maxLon},${bbox.maxLat}) at ${size}×${size}…`,
  );
  const data = await fetchSatelliteTileFromEsri(bbox, size);
  console.info(`[satellite-tile] Fetch complete — ${data.length} bytes`);

  satelliteMemoryCache.set(key, data);
  void writeSatelliteDiskCache(key, data);

  return data;
}
