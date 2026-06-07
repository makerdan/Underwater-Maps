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
 *   BAG      (.bag)          — HDF5 survey archive; parsed via bag_parser.py
 *                              (h5py + pyproj; handles standard and VR BAGs,
 *                               reprojects any projected CRS to WGS84)
 *   GPX      (.gpx)          — track points with <ele> depth log (server-side)
 *   NMEA     (.nmea)         — depth-sounder + position sentence log
 */

import { writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fromArrayBuffer } from "geotiff";
import { NetCDFReader } from "netcdfjs";
import { createLazPerf } from "laz-perf";
import { parseXyzCsv } from "./terrain.js";
import { bagWorker } from "./bagWorker.js";

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
// Magic-byte format sniffer
// ---------------------------------------------------------------------------

/**
 * Scan the Variable Length Records of a LAS/LAZ buffer to detect whether the
 * file uses LASzip compression.  Returns true when any VLR carries a User ID
 * starting with "laszip" (case-insensitive), which is the standard marker
 * written by laz-perf and LASzip-compatible writers.
 *
 * LAS public header layout (ASPRS LAS 1.x):
 *   offset 94  — Header Size (uint16 LE)
 *   offset 100 — Number of VLRs (uint32 LE)
 * Each VLR:
 *   +0  Reserved           2 bytes
 *   +2  User ID            16 bytes (null-terminated ASCII)
 *   +18 Record ID          2 bytes
 *   +20 Record Length      2 bytes
 *   +22 Description        32 bytes
 *   +54 Data               recordLength bytes
 */
function containsLazVlr(buffer: Buffer): boolean {
  const LAS_HDR_MIN = 227;
  if (buffer.length < LAS_HDR_MIN) return false;
  const headerSize = buffer.readUInt16LE(94);
  const numVlrs = buffer.readUInt32LE(100);
  let pos = headerSize;
  for (let i = 0; i < numVlrs && pos + 54 <= buffer.length; i++) {
    const userId = buffer
      .slice(pos + 2, pos + 18)
      .toString("ascii")
      .replace(/\0.*/, "")
      .toLowerCase();
    if (userId.startsWith("laszip")) return true;
    const recordLength = buffer.readUInt16LE(pos + 20);
    pos += 54 + recordLength;
  }
  return false;
}

/**
 * Inspect the first bytes of a buffer and return a format hint string, or
 * `null` when the content cannot be identified.
 *
 * Magic signatures:
 *   GeoTIFF  — `II*\0` (LE) or `MM\0*` (BE)
 *   LAS      — `LASF` without a LASzip VLR
 *   LAZ      — `LASF` with a LASzip VLR (User ID starts with "laszip")
 *   HDF5/BAG — `\x89HDF\r\n\x1a\n`
 *   NetCDF   — `CDF\x01`
 *   GPX/XML  — UTF-8 text containing `<?xml` and `<gpx`
 *   NMEA     — first non-blank line starts with `$`
 *   CSV/TXT  — lines of comma/space-separated numbers (fallback text check)
 */
export function sniffFormat(
  buffer: Buffer,
): "tif" | "las" | "laz" | "bag" | "nc" | "gpx" | "nmea" | "csv" | null {
  if (buffer.length < 4) return null;

  // GeoTIFF — little-endian TIFF (II*\0) or big-endian TIFF (MM\0*)
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a)
  ) {
    return "tif";
  }

  // LAS / LAZ — "LASF" file-signature; distinguish by VLR content
  if (
    buffer[0] === 0x4c && buffer[1] === 0x41 && buffer[2] === 0x53 && buffer[3] === 0x46
  ) {
    return containsLazVlr(buffer) ? "laz" : "las";
  }

  // HDF5 / BAG — 8-byte HDF5 superblock signature
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x48 && buffer[2] === 0x44 && buffer[3] === 0x46 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return "bag";
  }

  // NetCDF classic — "CDF\x01"
  if (
    buffer[0] === 0x43 && buffer[1] === 0x44 && buffer[2] === 0x46 && buffer[3] === 0x01
  ) {
    return "nc";
  }

  // GPX / XML — look for <?xml … <gpx in the first 512 bytes
  const head = buffer.slice(0, Math.min(buffer.length, 512)).toString("utf8");
  if (head.includes("<?xml") && head.toLowerCase().includes("<gpx")) {
    return "gpx";
  }

  // NMEA — first non-blank line starts with '$'
  if (head.trimStart().startsWith("$")) {
    return "nmea";
  }

  // CSV / XYZ / TXT — check whether any of the first non-blank lines look like
  // comma/whitespace-separated numbers (handles optional header rows).
  const lines = head
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  for (const line of lines.slice(0, 5)) {
    const parts = line.split(/[,\s\t]+/);
    if (
      parts.length >= 2 &&
      parts.filter((p) => p.length > 0 && !isNaN(parseFloat(p))).length >= 2
    ) {
      return "csv";
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

/**
 * Route an uploaded file buffer to the correct format parser based on file
 * extension.  Returns an array of { lon, lat, depth } points.
 *
 * When the file extension does not match a known format (e.g. a `.gz` file
 * whose base name carries no inner extension), `sniffFormat` is called on the
 * buffer as a fallback.  This makes uploads like
 * `alaska-bathymetric-data-h09092.gz` work regardless of how the file was
 * named on the user's machine.
 *
 * Existing CSV/XYZ/TXT path is also handled here via the sniff fallback so
 * that callers do not need to duplicate the routing logic.
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
    case "nme":
      return parseNmea(buffer.toString("utf8"));
    default: {
      // Extension alone didn't resolve — fall back to magic-byte detection.
      const sniffed = sniffFormat(buffer);
      switch (sniffed) {
        case "tif":
          return parseGeoTiff(buffer);
        case "nc":
          return parseNetCdf(buffer);
        case "las":
          return parseLasLaz(buffer, "sniffed.las");
        case "laz":
          return parseLasLaz(buffer, "sniffed.laz");
        case "bag":
          return parseBag(buffer);
        case "gpx":
          return parseGpxTerrain(buffer.toString("utf8"));
        case "nmea":
          return parseNmea(buffer.toString("utf8"));
        case "csv":
          return parseXyzCsv(buffer.toString("utf8"), "sniffed.csv");
        default:
          throw new Error(
            "Could not detect the file format. " +
              "Ensure the .gz contains a supported type (GeoTIFF, LAS, CSV, etc.).",
          );
      }
    }
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
  const rejectedCoordSample: Array<{ x: number; y: number }> = [];
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
    if (!isValidCoord(lon, lat)) {
      if (rejectedCoordSample.length < 100) {
        rejectedCoordSample.push({ x: lon, y: lat });
      }
      continue;
    }

    const depth = val < 0 ? -val : val;
    points.push({ lon, lat, depth });
  }

  if (points.length === 0) {
    if (looksLikeProjectedCoords(rejectedCoordSample)) {
      throw new Error(PROJECTED_COORD_ERROR);
    }
    throw new Error(
      "GeoTIFF produced no valid depth points. Check that the file contains depth/elevation values and valid geographic coordinates.",
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

  const rejectedCoordSample: Array<{ x: number; y: number }> = [];

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
      if (!isValidCoord(lon, lat)) {
        if (rejectedCoordSample.length < 100) rejectedCoordSample.push({ x: lon, y: lat });
        continue;
      }
      const depth = z < 0 ? -z : z;
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
      if (!isValidCoord(lon, lat)) {
        if (rejectedCoordSample.length < 100) rejectedCoordSample.push({ x: lon, y: lat });
        continue;
      }
      const depth = z < 0 ? -z : z;
      points.push({ lon, lat, depth });
    }
  } else {
    throw new Error(
      `NetCDF: depth variable has ${nDepths} values but lon/lat arrays have ${nLons}×${nLats}=${nLons * nLats} grid cells. Cannot reconstruct coordinates.`,
    );
  }

  if (points.length === 0) {
    if (looksLikeProjectedCoords(rejectedCoordSample)) {
      throw new Error(PROJECTED_COORD_ERROR);
    }
    throw new Error(
      "NetCDF file produced no valid depth points. Check that the depth variable contains non-fill values and valid geographic coordinates.",
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
    // The entire block (including createLazPerf initialisation) is wrapped
    // so that WASM-load failures surface the same descriptive message as
    // decompression errors, giving users a concrete fallback path.
    let lp: Awaited<ReturnType<typeof createLazPerf>>;
    try {
      lp = await createLazPerf();
    } catch (err) {
      throw new Error(
        `LAZ decompression failed: ${err instanceof Error ? err.message : String(err)}. ` +
          "Please convert your .laz file to uncompressed .las first using: " +
          "las2las -i input.laz -o output.las  (or: pdal translate input.laz output.las)",
      );
    }

    const zip = new lp.LASZip();
    // Allocate WASM heap space for the entire file buffer
    const ptr = (lp as unknown as { _malloc: (n: number) => number })._malloc(buffer.length);
    if (ptr === 0) {
      zip.delete();
      throw new Error("WASM out of memory allocating file buffer");
    }
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
      if (dest === 0) {
        throw new Error("WASM out of memory allocating point record buffer");
      }
      try {
        for (let i = 0; i < count; i++) {
          zip.getPoint(dest);
          // Re-read HEAPU8 each iteration: WASM memory can grow during decompression,
          // which detaches the previously-captured ArrayBuffer.  Reading lp.HEAPU8
          // always yields the current (live) typed array after any memory growth.
          // LAS format 0+: X, Y, Z stored as int32LE at byte offsets 0, 4, 8
          const view = new DataView(
            (lp as unknown as { HEAPU8: Uint8Array }).HEAPU8.buffer,
            dest,
            ptLen,
          );
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
      // depth=0 is a valid intertidal / waterline measurement — preserve it.
      // lasPointsToRaw already flips negative-Z to positive depth; a zi=0
      // in the LAS record (surface point) becomes depth=0 and must be kept.
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
    if (base + recordSize > buffer.length) break;
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
  const rejectedCoordSample: Array<{ x: number; y: number }> = [];
  for (const { x, y, z } of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    // LAS stores geographic coords as X=lon, Y=lat (EPSG:4326).
    // isValidCoord(lon, lat) — pass x (lon) first.
    if (!isValidCoord(x, y)) {
      if (rejectedCoordSample.length < 100) rejectedCoordSample.push({ x, y });
      continue;
    }
    // Z is elevation positive-up; flip to positive-down depth.
    const depth = z < 0 ? -z : z;
    raw.push({ lon: x, lat: y, depth });
  }
  if (raw.length === 0 && looksLikeProjectedCoords(rejectedCoordSample)) {
    throw new Error(PROJECTED_COORD_ERROR);
  }
  return raw;
}

// ---------------------------------------------------------------------------
// BAG (HDF5)
// ---------------------------------------------------------------------------

/**
 * Parse a BAG (Bathymetric Attributed Grid) HDF5 file.
 *
 * Delegates to `bag_parser.py` (Python / h5py / pyproj) via a child-process
 * call so that both standard uniform-grid BAGs and Variable Resolution (VR)
 * BAGs are handled, with proper CRS reprojection to WGS84 when the file uses
 * a projected coordinate system (UTM, State Plane, etc.).
 *
 * The Python script is located next to this module at build time
 * (`dist/bag_parser.py`) and in the source tree during tests
 * (`src/lib/bag_parser.py`).
 */

export async function parseBag(buffer: Buffer): Promise<RawPoint[]> {
  // Write the buffer to a temp file that the persistent worker can open.
  const tmpPath = join(
    tmpdir(),
    `bag_${Date.now()}_${Math.random().toString(36).slice(2)}.bag`,
  );

  try {
    writeFileSync(tmpPath, buffer);

    // Delegate to the module-level singleton worker process (bag_worker.py).
    // The worker stays alive between calls so Python + h5py + pyproj are only
    // loaded once, eliminating the ~500–700 ms cold-start on every invocation.
    const csv = await bagWorker.parseFile(tmpPath);

    const points: RawPoint[] = [];
    for (const line of csv.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(",");
      if (parts.length !== 3) continue;
      const lon = parseFloat(parts[0]!);
      const lat = parseFloat(parts[1]!);
      const depth = parseFloat(parts[2]!);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(depth)) continue;
      points.push({ lon, lat, depth });
    }

    if (points.length === 0) {
      throw new Error("BAG file produced no valid depth points.");
    }
    return points;
  } finally {
    try {
      rmSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }
  }
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
  // Echo-sounder loggers (Garmin echoMAP, Lowrance ActiveTarget, etc.) embed
  // depth inside <extensions> instead of <ele>.  We check common tag names
  // case-insensitively: <gpxx:Depth>, <nmea:depth>, and plain <depth>.
  const extBlockRe = /<extensions>([\s\S]*?)<\/extensions>/i;
  const extDepthRe =
    /<(?:gpxx:Depth|nmea:depth|depth)\b[^>]*>([\s\S]*?)<\/(?:gpxx:Depth|nmea:depth|depth)>/i;

  /** Extract depth (metres, positive-downward) from a trkpt/wpt inner block. */
  function extractDepth(inner: string): number | null {
    // 1. Try <extensions> depth tags first.
    const extBlock = extBlockRe.exec(inner);
    if (extBlock) {
      const extDepthMatch = extDepthRe.exec(extBlock[1]!);
      if (extDepthMatch) {
        const val = parseFloat(extDepthMatch[1]!);
        if (Number.isFinite(val)) return Math.abs(val);
      }
    }
    // 2. Fall back to <ele> (elevation in metres, positive above sea level).
    const eleMatch = eleRe.exec(inner);
    if (!eleMatch) return null;
    const ele = parseFloat(eleMatch[1]!);
    if (!Number.isFinite(ele)) return null;
    return ele < 0 ? -ele : ele;
  }

  let m: RegExpExecArray | null;
  while ((m = trkptRe.exec(content)) !== null) {
    const lat = parseFloat(m[1]!);
    const lon = parseFloat(m[2]!);
    const inner = m[3]!;
    if (!isValidCoord(lon, lat)) continue;
    const depth = extractDepth(inner);
    if (depth === null) continue;
    points.push({ lon, lat, depth });
  }

  // Also match <wpt lat="..." lon="..."> ... </wpt>
  const wptRe =
    /<wpt\s+[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["'][^>]*>([\s\S]*?)<\/wpt>/gi;
  while ((m = wptRe.exec(content)) !== null) {
    const lat = parseFloat(m[1]!);
    const lon = parseFloat(m[2]!);
    const inner = m[3]!;
    if (!isValidCoord(lon, lat)) continue;
    const depth = extractDepth(inner);
    if (depth === null) continue;
    points.push({ lon, lat, depth });
  }

  if (points.length === 0) {
    throw new Error(
      "GPX file contains no track points with elevation data. " +
        "Ensure the file has <trkpt> or <wpt> elements with <ele> or " +
        "<extensions> depth children (<gpxx:Depth>, <nmea:depth>, <depth>).",
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

export const PROJECTED_COORD_ERROR =
  "File appears to use projected coordinates (e.g. UTM). " +
  "Please re-export in WGS 84 (lat/lon) format.";

/**
 * Returns true when ≥90 % of the provided sample points fail isValidCoord
 * but have absolute X or Y values > 1000 — a strong signal that the file
 * was exported in a projected CRS (UTM, State Plane, etc.) rather than
 * geographic WGS 84.
 */
export function looksLikeProjectedCoords(sample: Array<{ x: number; y: number }>): boolean {
  if (sample.length === 0) return false;
  const invalid = sample.filter(({ x, y }) => !isValidCoord(x, y));
  if (invalid.length / sample.length < 0.9) return false;
  const projectedLike = invalid.filter(({ x, y }) => Math.abs(x) > 1000 || Math.abs(y) > 1000);
  return projectedLike.length / invalid.length >= 0.9;
}
