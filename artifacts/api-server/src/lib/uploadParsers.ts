/**
 * uploadParsers.ts — Server-side parsers for bathymetric file formats.
 *
 * Each parser accepts raw bytes (Buffer) or decoded text and returns an array
 * of { lon, lat, depth } points that the existing gridPoints() function can
 * consume.  All parsers normalise depth to a positive-downward value.
 *
 * Supported formats:
 *   GeoTIFF  (.tif / .tiff)  — raster grid, geo-transform derived lon/lat
 *   NetCDF   (.nc)           — gridded dataset, common depth/elevation aliases
 *   LAS 1.x  (.las)          — point-cloud binary, header-derived scale+offset
 *   LAZ      (.laz)          — compressed LAS; requires laz-perf WASM
 *   BAG      (.bag)          — HDF5 survey archive; requires h5wasm WASM
 *   GPX      (.gpx)          — track points with <ele> depth log (server-side)
 *   NMEA     (.nmea)         — depth-sounder + position sentence log
 */

import { fromArrayBuffer } from "geotiff";
import { NetCDFReader } from "netcdfjs";
import { createLazPerf } from "laz-perf";
import { ready as h5wasmReady, File as H5wFile, Group as H5Group, Dataset as H5Dataset } from "h5wasm";

// ---------------------------------------------------------------------------
// Shared type (mirrors terrain.ts RawPoint — re-exported to avoid circular dep)
// ---------------------------------------------------------------------------

export interface RawPoint {
  lon: number;
  lat: number;
  depth: number;
}

// ---------------------------------------------------------------------------
// Point cap — protects the event loop from OOM on large raster files.
// Raster parsers (GeoTIFF, NetCDF) sub-sample when the pixel count exceeds
// this limit, emitting at most RASTER_POINT_CAP points. LAS/LAZ apply a
// simple truncation cap directly on the point-count field before the loop.
// ---------------------------------------------------------------------------
export const RASTER_POINT_CAP = 2_000_000;

/**
 * Yield the event loop so pending I/O callbacks are not starved by long
 * synchronous raster-scan loops.  setImmediate fires after the current I/O
 * poll phase, giving the Node.js HTTP layer a chance to flush responses and
 * accept new connections before the next batch of pixels is processed.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** How many sampled pixels to process between event-loop yields in parseGeoTiff. */
const GEOTIFF_YIELD_BATCH = 200_000;

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

/**
 * Route an uploaded file buffer to the correct format parser based on file
 * extension.  Returns an array of { lon, lat, depth } points.
 *
 * Existing CSV/XYZ/TXT path is NOT handled here — the caller (datasets.ts)
 * continues to use parseXyzCsv for those extensions. This dispatcher only
 * covers the new binary/structured formats.
 */
export async function parseUploadedFile(
  buffer: Buffer,
  fileName: string,
): Promise<RawPoint[]> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";

  switch (ext) {
    case "tif":
    case "tiff":
      return parseGeoTiff(buffer);
    case "nc":
      return parseNetCdf(buffer);
    case "las":
      return parseLasLaz(buffer, fileName);
    case "laz":
      return parseLasLaz(buffer, fileName);
    case "bag":
      return parseBag(buffer);
    case "gpx":
      return parseGpxTerrain(buffer.toString("utf8"));
    case "nmea":
      return parseNmea(buffer.toString("utf8"));
    default:
      throw new Error(
        `Unsupported file extension ".${ext}". Supported formats: ` +
          `.tif, .tiff, .bag, .las, .laz, .nc, .gpx, .nmea, .csv, .xyz, .txt`,
      );
  }
}

// ---------------------------------------------------------------------------
// GeoTIFF
// ---------------------------------------------------------------------------

/**
 * Parse a GeoTIFF raster into lon/lat/depth points.
 *
 * Reads the first image's first band as elevation/depth data and derives
 * geographic coordinates from the raster's geo-transform stored in the
 * ModelTiepoint and ModelPixelScale tags (or ModelTransformation if present).
 * Negative elevation values (positive-up seafloor) are flipped to positive
 * depth.  No-data pixels (NaN, ±Infinity, or matching the TIFFTAG_GDAL_NODATA
 * value) are skipped.
 */
export async function parseGeoTiff(
  buffer: Buffer,
  { pointCap = RASTER_POINT_CAP }: { pointCap?: number } = {},
): Promise<RawPoint[]> {
  let tiff;
  try {
    tiff = await fromArrayBuffer(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer,
    );
  } catch (err) {
    throw new Error(
      `Failed to open GeoTIFF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const image = await tiff.getImage();

  // geotiff v3 uses a lazy ImageFileDirectory class with a getValue(tagName)
  // method rather than plain property access. Direct fd["tagName"] is always
  // undefined in v3.  We use getValue() for all tag reads and fall back to
  // plain property access so older versions continue to work.
  type IFD = { getValue?: (tag: string) => unknown } & Record<string, unknown>;
  const fd = image.fileDirectory as unknown as IFD;
  const getTag = (tag: string): unknown =>
    typeof fd.getValue === "function" ? fd.getValue(tag) : fd[tag];

  // Derive geo-transform: origin (lon0, lat0) + pixel size (dLon, dLat)
  // Prefer ModelTransformation (4×4) over ModelTiepoint+ModelPixelScale.
  let lon0 = 0,
    lat0 = 0,
    dLon = 1,
    dLat = -1;

  const pixelScale = getTag("ModelPixelScale") as ArrayLike<number> | undefined;
  const tiepoint = getTag("ModelTiepoint") as ArrayLike<number> | undefined;
  const transformation = getTag("ModelTransformation") as ArrayLike<number> | undefined;

  if (transformation && transformation.length >= 8) {
    // Affine: [sx, 0, tx, 0, sy, ty] — elements [0],[1],[3] of 4x4 row-major
    lon0 = transformation[3]!;
    lat0 = transformation[7]!;
    dLon = transformation[0]!;
    dLat = transformation[5]!;
  } else if (pixelScale && tiepoint && pixelScale.length >= 2 && tiepoint.length >= 6) {
    // pixelScale = [scaleX, scaleY, scaleZ]
    // tiepoint   = [I, J, K, X, Y, Z] — pixel → world mapping
    const [scaleX, scaleY] = [pixelScale[0]!, pixelScale[1]!];
    const [I, J, , X, Y] = [tiepoint[0]!, tiepoint[1]!, tiepoint[2], tiepoint[3]!, tiepoint[4]!];
    lon0 = X - I * scaleX;
    lat0 = Y + J * scaleY; // Y is positive-up, pixel rows are top-down
    dLon = scaleX;
    dLat = -scaleY;
  } else {
    throw new Error(
      "GeoTIFF has no ModelPixelScale/ModelTiepoint or ModelTransformation tag. " +
        "Cannot derive geographic coordinates. Re-export the file with spatial reference information.",
    );
  }

  // GDAL no-data value (stored as string in TIFFTAG_GDAL_NODATA in the TIFF spec,
  // but returned as a number by geotiff v3's getValue(). Handle both.
  const nodataRaw = getTag("GDAL_NODATA");
  const nodata =
    nodataRaw !== undefined && nodataRaw !== null
      ? typeof nodataRaw === "number"
        ? nodataRaw
        : parseFloat(String(nodataRaw))
      : NaN;

  const width = image.getWidth();
  const height = image.getHeight();

  let raster: number[] | Float32Array | Float64Array | Int16Array | Int32Array;
  try {
    const raw = await image.readRasters({ interleave: true });
    raster = (Array.isArray(raw) ? raw[0] : raw) as typeof raster;
  } catch (err) {
    throw new Error(
      `Failed to read GeoTIFF raster: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Sub-sample large rasters so we never emit more than pointCap points.
  // stride ≥ 2 when totalPixels exceeds the cap; stride = 1 otherwise.
  // Iterating `flat += stride` is O(totalPixels / stride) — not O(totalPixels)
  // — so large rasters skip the unvisited pixels entirely rather than touching
  // every index and continuing.  Periodic setImmediate yields inside the loop
  // keep the server responsive to HTTP keep-alives and new connections even
  // when the sampled set is itself large.
  const totalPixels = width * height;
  const stride = totalPixels > pointCap ? Math.ceil(totalPixels / pointCap) : 1;

  const points: RawPoint[] = [];
  let iterCount = 0;
  for (let flat = 0; flat < totalPixels; flat += stride) {
    if (points.length >= pointCap) break;

    // Yield every GEOTIFF_YIELD_BATCH sampled pixels so HTTP callbacks are not
    // starved during a multi-million-pixel scan.
    iterCount++;
    if (iterCount % GEOTIFF_YIELD_BATCH === 0) {
      await yieldToEventLoop();
    }

    const row = Math.floor(flat / width);
    const col = flat % width;
    const val = (raster as ArrayLike<number>)[flat];
    if (val === undefined || !Number.isFinite(val)) continue;
    if (!Number.isNaN(nodata) && val === nodata) continue;

    const lon = lon0 + (col + 0.5) * dLon;
    const lat = lat0 + (row + 0.5) * dLat;
    if (!isValidCoord(lon, lat)) continue;

    const depth = val < 0 ? -val : val;
    if (depth === 0) continue;
    points.push({ lon, lat, depth });
  }

  if (points.length === 0) {
    throw new Error(
      "GeoTIFF produced no valid depth points. Check that the file contains non-zero depth/elevation values and valid geographic coordinates.",
    );
  }
  return points;
}

// ---------------------------------------------------------------------------
// NetCDF
// ---------------------------------------------------------------------------

/** Common variable-name aliases for depth/elevation in NetCDF files. */
const DEPTH_VAR_ALIASES = ["depth", "z", "elevation", "bathy", "bathymetry", "elev", "topo", "altitude"];

/** Common coordinate variable aliases for longitude. */
const LON_VAR_ALIASES = ["lon", "longitude", "x", "nav_lon", "LONGITUDE"];
/** Common coordinate variable aliases for latitude. */
const LAT_VAR_ALIASES = ["lat", "latitude", "y", "nav_lat", "LATITUDE"];

/**
 * Parse a NetCDF file's first depth/elevation grid into lon/lat/depth points.
 *
 * Locates the depth variable by name alias, then reconstructs geographic
 * coordinates from the matching `lon`/`lat` (or `x`/`y`) coordinate variables.
 * Missing / fill values (identified by `_FillValue` or `missing_value`
 * attributes) are skipped.
 */
export function parseNetCdf(
  buffer: Buffer,
  { pointCap = RASTER_POINT_CAP }: { pointCap?: number } = {},
): RawPoint[] {
  let reader: NetCDFReader;
  try {
    reader = new NetCDFReader(buffer);
  } catch (err) {
    throw new Error(
      `Failed to open NetCDF file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const variableNames = reader.variables.map((v) => v.name);

  // Find depth/elevation variable
  const depthVarName = DEPTH_VAR_ALIASES.find(
    (alias) =>
      variableNames.some((n) => n.toLowerCase() === alias.toLowerCase()),
  );
  const depthVarMatch = depthVarName
    ? variableNames.find((n) => n.toLowerCase() === depthVarName.toLowerCase())
    : undefined;

  if (!depthVarMatch) {
    throw new Error(
      `NetCDF file contains no recognisable depth/elevation variable. ` +
        `Found variables: ${variableNames.join(", ")}. ` +
        `Expected one of: ${DEPTH_VAR_ALIASES.join(", ")}.`,
    );
  }

  // Find lon/lat coordinate variables
  const lonVarName = LON_VAR_ALIASES.find((a) =>
    variableNames.some((n) => n.toLowerCase() === a.toLowerCase()),
  );
  const latVarName = LAT_VAR_ALIASES.find((a) =>
    variableNames.some((n) => n.toLowerCase() === a.toLowerCase()),
  );

  const lonVarMatch = lonVarName
    ? variableNames.find((n) => n.toLowerCase() === lonVarName.toLowerCase())
    : undefined;
  const latVarMatch = latVarName
    ? variableNames.find((n) => n.toLowerCase() === latVarName.toLowerCase())
    : undefined;

  if (!lonVarMatch || !latVarMatch) {
    throw new Error(
      `NetCDF file is missing longitude or latitude coordinate variables. ` +
        `Found: ${variableNames.join(", ")}.`,
    );
  }

  const rawDepths = reader.getDataVariable(depthVarMatch) as number[];
  const rawLons = reader.getDataVariable(lonVarMatch) as number[];
  const rawLats = reader.getDataVariable(latVarMatch) as number[];

  if (!rawDepths || !rawLons || !rawLats) {
    throw new Error("NetCDF: failed to read variable data arrays.");
  }

  // Determine fill/missing value — cast to Record to handle varying netcdfjs
  // type definitions across versions (attributes may be typed as never).
  type NcVar = { name: string; attributes?: Array<{ name: string; value: unknown }> };
  const depthVar = (reader.variables as NcVar[]).find((v) => v.name === depthVarMatch);
  const fillAttr = depthVar?.attributes?.find(
    (a) => a.name === "_FillValue" || a.name === "missing_value",
  );
  const fillValue: number | undefined =
    fillAttr !== undefined ? (fillAttr.value as number) : undefined;

  const points: RawPoint[] = [];

  // rawDepths may be a 2D grid [lat × lon] or a flat 1D array matching rawLons.
  // Handle both shapes, applying sub-sampling when the cell count exceeds pointCap.
  const nDepths = rawDepths.length;
  const nLons = rawLons.length;
  const nLats = rawLats.length;

  if (nDepths === nLons && nDepths === nLats) {
    // 1D paired arrays
    const stride = nDepths > pointCap ? Math.ceil(nDepths / pointCap) : 1;
    for (let i = 0; i < nDepths; i += stride) {
      if (points.length >= pointCap) break;
      const z = rawDepths[i]!;
      const lon = rawLons[i]!;
      const lat = rawLats[i]!;
      if (!Number.isFinite(z) || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (fillValue !== undefined && z === fillValue) continue;
      if (!isValidCoord(lon, lat)) continue;
      const depth = z < 0 ? -z : z;
      if (depth === 0) continue;
      points.push({ lon, lat, depth });
    }
  } else if (nDepths === nLons * nLats) {
    // 2D grid: row = lat index, col = lon index.
    // Iterate flat += stride so only sampled indices are visited — O(total2D/stride),
    // not O(total2D).  Derive row/col from the flat index arithmetically.
    const total2D = nLats * nLons;
    const stride = total2D > pointCap ? Math.ceil(total2D / pointCap) : 1;
    for (let flatIdx = 0; flatIdx < total2D; flatIdx += stride) {
      if (points.length >= pointCap) break;
      const ri = Math.floor(flatIdx / nLons);
      const ci = flatIdx % nLons;
      const z = rawDepths[flatIdx]!;
      const lon = rawLons[ci]!;
      const lat = rawLats[ri]!;
      if (!Number.isFinite(z) || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (fillValue !== undefined && z === fillValue) continue;
      if (!isValidCoord(lon, lat)) continue;
      const depth = z < 0 ? -z : z;
      if (depth === 0) continue;
      points.push({ lon, lat, depth });
    }
  } else {
    throw new Error(
      `NetCDF: depth variable has ${nDepths} values but lon/lat arrays have ${nLons}×${nLats}=${nLons * nLats} grid cells. Cannot reconstruct coordinates.`,
    );
  }

  if (points.length === 0) {
    throw new Error(
      "NetCDF file produced no valid depth points. Check that the depth variable contains non-zero, non-fill values.",
    );
  }
  return points;
}

// ---------------------------------------------------------------------------
// LAS / LAZ
// ---------------------------------------------------------------------------

/**
 * LAS 1.x binary format constants.
 * Reference: ASPRS LAS 1.4 R15 specification.
 */
const LAS_MAGIC = "LASF";
const LAS_HEADER_SIZE_MIN = 227; // LAS 1.0–1.2 public header
const LAS_POINT_RECORD_SIZE: Record<number, number> = {
  0: 20, 1: 28, 2: 26, 3: 34, 4: 57, 5: 63,
  6: 30, 7: 36, 8: 38, 9: 59, 10: 67,
};

/**
 * Parse a LAS 1.x or LAZ point-cloud file into lon/lat/depth points.
 *
 * For uncompressed .las files the binary header and point data are read
 * directly.  For .laz files, dynamic import of `laz-perf` is attempted;
 * if the module is unavailable a clear error is thrown directing the user
 * to convert via `las2las` or PDAL first.
 *
 * Z values are converted to positive-depth by flipping positive-up values.
 */
export async function parseLasLaz(buffer: Buffer, fileName: string): Promise<RawPoint[]> {
  const isLaz = fileName.toLowerCase().endsWith(".laz");

  // Validate magic
  const magic = buffer.slice(0, 4).toString("ascii");
  if (magic !== LAS_MAGIC) {
    throw new Error(
      `File does not appear to be a valid LAS/LAZ file (expected magic "${LAS_MAGIC}", got "${magic}").`,
    );
  }

  if (buffer.length < LAS_HEADER_SIZE_MIN) {
    throw new Error(
      `LAS file is too small to contain a valid public header (${buffer.length} bytes < ${LAS_HEADER_SIZE_MIN} minimum).`,
    );
  }

  // Read public header fields
  const versionMajor = buffer.readUInt8(24);
  const versionMinor = buffer.readUInt8(25);
  const headerSize = buffer.readUInt16LE(94);
  const pointDataOffset = buffer.readUInt32LE(96);
  const pointDataFormat = buffer.readUInt8(104);
  const pointDataRecordLength = buffer.readUInt16LE(105);

  // Point count: legacy field (107, 4 bytes) works for LAS ≤1.3;
  // LAS 1.4 uses a 64-bit field at offset 247 but we fall back to the legacy field.
  let pointCount = buffer.readUInt32LE(107);
  if (versionMajor === 1 && versionMinor >= 4 && headerSize >= 375) {
    const hi = buffer.readUInt32LE(251);
    const lo = buffer.readUInt32LE(247);
    pointCount = hi === 0 ? lo : Math.min(lo, 10_000_000); // cap to avoid OOM
  }

  // Scale factors and offsets (offsets 131–162 in public header)
  const scaleX = buffer.readDoubleLE(131);
  const scaleY = buffer.readDoubleLE(139);
  const scaleZ = buffer.readDoubleLE(147);
  const offsetX = buffer.readDoubleLE(155);
  const offsetY = buffer.readDoubleLE(163);
  const offsetZ = buffer.readDoubleLE(171);

  const recordSize = LAS_POINT_RECORD_SIZE[pointDataFormat] ?? pointDataRecordLength;

  if (isLaz) {
    // Initialise laz-perf WASM module and decode with the LASZip API.
    // LASZip.open() accepts the full LAS/LAZ buffer; getPoint() iterates
    // points in order, writing one point record at a time to WASM heap.
    const lp = await createLazPerf();
    const zip = new lp.LASZip();
    // Allocate WASM heap space for the entire file buffer
    const ptr = (lp as unknown as { _malloc: (n: number) => number })._malloc(buffer.length);
    try {
      (lp as unknown as { HEAPU8: Uint8Array }).HEAPU8.set(
        new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
        ptr,
      );
      zip.open(ptr, buffer.length);

      const count = Math.min(zip.getCount(), 2_000_000);
      const ptLen = zip.getPointLength();
      const pts: { x: number; y: number; z: number }[] = [];

      const dest = (lp as unknown as { _malloc: (n: number) => number })._malloc(ptLen);
      try {
        const heap = (lp as unknown as { HEAPU8: Uint8Array }).HEAPU8;
        for (let i = 0; i < count; i++) {
          zip.getPoint(dest);
          // LAS format 0+: X, Y, Z stored as int32LE at byte offsets 0, 4, 8
          const view = new DataView(heap.buffer, dest, ptLen);
          const xi = view.getInt32(0, true);
          const yi = view.getInt32(4, true);
          const zi = view.getInt32(8, true);
          pts.push({
            x: xi * scaleX + offsetX,
            y: yi * scaleY + offsetY,
            z: zi * scaleZ + offsetZ,
          });
        }
      } finally {
        (lp as unknown as { _free: (ptr: number) => void })._free(dest);
      }

      zip.delete();
      return lasPointsToRaw(pts);
    } catch (err) {
      zip.delete();
      throw new Error(
        `LAZ decompression failed: ${err instanceof Error ? err.message : String(err)}. ` +
          "Please convert your .laz file to uncompressed .las first using: " +
          "las2las -i input.laz -o output.las  (or: pdal translate input.laz output.las)",
      );
    } finally {
      (lp as unknown as { _free: (ptr: number) => void })._free(ptr);
    }
  }

  // --- Uncompressed LAS: read point records directly ---
  const points: { x: number; y: number; z: number }[] = [];
  const available = Math.floor((buffer.length - pointDataOffset) / recordSize);
  // Cap is applied HERE — before the loop — to avoid iterating millions of
  // records before discovering the OOM limit. This mirrors the LAZ path above.
  const total = Math.min(pointCount, available, 2_000_000);

  for (let i = 0; i < total; i++) {
    const base = pointDataOffset + i * recordSize;
    if (base + 12 > buffer.length) break;
    const xi = buffer.readInt32LE(base);
    const yi = buffer.readInt32LE(base + 4);
    const zi = buffer.readInt32LE(base + 8);
    const x = xi * scaleX + offsetX;
    const y = yi * scaleY + offsetY;
    const z = zi * scaleZ + offsetZ;
    points.push({ x, y, z });
  }

  return lasPointsToRaw(points);
}

function lasPointsToRaw(points: { x: number; y: number; z: number }[]): RawPoint[] {
  const raw: RawPoint[] = [];
  for (const { x, y, z } of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    // LAS stores geographic coords as X=lon, Y=lat (EPSG:4326).
    // isValidCoord(lon, lat) — pass x (lon) first.
    if (!isValidCoord(x, y)) continue;
    // Z is elevation positive-up; flip to positive-down depth.
    const depth = z < 0 ? -z : z;
    if (depth === 0) continue;
    raw.push({ lon: x, lat: y, depth });
  }
  return raw;
}

// ---------------------------------------------------------------------------
// BAG (HDF5)
// ---------------------------------------------------------------------------

/**
 * Parse a BAG (Bathymetric Attributed Grid) HDF5 file.
 *
 * Uses h5wasm (WASM-based, no native bindings) to open the file buffer, read
 * the `BAG_root/elevation` dataset, and derive geolocation parameters from
 * the `BAG_root/metadata` XML.  If h5wasm cannot be loaded in the current
 * environment, a clear error is returned directing the user to convert via GDAL.
 */
export async function parseBag(buffer: Buffer): Promise<RawPoint[]> {
  // Await h5wasm WASM initialisation — provides the virtual filesystem (FS).
  let mod: Awaited<typeof h5wasmReady>;
  try {
    mod = await h5wasmReady;
  } catch (err) {
    throw new Error(
      `h5wasm initialisation failed: ${err instanceof Error ? err.message : String(err)}. ` +
        "Please convert your .bag file to GeoTIFF first using GDAL: gdal_translate -of GTiff input.bag output.tif",
    );
  }

  const FS = mod.FS;

  // Write buffer to h5wasm virtual filesystem
  const tmpPath = "/tmp_bag_input.bag";
  try {
    FS.writeFile(tmpPath, new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  } catch (err) {
    throw new Error(`Failed to write BAG to virtual FS: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const f = new H5wFile(tmpPath, "r");

    // Read elevation dataset
    const bagRoot = f.get("BAG_root") as H5Group | undefined;
    if (!bagRoot) throw new Error("BAG file does not contain a 'BAG_root' group.");

    const elevDs = bagRoot.get("elevation");
    if (!elevDs) throw new Error("BAG_root/elevation dataset not found.");

    const elevData = (elevDs as unknown as H5Dataset).value as number[][] | Float32Array;

    // Read metadata XML for geolocation
    const metaDs = bagRoot.get("metadata");
    const metaXml = metaDs ? String((metaDs as unknown as H5Dataset).value ?? "") : "";

    f.close();

    // Parse geolocation from BAG metadata XML
    const { lon0, lat0, dLon, dLat, cols, rows } = extractBagGeolocation(metaXml, elevData);

    const points: RawPoint[] = [];
    const nrows = Array.isArray(elevData) ? elevData.length : rows;
    const ncols = Array.isArray(elevData) ? (elevData[0] as number[])?.length ?? cols : cols;

    for (let ri = 0; ri < nrows; ri++) {
      for (let ci = 0; ci < ncols; ci++) {
        const val = Array.isArray(elevData)
          ? ((elevData as number[][])[ri]?.[ci] ?? NaN)
          : (elevData as Float32Array)[ri * ncols + ci]!;
        if (!Number.isFinite(val) || val === 1_000_000) continue; // BAG fill = 1e6
        const lon = lon0 + ci * dLon;
        const lat = lat0 + ri * dLat;
        if (!isValidCoord(lon, lat)) continue;
        const depth = val < 0 ? -val : val;
        if (depth === 0) continue;
        points.push({ lon, lat, depth });
      }
    }

    if (points.length === 0) {
      throw new Error("BAG file produced no valid depth points.");
    }
    return points;
  } finally {
    try {
      FS.unlink(tmpPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

/** Extract geolocation parameters from BAG metadata XML string. */
function extractBagGeolocation(
  xml: string,
  elevData: number[][] | Float32Array,
): { lon0: number; lat0: number; dLon: number; dLat: number; cols: number; rows: number } {
  const nrows = Array.isArray(elevData) ? elevData.length : 0;
  const ncols = Array.isArray(elevData) && elevData[0] ? (elevData[0] as number[]).length : 0;

  const extract = (tag: string): number | undefined => {
    const m = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`).exec(xml);
    return m ? parseFloat(m[1]!) : undefined;
  };

  const westBound = extract("westBoundLongitude") ?? extract("gmd:westBoundLongitude");
  const eastBound = extract("eastBoundLongitude") ?? extract("gmd:eastBoundLongitude");
  const southBound = extract("southBoundLatitude") ?? extract("gmd:southBoundLatitude");
  const northBound = extract("northBoundLatitude") ?? extract("gmd:northBoundLatitude");

  if (
    westBound !== undefined && eastBound !== undefined &&
    southBound !== undefined && northBound !== undefined
  ) {
    const cols = ncols || Math.max(1, Math.round((eastBound - westBound) / 0.001));
    const rows = nrows || Math.max(1, Math.round((northBound - southBound) / 0.001));
    return {
      lon0: westBound,
      lat0: southBound,
      dLon: (eastBound - westBound) / cols,
      dLat: (northBound - southBound) / rows,
      cols,
      rows,
    };
  }

  // Fallback: 1 degree spans with unit pixel size
  return { lon0: -180, lat0: -90, dLon: 0.001, dLat: 0.001, cols: ncols, rows: nrows };
}

// ---------------------------------------------------------------------------
// GPX terrain parser (server-side, no DOMParser)
// ---------------------------------------------------------------------------

/**
 * Parse a GPX file (track points with <ele> elevation) into terrain depth
 * points.  This is distinct from the client-side GPS import that produces
 * markers — here we extract <trkpt lat lon><ele> tuples and treat the
 * elevation as depth (flipping sign for positive-above-sea-level values).
 *
 * Uses regex parsing because Node.js has no built-in DOMParser.
 */
export function parseGpxTerrain(content: string): RawPoint[] {
  const points: RawPoint[] = [];

  // Match <trkpt lat="..." lon="..."> ... </trkpt> blocks
  const trkptRe =
    /<trkpt\s+[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["'][^>]*>([\s\S]*?)<\/trkpt>/gi;
  const eleRe = /<ele>([\s\S]*?)<\/ele>/i;

  let m: RegExpExecArray | null;
  while ((m = trkptRe.exec(content)) !== null) {
    const lat = parseFloat(m[1]!);
    const lon = parseFloat(m[2]!);
    const inner = m[3]!;
    if (!isValidCoord(lon, lat)) continue;

    const eleMatch = eleRe.exec(inner);
    if (!eleMatch) continue;
    const ele = parseFloat(eleMatch[1]!);
    if (!Number.isFinite(ele)) continue;

    // GPX <ele> is elevation in metres (positive above sea level). For
    // bathymetric purposes we flip the sign so depth is positive-downward.
    const depth = ele < 0 ? -ele : ele;
    if (depth === 0) continue;
    points.push({ lon, lat, depth });
  }

  // Also match <wpt lat="..." lon="..."> ... <ele> ... </ele>
  const wptRe =
    /<wpt\s+[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["'][^>]*>([\s\S]*?)<\/wpt>/gi;
  while ((m = wptRe.exec(content)) !== null) {
    const lat = parseFloat(m[1]!);
    const lon = parseFloat(m[2]!);
    const inner = m[3]!;
    if (!isValidCoord(lon, lat)) continue;
    const eleMatch = eleRe.exec(inner);
    if (!eleMatch) continue;
    const ele = parseFloat(eleMatch[1]!);
    if (!Number.isFinite(ele)) continue;
    const depth = ele < 0 ? -ele : ele;
    if (depth === 0) continue;
    points.push({ lon, lat, depth });
  }

  if (points.length === 0) {
    throw new Error(
      "GPX file contains no track points with elevation data. " +
        "Ensure the file has <trkpt> or <wpt> elements with <ele> children.",
    );
  }
  return points;
}

// ---------------------------------------------------------------------------
// NMEA depth-sounder parser
// ---------------------------------------------------------------------------

/**
 * Parse an NMEA 0183 depth-sounder log into terrain points.
 *
 * Supported sentence types:
 *   $SDDBT / $SDDBS / $DDDBT — depth below transducer / keel / surface
 *   $SOUNDG — depth sounding (NMEA 2000 bridge sentence)
 *   $GPGGA  — GPS fix (lat/lon/alt)
 *   $GPRMC  — Recommended minimum (lat/lon/speed/heading)
 *   $GPGLL  — Geographic position
 *
 * Each depth sentence is paired with the most-recent preceding position fix.
 * Lines with invalid NMEA checksums are skipped.
 */
export function parseNmea(content: string): RawPoint[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const points: RawPoint[] = [];

  let currentLon: number | undefined;
  let currentLat: number | undefined;

  for (const line of lines) {
    const sentence = line.trim();
    if (!sentence.startsWith("$") && !sentence.startsWith("!")) continue;
    if (!validateNmeaChecksum(sentence)) continue;

    const fields = sentence.split(",");
    const type = fields[0]?.toUpperCase() ?? "";

    // Position sentences
    if (type === "$GPGGA" || type === "$GNGGA") {
      const lat = nmeaCoordToDecimal(fields[2], fields[3]);
      const lon = nmeaCoordToDecimal(fields[4], fields[5]);
      if (lat !== undefined && lon !== undefined) {
        currentLat = lat;
        currentLon = lon;
      }
      continue;
    }

    if (type === "$GPRMC" || type === "$GNRMC") {
      // Status field (fields[2]) must be 'A' (active)
      if (fields[2]?.toUpperCase() !== "A") continue;
      const lat = nmeaCoordToDecimal(fields[3], fields[4]);
      const lon = nmeaCoordToDecimal(fields[5], fields[6]);
      if (lat !== undefined && lon !== undefined) {
        currentLat = lat;
        currentLon = lon;
      }
      continue;
    }

    if (type === "$GPGLL" || type === "$GNGLL") {
      // Status (fields[6]) must be 'A'
      if (fields[6]?.toUpperCase() !== "A") continue;
      const lat = nmeaCoordToDecimal(fields[1], fields[2]);
      const lon = nmeaCoordToDecimal(fields[3], fields[4]);
      if (lat !== undefined && lon !== undefined) {
        currentLat = lat;
        currentLon = lon;
      }
      continue;
    }

    // Depth sentences
    let depth: number | undefined;

    if (
      type === "$SDDBT" ||
      type === "$IIDBТ" ||
      type === "$DDDBT" ||
      type.endsWith("DBT")
    ) {
      // $--DBT,x.x,f,x.x,M,x.x,F*hh
      // Field 3 = depth in metres
      const metres = parseFloat(fields[3] ?? "");
      if (Number.isFinite(metres) && metres > 0) depth = metres;
    } else if (type === "$SDDBS" || type.endsWith("DBS")) {
      // $--DBS,x.x,f,x.x,M,x.x,F*hh — depth below surface
      const metres = parseFloat(fields[3] ?? "");
      if (Number.isFinite(metres) && metres > 0) depth = metres;
    } else if (type === "$SDDPT" || type.endsWith("DPT")) {
      // $--DPT,x.x,x.x,x.x*hh — depth of water, transducer offset, max range
      const metres = parseFloat(fields[1] ?? "");
      if (Number.isFinite(metres) && metres > 0) depth = metres;
    } else if (type === "$SOUNDG") {
      // $SOUNDG,x.x*hh — simple depth in metres
      const metres = parseFloat(fields[1] ?? "");
      if (Number.isFinite(metres) && metres > 0) depth = metres;
    }

    if (depth !== undefined && currentLon !== undefined && currentLat !== undefined) {
      if (isValidCoord(currentLon, currentLat)) {
        points.push({ lon: currentLon, lat: currentLat, depth });
      }
    }
  }

  if (points.length === 0) {
    throw new Error(
      "NMEA file produced no valid depth+position pairs. " +
        "Ensure the file contains depth sentences ($SDDBT, $SDDBS, $SDDPT, or $SOUNDG) " +
        "paired with position fixes ($GPGGA, $GPRMC, or $GPGLL) with valid checksums.",
    );
  }
  return points;
}

/**
 * Validate NMEA 0183 checksum.  The checksum is the XOR of all bytes between
 * '$' and '*' (exclusive).  Returns true if no '*' delimiter is present
 * (checksum-optional sentences) or if the checksum matches.
 */
function validateNmeaChecksum(sentence: string): boolean {
  const starIdx = sentence.lastIndexOf("*");
  if (starIdx < 0) return true; // no checksum — accept
  const body = sentence.slice(1, starIdx); // exclude '$'
  const expected = parseInt(sentence.slice(starIdx + 1, starIdx + 3), 16);
  if (Number.isNaN(expected)) return false;
  let xor = 0;
  for (let i = 0; i < body.length; i++) {
    xor ^= body.charCodeAt(i);
  }
  return xor === expected;
}

/**
 * Convert an NMEA coordinate string (DDDMM.MMMM) + hemisphere indicator
 * (N/S or E/W) to decimal degrees.
 */
function nmeaCoordToDecimal(
  raw: string | undefined,
  hemi: string | undefined,
): number | undefined {
  if (!raw || !hemi) return undefined;
  const stripped = raw.replace(/[^0-9.]/g, "");
  const dotIdx = stripped.indexOf(".");
  if (dotIdx < 0) return undefined;

  // DDDMM.MMMMM — integer part has 2 or 3 degree digits
  const minStart = Math.max(0, dotIdx - 2);
  const degrees = parseFloat(stripped.slice(0, minStart)) || 0;
  const minutes = parseFloat(stripped.slice(minStart)) || 0;
  let decimal = degrees + minutes / 60;

  const h = hemi.trim().toUpperCase();
  if (h === "S" || h === "W") decimal = -decimal;
  return Number.isFinite(decimal) ? decimal : undefined;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isValidCoord(lon: number, lat: number): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}
