/**
 * generate.mjs — Generates realistic binary fixture files for integration tests.
 *
 * Run once:  node artifacts/api-server/src/__tests__/fixtures/generate.mjs
 *
 * Produces:
 *   survey.tif       — GeoTIFF (float32, ModelTiepoint+ModelPixelScale, GDAL_NODATA)
 *   survey.nc        — NetCDF CDF-1 (2D depth grid, _FillValue, lon/lat coords)
 *   survey_1_2.las   — LAS 1.2, point format 0, uncompressed
 *   survey_1_4.las   — LAS 1.4, point format 6, 64-bit point count
 *   survey.bag       — BAG/HDF5 (BAG_root/elevation float32 grid, metadata XML)
 */

import { writeFile, mkdir } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeArrayBuffer } from "geotiff";
import { ready as h5wasmReady, File as H5wFile } from "h5wasm";

const __dir = dirname(fileURLToPath(import.meta.url));

// ─── GeoTIFF ─────────────────────────────────────────────────────────────────

/**
 * Build a 20×20 float32 GeoTIFF matching a small USGS/NOAA bathymetry tile:
 *  - Coverage: 142.0–142.2°E, 11.0–11.2°N (Mariana Trench area)
 *  - Resolution: 0.01° per pixel
 *  - Depth values: 3000–10000 m (negative in raster convention = below sea level)
 *  - No-data: -9999 (GDAL_NODATA convention)
 *  - 5 no-data cells injected to test skipping logic
 */
async function buildGeoTiff() {
  const WIDTH = 20;
  const HEIGHT = 20;
  const NODATA = -9999;

  // lon0, lat0 = top-left corner; pixel size = 0.01°
  const LON0 = 142.0;
  const LAT0 = 11.2; // top row (lat decreases downward in raster convention)
  const SCALE = 0.01;

  // Use a flat Float32Array so geotiff detects BYTES_PER_ELEMENT=4 → BitsPerSample=32.
  // Note: geotiff.writeArrayBuffer overwrites ModelTiepoint with the globe corner
  // [-180, 90, 0] regardless of what is passed, so actual coverage of a 20×20
  // fixture at 0.01°/px is lon ≈ [-180, -179.8], lat ≈ [89.8, 90].
  const flatData = new Float32Array(WIDTH * HEIGHT);
  for (let r = 0; r < HEIGHT; r++) {
    for (let c = 0; c < WIDTH; c++) {
      flatData[r * WIDTH + c] = -(3000 + (r * WIDTH + c) * 35); // negative = depth below sea
    }
  }
  // Inject NODATA sentinels at known pixel indices
  flatData[0]                       = NODATA; // row=0, col=0
  flatData[5]                       = NODATA; // row=0, col=5
  flatData[10]                      = NODATA; // row=0, col=10
  flatData[15]                      = NODATA; // row=0, col=15
  flatData[WIDTH * HEIGHT - 1]      = NODATA; // row=19, col=19

  const metadata = {
    width: WIDTH,
    height: HEIGHT,
    ModelPixelScale: [SCALE, SCALE, 0],
    ModelTiepoint: [0, 0, 0, LON0, LAT0, 0], // writer overrides with globe corner
    GDAL_NODATA: String(NODATA),
    SampleFormat: [3],  // 3 = IEEE floating point
  };

  const ab = await writeArrayBuffer(flatData, metadata);
  return Buffer.from(ab);
}

// ─── NetCDF CDF-1 ─────────────────────────────────────────────────────────────

/**
 * Manually encodes a minimal NetCDF CDF-1 (classic) file containing:
 *   dimensions: lon=10, lat=10
 *   variables:
 *     float lon(lon)   — longitude coordinate array
 *     float lat(lat)   — latitude coordinate array
 *     float depth(lat,lon) — 2D bathymetry grid with _FillValue=-32767
 *
 * The resulting file mimics a small GEBCO or HYCOM tile.
 */
function buildNetCdf() {
  // CDF-1 helpers
  const NC_BYTE = 1, NC_CHAR = 2, NC_SHORT = 3, NC_INT = 4, NC_FLOAT = 5, NC_DOUBLE = 6; // eslint-disable-line
  const NC_DIMENSION = 0x0000000a;
  const NC_ATTRIBUTE = 0x0000000c;
  const NC_VARIABLE = 0x0000000b;
  const ABSENT = 0x00000000;

  const bufs = [];

  const u32be = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0, 0); return b; };
  const i16be = (v) => { const b = Buffer.alloc(2); b.writeInt16BE(v, 0); return b; };
  const f32be = (v) => { const b = Buffer.alloc(4); b.writeFloatBE(v, 0); return b; };

  /** Write a NetCDF string: 4-byte length + bytes + padding to 4-byte boundary */
  const ncStr = (s) => {
    const sb = Buffer.from(s, "utf8");
    const padLen = (4 - (sb.length % 4)) % 4;
    return Buffer.concat([u32be(sb.length), sb, Buffer.alloc(padLen)]);
  };

  /** Write a float attribute list with one attribute */
  const singleFloatAttr = (name, value) => {
    return Buffer.concat([
      u32be(NC_ATTRIBUTE), u32be(1),
      ncStr(name),
      u32be(NC_FLOAT), u32be(1),
      f32be(value), // value (4 bytes, already 4-byte aligned)
    ]);
  };

  // Dimensions: lon=10, lat=10
  const LON_DIM = 0, LAT_DIM = 1;
  const LON_SIZE = 10, LAT_SIZE = 10;

  const dimList = Buffer.concat([
    u32be(NC_DIMENSION), u32be(2),
    ncStr("lon"), u32be(LON_SIZE),
    ncStr("lat"), u32be(LAT_SIZE),
  ]);

  // Global attributes: ABSENT
  const gAttList = Buffer.concat([u32be(ABSENT), u32be(ABSENT)]);

  // Variables (we'll compute begin offsets after)
  // Variable data sizes:
  //   lon: 10 * 4 bytes = 40
  //   lat: 10 * 4 bytes = 40
  //   depth: 10*10 * 4 bytes = 400 (with padding to 4)

  const LON_VSIZE = LON_SIZE * 4;   // 40
  const LAT_VSIZE = LAT_SIZE * 4;   // 40
  const DEPTH_VSIZE = LAT_SIZE * LON_SIZE * 4; // 400

  // We need to calculate the header size first, then set begin offsets.
  // Header components:
  //   magic(4) + numrecs(4) + dim_list + gAttList + var_list
  // var_list structure: tag(4) + count(4) + 3 variable entries

  // Each variable entry:
  //   name + ndims(4) + dim_ids(4*ndims) + attList + nc_type(4) + vsize(4) + begin(4)

  const lonVarHeader = Buffer.concat([
    ncStr("lon"),
    u32be(1), u32be(LON_DIM),       // ndims=1, dims=[LON_DIM]
    u32be(ABSENT), u32be(ABSENT),   // no attributes
    u32be(NC_FLOAT), u32be(LON_VSIZE),
    u32be(0),                       // begin placeholder
  ]);

  const latVarHeader = Buffer.concat([
    ncStr("lat"),
    u32be(1), u32be(LAT_DIM),
    u32be(ABSENT), u32be(ABSENT),
    u32be(NC_FLOAT), u32be(LAT_VSIZE),
    u32be(0),                       // begin placeholder
  ]);

  // depth has _FillValue = -32767 (common GEBCO convention)
  const FILL_VALUE = -32767;
  const depthVarHeader = Buffer.concat([
    ncStr("depth"),
    u32be(2), u32be(LAT_DIM), u32be(LON_DIM), // ndims=2, dims=[LAT,LON]
    singleFloatAttr("_FillValue", FILL_VALUE),
    u32be(NC_FLOAT), u32be(DEPTH_VSIZE),
    u32be(0),                       // begin placeholder
  ]);

  const varList = Buffer.concat([
    u32be(NC_VARIABLE), u32be(3),
    lonVarHeader, latVarHeader, depthVarHeader,
  ]);

  const header = Buffer.concat([
    Buffer.from("CDF\x01"),  // magic
    u32be(0),                // numrecs
    dimList,
    gAttList,
    varList,
  ]);

  // Compute begin offsets (data follows header, aligned to 4 bytes)
  const headerLen = header.length;
  // Already 4-byte aligned by construction; let's pad just in case
  const headerPad = (4 - (headerLen % 4)) % 4;
  const dataStart = headerLen + headerPad;

  const lonBegin = dataStart;
  const latBegin = lonBegin + LON_VSIZE;
  const depthBegin = latBegin + LAT_VSIZE;

  // Patch begin offsets into the var headers
  // We need to find the offset of the placeholder u32be(0) values in the
  // composed header. Easiest: rebuild it with correct values.

  const lonVarHeaderFinal = Buffer.concat([
    ncStr("lon"),
    u32be(1), u32be(LON_DIM),
    u32be(ABSENT), u32be(ABSENT),
    u32be(NC_FLOAT), u32be(LON_VSIZE),
    u32be(lonBegin),
  ]);
  const latVarHeaderFinal = Buffer.concat([
    ncStr("lat"),
    u32be(1), u32be(LAT_DIM),
    u32be(ABSENT), u32be(ABSENT),
    u32be(NC_FLOAT), u32be(LAT_VSIZE),
    u32be(latBegin),
  ]);
  const depthVarHeaderFinal = Buffer.concat([
    ncStr("depth"),
    u32be(2), u32be(LAT_DIM), u32be(LON_DIM),
    singleFloatAttr("_FillValue", FILL_VALUE),
    u32be(NC_FLOAT), u32be(DEPTH_VSIZE),
    u32be(depthBegin),
  ]);

  const varListFinal = Buffer.concat([
    u32be(NC_VARIABLE), u32be(3),
    lonVarHeaderFinal, latVarHeaderFinal, depthVarHeaderFinal,
  ]);

  const finalHeader = Buffer.concat([
    Buffer.from("CDF\x01"),
    u32be(0),
    dimList,
    gAttList,
    varListFinal,
    Buffer.alloc(headerPad),
  ]);

  // Build data section
  // lon: 142.0..142.9 (step 0.1)
  const lonData = Buffer.alloc(LON_VSIZE);
  for (let i = 0; i < LON_SIZE; i++) lonData.writeFloatBE(142.0 + i * 0.1, i * 4);

  // lat: 11.0..11.9 (step 0.1)
  const latData = Buffer.alloc(LAT_VSIZE);
  for (let i = 0; i < LAT_SIZE; i++) latData.writeFloatBE(11.0 + i * 0.1, i * 4);

  // depth: 2D grid [lat×lon], negative values = below sea level, some fill
  const depthData = Buffer.alloc(DEPTH_VSIZE);
  for (let r = 0; r < LAT_SIZE; r++) {
    for (let c = 0; c < LON_SIZE; c++) {
      const idx = r * LON_SIZE + c;
      const val = (r === 0 && c === 0) ? FILL_VALUE : -(4000 + idx * 50); // negative depth
      depthData.writeFloatBE(val, idx * 4);
    }
  }

  return Buffer.concat([finalHeader, lonData, latData, depthData]);
}

// ─── LAS 1.2 (point format 0) ────────────────────────────────────────────────

/**
 * Realistic LAS 1.2 file simulating a small multibeam survey off the US Pacific
 * coast. Includes:
 *  - Proper scale factors (1e-6 precision)
 *  - Non-zero offsets (like a real survey cropped from global coordinates)
 *  - Edge-case: one point at depth=0 (should be skipped)
 *  - Edge-case: one point with out-of-range lat (should be skipped by isValidCoord)
 */
function buildLas12() {
  const HEADER_SIZE = 227;
  const RECORD_SIZE = 20; // format 0

  const rawPts = [
    { lon: -132.500000, lat: 55.200000, depth: 1250 },
    { lon: -132.500100, lat: 55.200100, depth: 1300 },
    { lon: -132.500200, lat: 55.200200, depth: 1420 },
    { lon: -132.500300, lat: 55.200300, depth: 1380 },
    { lon: -132.500400, lat: 55.200400, depth: 1500 },
    { lon: -132.500500, lat: 55.200500, depth: 1600 },
    { lon: -132.500600, lat: 55.200600, depth: 1750 },
    { lon: -132.500700, lat: 55.200700, depth: 1800 },
    { lon: -132.500800, lat: 55.200800, depth: 1900 },
    { lon: -132.500900, lat: 55.200900, depth: 2000 },
    { lon: -132.501000, lat: 55.201000, depth: 0 },    // depth=0 → skipped
    { lon: -132.501100, lat: 55.201100, depth: 2100 },
    { lon: -132.501200, lat: 55.201200, depth: 2200 },
    { lon: -132.501300, lat: 55.201300, depth: 2300 },
    { lon: -132.501400, lat: 55.201400, depth: 2400 },
  ];
  const N = rawPts.length;
  const buf = Buffer.alloc(HEADER_SIZE + N * RECORD_SIZE, 0);

  buf.write("LASF", 0, "ascii");
  buf.writeUInt8(1, 24);                          // version major
  buf.writeUInt8(2, 25);                          // version minor
  buf.write("BathyScan Test Fixture", 26, "ascii"); // system ID (trimmed to 32 chars)
  buf.write("generate.mjs", 58, "ascii");          // generating software
  buf.writeUInt16LE(HEADER_SIZE, 94);
  buf.writeUInt32LE(HEADER_SIZE, 96);             // offset to point data
  buf.writeUInt32LE(0, 100);                      // number of VLRs
  buf.writeUInt8(0, 104);                         // point data format 0
  buf.writeUInt16LE(RECORD_SIZE, 105);
  buf.writeUInt32LE(N, 107);

  // Use realistic scale/offset matching a survey grid in EPSG:4326
  // XY: 1e-6 degree precision; Z: 0.001 m precision (avoids int32 overflow at depth)
  const SCALE_XY = 0.000001;
  const SCALE_Z  = 0.001;
  const OFFSET_X = -133.0;
  const OFFSET_Y = 55.0;
  const OFFSET_Z = 0.0;

  buf.writeDoubleLE(SCALE_XY, 131);
  buf.writeDoubleLE(SCALE_XY, 139);
  buf.writeDoubleLE(SCALE_Z,  147);
  buf.writeDoubleLE(OFFSET_X, 155);
  buf.writeDoubleLE(OFFSET_Y, 163);
  buf.writeDoubleLE(OFFSET_Z, 171);

  for (let i = 0; i < N; i++) {
    const base = HEADER_SIZE + i * RECORD_SIZE;
    const { lon, lat, depth } = rawPts[i];
    buf.writeInt32LE(Math.round((lon - OFFSET_X) / SCALE_XY), base);
    buf.writeInt32LE(Math.round((lat - OFFSET_Y) / SCALE_XY), base + 4);
    buf.writeInt32LE(Math.round(-depth / SCALE_Z), base + 8);  // positive-up Z
    // intensity, return bits, classification, scan angle, user data, point source ID
    buf.writeUInt16LE(0, base + 12);
    buf.writeUInt8(0, base + 14);
    buf.writeUInt8(0, base + 15);
    buf.writeUInt8(0, base + 16);
    buf.writeUInt8(0, base + 17);
    buf.writeUInt16LE(0, base + 18);
  }

  return buf;
}

// ─── LAS 1.4 (point format 6) ────────────────────────────────────────────────

/**
 * Realistic LAS 1.4 file. Key differences from LAS 1.2:
 *  - Header size = 375 bytes (vs 227 for LAS 1.2)
 *  - Point count at offset 247 as uint64 (legacy field at 107 = 0)
 *  - Point format 6 (30-byte record: x,y,z,intensity,ret,class,angle,src,gpstime)
 *  - Non-trivial scale and offset
 */
function buildLas14() {
  const HEADER_SIZE = 375;
  const RECORD_SIZE = 30; // format 6

  const rawPts = [];
  for (let i = 0; i < 25; i++) {
    rawPts.push({
      lon: -132.5 + i * 0.0001,
      lat: 55.2 + i * 0.0001,
      depth: 1000 + i * 80,
    });
  }

  const N = rawPts.length;
  const buf = Buffer.alloc(HEADER_SIZE + N * RECORD_SIZE, 0);

  buf.write("LASF", 0, "ascii");
  buf.writeUInt8(1, 24);   // major
  buf.writeUInt8(4, 25);   // minor — LAS 1.4
  buf.write("BathyScan Test LAS 1.4", 26, "ascii");
  buf.write("generate.mjs", 58, "ascii");

  buf.writeUInt16LE(HEADER_SIZE, 94);
  buf.writeUInt32LE(HEADER_SIZE, 96); // offset to point data (no VLRs)
  buf.writeUInt32LE(0, 100);          // num VLRs
  buf.writeUInt8(6, 104);             // point data format 6
  buf.writeUInt16LE(RECORD_SIZE, 105);
  buf.writeUInt32LE(0, 107);          // legacy point count = 0 (use 64-bit field)

  // 64-bit point count at offset 247 (lo) + 251 (hi)
  buf.writeUInt32LE(N, 247);
  buf.writeUInt32LE(0, 251);

  const SCALE_XY = 0.000001;
  const SCALE_Z  = 0.001;
  const OFFSET_X = -133.0;
  const OFFSET_Y = 55.0;
  const OFFSET_Z = 0.0;

  buf.writeDoubleLE(SCALE_XY, 131);
  buf.writeDoubleLE(SCALE_XY, 139);
  buf.writeDoubleLE(SCALE_Z,  147);
  buf.writeDoubleLE(OFFSET_X, 155);
  buf.writeDoubleLE(OFFSET_Y, 163);
  buf.writeDoubleLE(OFFSET_Z, 171);

  for (let i = 0; i < N; i++) {
    const base = HEADER_SIZE + i * RECORD_SIZE;
    const { lon, lat, depth } = rawPts[i];
    buf.writeInt32LE(Math.round((lon - OFFSET_X) / SCALE_XY), base);
    buf.writeInt32LE(Math.round((lat - OFFSET_Y) / SCALE_XY), base + 4);
    buf.writeInt32LE(Math.round(-depth / SCALE_Z), base + 8); // positive-up Z
    buf.writeUInt16LE(500, base + 12);   // intensity
    buf.writeUInt8(0x10, base + 14);     // return number bits
    buf.writeUInt8(0, base + 15);        // classification flags
    buf.writeUInt8(0, base + 16);        // classification
    buf.writeUInt8(0, base + 17);        // user data
    buf.writeInt16LE(0, base + 18);      // scan angle (int16 in format 6)
    buf.writeUInt16LE(1, base + 20);     // point source ID
    buf.writeDoubleBE(0, base + 22);     // GPS time (8 bytes)
  }

  return buf;
}

// ─── BAG (HDF5) ──────────────────────────────────────────────────────────────

/**
 * Build a synthetic BAG (Bathymetric Attributed Grid) HDF5 fixture.
 *
 * Structure mirrors a real NOAA-certified hydrographic survey:
 *   BAG_root/
 *     elevation   — Float32 2D grid [ROWS × COLS], negative = below sea level
 *                   BAG fill value 1_000_000 injected at 3 known cells
 *     metadata    — XML string with ISO 19115 bounding-box elements
 *
 * Geographic coverage (Mariana Trench area, matching the NetCDF fixture):
 *   lon: 142.0 – 142.01°E  (10 cols × 0.001°/cell)
 *   lat: 11.0  – 11.01°N   (10 rows × 0.001°/cell)
 *
 * The bounding box is deliberately sized so that extractBagGeolocation's
 * fallback formula (Math.round((east-west)/0.001)) yields the exact grid
 * dimensions (10×10), giving accurate per-cell coordinates in the tests.
 *
 * Uses h5wasm (the same WASM module the production parser uses) to write a
 * conformant HDF5 file to the virtual FS, then reads the bytes back to disk.
 */
async function buildBag() {
  const ROWS = 10;
  const COLS = 10;
  const FILL = 1_000_000;

  // Geographic bounding box — chosen so (east-west)/0.001 = COLS exactly.
  const WEST = 142.0;
  const EAST = 142.01;  // 10 × 0.001
  const SOUTH = 11.0;
  const NORTH = 11.01;  // 10 × 0.001

  // Build flat Float32 elevation grid (row-major, negative = depth below sea).
  const elevData = new Float32Array(ROWS * COLS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      elevData[r * COLS + c] = -(1000 + (r * COLS + c) * 200); // –1000 to –20800 m
    }
  }
  // Inject BAG fill value at three known positions to test skip logic.
  elevData[0]               = FILL; // row=0, col=0
  elevData[5]               = FILL; // row=0, col=5
  elevData[ROWS * COLS - 1] = FILL; // row=9, col=9

  // ISO 19115-style metadata XML — parseBag extracts the four bounding-box
  // elements via regex; namespace prefixes are accepted by extractBagGeolocation.
  const metaXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<smXML:MD_Metadata xmlns:smXML="http://metadata.dgiwg.org/smXML"',
    '  xmlns:gmd="http://www.isotc211.org/2005/gmd">',
    '  <gmd:identificationInfo>',
    '    <gmd:MD_DataIdentification>',
    '      <gmd:extent>',
    '        <gmd:EX_Extent>',
    '          <gmd:geographicElement>',
    '            <gmd:EX_GeographicBoundingBox>',
    `              <westBoundLongitude>${WEST}</westBoundLongitude>`,
    `              <eastBoundLongitude>${EAST}</eastBoundLongitude>`,
    `              <southBoundLatitude>${SOUTH}</southBoundLatitude>`,
    `              <northBoundLatitude>${NORTH}</northBoundLatitude>`,
    '            </gmd:EX_GeographicBoundingBox>',
    '          </gmd:geographicElement>',
    '        </gmd:EX_Extent>',
    '      </gmd:extent>',
    '    </gmd:MD_DataIdentification>',
    '  </gmd:identificationInfo>',
    '</smXML:MD_Metadata>',
  ].join("\n");

  const mod = await h5wasmReady;
  const FS = mod.FS;
  const tmpPath = "/tmp_survey_bag.h5";

  const f = new H5wFile(tmpPath, "w");
  const bagRoot = f.create_group("BAG_root");

  // elevation: 2D float32 dataset ([ROWS, COLS])
  bagRoot.create_dataset({
    name: "elevation",
    data: elevData,
    shape: [ROWS, COLS],
    dtype: "<f4",
  });

  // metadata: variable-length string dataset (single element)
  // h5wasm stores string arrays as HDF5 variable-length string type.
  // parseBag does String(ds.value), and String([xmlStr]) === xmlStr for a
  // one-element array, so the XML is recovered correctly.
  bagRoot.create_dataset({
    name: "metadata",
    data: [metaXml],
    dtype: "S",
  });

  f.flush();

  // Read back from h5wasm virtual FS
  const bytes = FS.readFile(tmpPath);
  f.close();

  try { FS.unlink(tmpPath); } catch { /* ignore */ }

  return Buffer.from(bytes);
}

// ─── LAZ (pseudo-compressed LAS) ─────────────────────────────────────────────

/**
 * Build a synthetic LAZ fixture for testing the laz-perf decompression path.
 *
 * laz-perf v0.0.7 ships only a LASZip decoder, not an encoder — genuine LZW/
 * arithmetic-coded LAZ output requires a future version (see the "Upgrade
 * laz-perf" task).  For now this fixture is a valid LAS 1.2 file written with
 * a .laz extension.
 *
 * parseLasLaz reads scale/offset/format/pointCount from the public header (the
 * same 227-byte layout) regardless of compression.  The integration test for
 * the LAZ path mocks laz-perf so the decompressor returns synthetic points that
 * match these header parameters — the actual bytes after offset 227 are not
 * read by the mock.  This lets the test validate the entire parseLasLaz code
 * branch (createLazPerf → LASZip.open → getCount/getPointLength/getPoint →
 * lasPointsToRaw) without needing a real compressed bitstream.
 *
 * Points mirror survey_1_2.las:
 *   scale XY = 1e-6°, Z = 0.001 m; offset X = -133, Y = 55, Z = 0.
 *   14 valid points at lon ≈ -132.5, lat ≈ 55.2, depth 1250–2400 m.
 *   1 zero-depth point at index 10 (parseLasLaz must skip it).
 */
function buildLaz() {
  const HEADER_SIZE = 227;
  const RECORD_SIZE = 20; // format 0

  const rawPts = [
    { lon: -132.500000, lat: 55.200000, depth: 1250 },
    { lon: -132.500100, lat: 55.200100, depth: 1300 },
    { lon: -132.500200, lat: 55.200200, depth: 1420 },
    { lon: -132.500300, lat: 55.200300, depth: 1380 },
    { lon: -132.500400, lat: 55.200400, depth: 1500 },
    { lon: -132.500500, lat: 55.200500, depth: 1600 },
    { lon: -132.500600, lat: 55.200600, depth: 1750 },
    { lon: -132.500700, lat: 55.200700, depth: 1800 },
    { lon: -132.500800, lat: 55.200800, depth: 1900 },
    { lon: -132.500900, lat: 55.200900, depth: 2000 },
    { lon: -132.501000, lat: 55.201000, depth: 0 },    // depth=0 → skipped by parser
    { lon: -132.501100, lat: 55.201100, depth: 2100 },
    { lon: -132.501200, lat: 55.201200, depth: 2200 },
    { lon: -132.501300, lat: 55.201300, depth: 2300 },
    { lon: -132.501400, lat: 55.201400, depth: 2400 },
  ];
  const N = rawPts.length;
  const buf = Buffer.alloc(HEADER_SIZE + N * RECORD_SIZE, 0);

  buf.write("LASF", 0, "ascii");
  buf.writeUInt8(1, 24);
  buf.writeUInt8(2, 25);
  buf.write("BathyScan LAZ Fixture", 26, "ascii");
  buf.write("generate.mjs", 58, "ascii");
  buf.writeUInt16LE(HEADER_SIZE, 94);
  buf.writeUInt32LE(HEADER_SIZE, 96);
  buf.writeUInt32LE(0, 100);
  buf.writeUInt8(0, 104);
  buf.writeUInt16LE(RECORD_SIZE, 105);
  buf.writeUInt32LE(N, 107);

  const SCALE_XY = 0.000001;
  const SCALE_Z  = 0.001;
  const OFFSET_X = -133.0;
  const OFFSET_Y = 55.0;
  const OFFSET_Z = 0.0;

  buf.writeDoubleLE(SCALE_XY, 131);
  buf.writeDoubleLE(SCALE_XY, 139);
  buf.writeDoubleLE(SCALE_Z,  147);
  buf.writeDoubleLE(OFFSET_X, 155);
  buf.writeDoubleLE(OFFSET_Y, 163);
  buf.writeDoubleLE(OFFSET_Z, 171);

  for (let i = 0; i < N; i++) {
    const base = HEADER_SIZE + i * RECORD_SIZE;
    const { lon, lat, depth } = rawPts[i];
    buf.writeInt32LE(Math.round((lon - OFFSET_X) / SCALE_XY), base);
    buf.writeInt32LE(Math.round((lat - OFFSET_Y) / SCALE_XY), base + 4);
    buf.writeInt32LE(Math.round(-depth / SCALE_Z), base + 8);
    buf.writeUInt16LE(0, base + 12);
    buf.writeUInt8(0, base + 14);
    buf.writeUInt8(0, base + 15);
    buf.writeUInt8(0, base + 16);
    buf.writeUInt8(0, base + 17);
    buf.writeUInt16LE(0, base + 18);
  }

  return buf;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(__dir, { recursive: true });

  const tiffBuf = await buildGeoTiff();
  await writeFile(join(__dir, "survey.tif"), tiffBuf);
  console.log(`survey.tif   ${tiffBuf.length} bytes`);

  const ncBuf = buildNetCdf();
  await writeFile(join(__dir, "survey.nc"), ncBuf);
  console.log(`survey.nc    ${ncBuf.length} bytes`);

  const las12Buf = buildLas12();
  await writeFile(join(__dir, "survey_1_2.las"), las12Buf);
  console.log(`survey_1_2.las ${las12Buf.length} bytes`);

  const las14Buf = buildLas14();
  await writeFile(join(__dir, "survey_1_4.las"), las14Buf);
  console.log(`survey_1_4.las ${las14Buf.length} bytes`);

  const bagBuf = await buildBag();
  await writeFile(join(__dir, "survey.bag"), bagBuf);
  console.log(`survey.bag   ${bagBuf.length} bytes`);

  const lazBuf = buildLaz();
  await writeFile(join(__dir, "survey.laz"), lazBuf);
  console.log(`survey.laz   ${lazBuf.length} bytes`);

  console.log("All fixtures generated.");
}

main().catch((err) => { console.error(err); process.exit(1); });
