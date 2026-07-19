import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import ExcelJS from "exceljs";
import {
  parseGpx,
  parseKml,
  parseKmz,
  parseCsv,
  parseExcel,
  parseGpsFile,
  partitionByBounds,
  countPoints,
  isInBounds,
  applyColumnAssignment,
  MAX_IMPORT_POINTS,
  type RawColumnMeta,
} from "../lib/gpsImport";

const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="11.35" lon="142.5">
    <ele>-10500</ele>
    <name>Challenger</name>
    <desc>Deepest known point</desc>
    <sym>fish</sym>
  </wpt>
  <wpt lat="11.40" lon="142.55">
    <name>Sibling</name>
  </wpt>
  <rte>
    <name>Survey leg</name>
    <rtept lat="11.30" lon="142.45"/>
    <rtept lat="11.32" lon="142.48"/>
    <rtept lat="11.34" lon="142.50"/>
  </rte>
  <trk>
    <name>Drift track</name>
    <trkseg>
      <trkpt lat="11.20" lon="142.40"/>
      <trkpt lat="11.22" lon="142.42"/>
    </trkseg>
    <trkseg>
      <trkpt lat="11.24" lon="142.44"/>
    </trkseg>
  </trk>
</gpx>`;

const SAMPLE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Wreck A</name>
      <description>Just a description</description>
      <Point><coordinates>142.5,11.35,-50</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Trail</name>
      <LineString>
        <coordinates>
          142.50,11.30,0
          142.52,11.32,0
          142.54,11.34,0
        </coordinates>
      </LineString>
    </Placemark>
    <Placemark>
      <name>Bad point</name>
      <Point><coordinates>not,a,coord</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;

const SAMPLE_CSV = `lat,lon,name,depth,type,notes
11.35,142.5,Challenger,10500,fish,deepest
11.40,142.55,Sibling,,,
not_a_number,142.6,Bad,,,
,,,,,
11.50,142.65,"Quoted, name",100,custom,"has, comma"`;

// ---------------------------------------------------------------------------
// Helpers for building in-memory Excel workbooks
// ---------------------------------------------------------------------------

async function makeXlsxFile(
  rows: (string | number | null)[][],
  sheetName = "Sheet1",
): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  for (const row of rows) {
    sheet.addRow(row.map((v) => (v === null ? undefined : v)));
  }
  const buf = await workbook.xlsx.writeBuffer();
  return new File([buf], "test.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Returns a dummy .xls File — content is irrelevant since we reject before parsing. */
function makeXlsFile(): File {
  return new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], "test.xls", {
    type: "application/vnd.ms-excel",
  });
}

// ---------------------------------------------------------------------------
// GPX
// ---------------------------------------------------------------------------

describe("parseGpx", () => {
  it("extracts waypoints with name, depth (flipped from elevation), and notes", () => {
    const r = parseGpx(SAMPLE_GPX);
    expect(r.waypoints).toHaveLength(2);
    const wp = r.waypoints[0]!;
    expect(wp.lat).toBe(11.35);
    expect(wp.lon).toBe(142.5);
    expect(wp.name).toBe("Challenger");
    expect(wp.notes).toBe("Deepest known point");
    expect(wp.type).toBe("fish");
    // ele=-10500 → depth = -ele = 10500 (positive = below surface)
    expect(wp.depth).toBe(10500);
    expect(wp.source).toBe("waypoint");
  });

  it("extracts routes from <rte>", () => {
    const r = parseGpx(SAMPLE_GPX);
    const route = r.routes.find((rr) => rr.source === "route");
    expect(route).toBeTruthy();
    expect(route!.name).toBe("Survey leg");
    expect(route!.points).toHaveLength(3);
    expect(route!.points[0]).toMatchObject({ lat: 11.3, lon: 142.45 });
  });

  it("extracts tracks from <trk> with all segments flattened", () => {
    const r = parseGpx(SAMPLE_GPX);
    const track = r.routes.find((rr) => rr.source === "track");
    expect(track).toBeTruthy();
    expect(track!.name).toBe("Drift track");
    expect(track!.points).toHaveLength(3);
  });

  it("throws a descriptive error on malformed XML", () => {
    expect(() => parseGpx("<gpx><wpt")).toThrow(/parse/i);
  });
});

// ---------------------------------------------------------------------------
// KML
// ---------------------------------------------------------------------------

describe("parseKml", () => {
  it("extracts Point placemarks as waypoints with KML altitude flipped to depth", () => {
    const r = parseKml(SAMPLE_KML);
    expect(r.waypoints).toHaveLength(1);
    const wp = r.waypoints[0]!;
    expect(wp.lat).toBe(11.35);
    expect(wp.lon).toBe(142.5);
    expect(wp.name).toBe("Wreck A");
    expect(wp.notes).toBe("Just a description");
    // alt=-50 → depth = -alt = 50
    expect(wp.depth).toBe(50);
  });

  it("extracts LineString placemarks as routes", () => {
    const r = parseKml(SAMPLE_KML);
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0]!.name).toBe("Trail");
    expect(r.routes[0]!.points).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// KMZ
// ---------------------------------------------------------------------------

describe("parseKmz", () => {
  it("unzips and parses the bundled .kml file", async () => {
    const zipped = zipSync({ "doc.kml": strToU8(SAMPLE_KML) });
    const r = await parseKmz(zipped.buffer as ArrayBuffer);
    expect(r.waypoints).toHaveLength(1);
    expect(r.routes).toHaveLength(1);
  });

  it("rejects archives with no .kml entry", async () => {
    const zipped = zipSync({ "junk.txt": strToU8("hello") });
    await expect(parseKmz(zipped.buffer as ArrayBuffer)).rejects.toThrow(/no \.kml/i);
  });
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe("parseCsv", () => {
  it("parses header-detected lat/lon plus optional columns", () => {
    const { result: r } = parseCsv(SAMPLE_CSV);
    expect(r.waypoints).toHaveLength(3); // bad numeric row + empty row are skipped
    const first = r.waypoints[0]!;
    expect(first.lat).toBe(11.35);
    expect(first.lon).toBe(142.5);
    expect(first.name).toBe("Challenger");
    expect(first.depth).toBe(10500);
    expect(first.type).toBe("fish");
    expect(first.notes).toBe("deepest");
  });

  it("handles quoted fields containing commas", () => {
    const { result: r } = parseCsv(SAMPLE_CSV);
    const quoted = r.waypoints.find((w) => w.lat === 11.5)!;
    expect(quoted.name).toBe("Quoted, name");
    expect(quoted.notes).toBe("has, comma");
  });

  it("returns empty waypoints (not throws) when no lat/lon columns are present", () => {
    const { result, meta } = parseCsv("foo,bar\n1,2");
    expect(result.waypoints).toHaveLength(0);
    expect(meta.columns).toHaveLength(2);
    expect(meta.columns[0]).toEqual({ header: "foo", mappedAlias: null });
    expect(meta.fileType).toBe("csv");
  });

  it("flips elevation to depth when no depth column is present", () => {
    const csv = "lat,lon,elevation\n11.35,142.5,-1234";
    const { result: r } = parseCsv(csv);
    expect(r.waypoints[0]!.depth).toBe(1234);
  });

  it("emits RawColumnMeta with resolved aliases", () => {
    const { meta } = parseCsv("lat,lon,name,depth,custom_col\n11.35,142.5,Test,10,extra");
    expect(meta.columns).toHaveLength(5);
    expect(meta.columns[0]).toEqual({ header: "lat", mappedAlias: "lat" });
    expect(meta.columns[1]).toEqual({ header: "lon", mappedAlias: "lon" });
    expect(meta.columns[2]).toEqual({ header: "name", mappedAlias: "name" });
    expect(meta.columns[3]).toEqual({ header: "depth", mappedAlias: "depth" });
    expect(meta.columns[4]).toEqual({ header: "custom_col", mappedAlias: null });
  });

  it("includes up to 5 sample rows in meta", () => {
    const rows = ["lat,lon"];
    for (let i = 0; i < 8; i++) rows.push(`${11 + i * 0.1},142.5`);
    const { meta } = parseCsv(rows.join("\n"));
    expect(meta.sampleRows).toHaveLength(5);
    expect(meta.sampleRows[0]).toEqual({ lat: "11", lon: "142.5" });
  });
});

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

describe("parseExcel", () => {
  it("parses standard column names and returns correct waypoints", async () => {
    const file = await makeXlsxFile([
      ["lat", "lon", "name", "depth"],
      [11.35, 142.5, "Challenger", 10500],
      [11.4, 142.55, "Sibling", null],
    ]);
    const { result } = await parseExcel(file);
    expect(result.waypoints).toHaveLength(2);
    const wp = result.waypoints[0]!;
    expect(wp.lat).toBe(11.35);
    expect(wp.lon).toBe(142.5);
    expect(wp.name).toBe("Challenger");
    expect(wp.depth).toBe(10500);
    expect(wp.source).toBe("waypoint");
    expect(result.routes).toHaveLength(0);
  });

  it("auto-maps aliased column names (latitude/longitude)", async () => {
    const file = await makeXlsxFile([
      ["latitude", "longitude", "label"],
      [11.35, 142.5, "WP1"],
    ]);
    const { result } = await parseExcel(file);
    expect(result.waypoints).toHaveLength(1);
    expect(result.waypoints[0]!.lat).toBe(11.35);
    expect(result.waypoints[0]!.lon).toBe(142.5);
    expect(result.waypoints[0]!.name).toBe("WP1");
  });

  it("auto-maps 'y'/'x' aliases for lat/lon", async () => {
    const file = await makeXlsxFile([
      ["y", "x"],
      [11.35, 142.5],
    ]);
    const { result } = await parseExcel(file);
    expect(result.waypoints).toHaveLength(1);
    expect(result.waypoints[0]!.lat).toBe(11.35);
    expect(result.waypoints[0]!.lon).toBe(142.5);
  });

  it("returns empty waypoints (not throws) when lat column is missing", async () => {
    const file = await makeXlsxFile([
      ["longitude", "name"],
      [142.5, "Test"],
    ]);
    const { result, meta } = await parseExcel(file);
    expect(result.waypoints).toHaveLength(0);
    expect(meta.columns.some((c) => c.mappedAlias === "lon")).toBe(true);
    expect(meta.columns.some((c) => c.mappedAlias === "lat")).toBe(false);
    expect(meta.fileType).toBe("excel");
  });

  it("returns empty waypoints (not throws) when lon column is missing", async () => {
    const file = await makeXlsxFile([
      ["lat", "name"],
      [11.35, "Test"],
    ]);
    const { result, meta } = await parseExcel(file);
    expect(result.waypoints).toHaveLength(0);
    expect(meta.columns.some((c) => c.mappedAlias === "lat")).toBe(true);
    expect(meta.columns.some((c) => c.mappedAlias === "lon")).toBe(false);
  });

  it("skips rows with out-of-range or non-numeric coordinates", async () => {
    const file = await makeXlsxFile([
      ["lat", "lon", "name"],
      [11.35, 142.5, "Good"],
      ["not_a_number", 142.6, "Bad lat"],
      [200, 142.5, "Out of range lat"],
      [11.35, 200, "Out of range lon"],
      [11.4, 142.55, "Also good"],
    ]);
    const { result } = await parseExcel(file);
    expect(result.waypoints).toHaveLength(2);
    expect(result.waypoints.map((w) => w.name)).toEqual(["Good", "Also good"]);
  });

  it("uses the first non-empty sheet in a multi-sheet workbook", async () => {
    const workbook = new ExcelJS.Workbook();
    const ws1 = workbook.addWorksheet("First");
    ws1.addRow(["lat", "lon"]);
    ws1.addRow([11.35, 142.5]);
    const ws2 = workbook.addWorksheet("Second");
    ws2.addRow(["lat", "lon"]);
    ws2.addRow([11.4, 142.55]);
    const buf = await workbook.xlsx.writeBuffer();
    const file = new File([buf], "multi.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const { result } = await parseExcel(file);
    expect(result.waypoints).toHaveLength(1);
    expect(result.waypoints[0]!.lat).toBe(11.35);
  });

  it("throws for empty workbook / worksheet with no data", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Empty");
    const buf = await workbook.xlsx.writeBuffer();
    const file = new File([buf], "empty.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await expect(parseExcel(file)).rejects.toThrow(/no data|no worksheet/i);
  });

  it("emits RawColumnMeta with correct alias mapping", async () => {
    const file = await makeXlsxFile([
      ["lat", "lon", "notes", "custom_col"],
      [11.35, 142.5, "A note", "extra"],
    ]);
    const { meta } = await parseExcel(file);
    expect(meta.columns).toHaveLength(4);
    expect(meta.columns[0]).toEqual({ header: "lat", mappedAlias: "lat" });
    expect(meta.columns[1]).toEqual({ header: "lon", mappedAlias: "lon" });
    expect(meta.columns[2]).toEqual({ header: "notes", mappedAlias: "notes" });
    expect(meta.columns[3]).toEqual({ header: "custom_col", mappedAlias: null });
  });

  it("includes up to 5 sample rows in meta", async () => {
    const dataRows: (string | number)[][] = [];
    for (let i = 0; i < 8; i++) dataRows.push([11 + i * 0.1, 142.5]);
    const file = await makeXlsxFile([["lat", "lon"], ...dataRows]);
    const { meta } = await parseExcel(file);
    expect(meta.sampleRows).toHaveLength(5);
  });

  it("rejects .xls with clear user-facing error message", async () => {
    const file = makeXlsFile();
    await expect(parseExcel(file)).rejects.toThrow(
      "Legacy .xls format is not supported — please save as .xlsx and try again.",
    );
  });

  it("flips elevation to depth when no depth column is present", async () => {
    const file = await makeXlsxFile([
      ["lat", "lon", "elevation"],
      [11.35, 142.5, -1234],
    ]);
    const { result } = await parseExcel(file);
    expect(result.waypoints[0]!.depth).toBe(1234);
  });

  it("prototype-pollution probe — __proto__ column header does not mutate Object.prototype", async () => {
    const sentinel = (Object.prototype as Record<string, unknown>)["injected"];
    const file = await makeXlsxFile([
      ["lat", "lon", "__proto__"],
      [11.35, 142.5, "polluted"],
    ]);
    await parseExcel(file);
    expect((Object.prototype as Record<string, unknown>)["injected"]).toBe(sentinel);
    expect((Object.prototype as Record<string, unknown>)["injected"]).toBeUndefined();
  });

  it("ReDoS guard — oversized cell string parses in finite time", async () => {
    const bigString = "a".repeat(100_000);
    const file = await makeXlsxFile([
      ["lat", "lon", "notes"],
      [11.35, 142.5, bigString],
    ]);
    const start = Date.now();
    const { result } = await parseExcel(file);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(result.waypoints).toHaveLength(1);
    expect(result.waypoints[0]!.notes).toBe(bigString);
  });
});

// ---------------------------------------------------------------------------
// parseGpsFile
// ---------------------------------------------------------------------------

describe("parseGpsFile", () => {
  it("dispatches by file extension and returns result + meta", async () => {
    const file = new File([SAMPLE_GPX], "trip.gpx", { type: "application/gpx+xml" });
    const { result, meta } = await parseGpsFile(file);
    expect(result.waypoints.length).toBe(2);
    expect(meta.columns).toHaveLength(0);
    expect(meta.sampleRows).toHaveLength(0);
  });

  it("returns meta with columns for CSV files", async () => {
    const file = new File([SAMPLE_CSV], "points.csv", { type: "text/csv" });
    const { meta } = await parseGpsFile(file);
    expect(meta.columns.length).toBeGreaterThan(0);
    expect(meta.columns[0]).toEqual({ header: "lat", mappedAlias: "lat" });
  });

  it("dispatches .xlsx files to parseExcel", async () => {
    const xlsxFile = await makeXlsxFile([
      ["lat", "lon", "name"],
      [11.35, 142.5, "Test"],
    ]);
    const { result, meta } = await parseGpsFile(xlsxFile);
    expect(result.waypoints).toHaveLength(1);
    expect(meta.columns[0]).toEqual({ header: "lat", mappedAlias: "lat" });
  });

  it("rejects .xls files with clear user-facing error message", async () => {
    const xlsFile = makeXlsFile();
    await expect(parseGpsFile(xlsFile)).rejects.toThrow(
      "Legacy .xls format is not supported — please save as .xlsx and try again.",
    );
  });

  it("rejects unsupported extensions", async () => {
    const file = new File(["{}"], "data.json", { type: "application/json" });
    await expect(parseGpsFile(file)).rejects.toThrow(/Unsupported/);
  });

  it("rejects files with no parseable coordinates", async () => {
    const empty = `<?xml version="1.0"?><gpx></gpx>`;
    const file = new File([empty], "empty.gpx");
    await expect(parseGpsFile(file)).rejects.toThrow(/No parseable/);
  });

  it("enforces the per-import point cap", async () => {
    const rows = ["lat,lon"];
    for (let i = 0; i < MAX_IMPORT_POINTS + 5; i++) {
      rows.push(`${(i * 0.0001).toFixed(4)},${(i * 0.0001).toFixed(4)}`);
    }
    const file = new File([rows.join("\n")], "big.csv");
    await expect(parseGpsFile(file)).rejects.toThrow(/Too many/);
  });

  it("does not throw when CSV has unrecognised columns (needs mapping step)", async () => {
    // POS_LAT / POS_LON / WAYPOINT_NAME are not in any alias group
    const csv = "POS_LAT,POS_LON,WAYPOINT_NAME\n11.35,142.5,Challenger";
    const file = new File([csv], "nonstandard.csv", { type: "text/csv" });
    const { result, meta } = await parseGpsFile(file);
    expect(result.waypoints).toHaveLength(0);
    expect(meta.columns).toHaveLength(3);
    expect(meta.columns.every((c) => c.mappedAlias === null)).toBe(true);
    expect(meta.fileType).toBe("csv");
    expect(meta.allRows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// partitionByBounds
// ---------------------------------------------------------------------------

describe("partitionByBounds", () => {
  const bounds = { minLon: 142.45, minLat: 11.30, maxLon: 142.6, maxLat: 11.45 };

  it("splits waypoints into inside / outside counts", () => {
    const r = parseGpx(SAMPLE_GPX);
    const part = partitionByBounds(r, bounds);
    // Challenger (142.5/11.35) inside; Sibling (142.55/11.40) inside; track points outside lat<11.30
    expect(part.inside.waypoints).toHaveLength(2);
    expect(part.outsideWaypoints).toBe(0);
  });

  it("keeps a route when ≥2 of its points fall inside the box", () => {
    const r = parseGpx(SAMPLE_GPX);
    const part = partitionByBounds(r, bounds);
    // Survey leg: all 3 points inside → kept whole.
    // Drift track: all 3 points at lat 11.20–11.24 < 11.30 → entire route dropped.
    const kept = part.inside.routes.map((rr) => rr.name);
    expect(kept).toContain("Survey leg");
    expect(kept).not.toContain("Drift track");
    expect(part.outsideRoutes).toBe(1);
    expect(part.outsideRoutePoints).toBe(3); // Drift track's 3 points
    expect(part.inside.routes.find((rr) => rr.name === "Survey leg")!.points)
      .toHaveLength(3);
  });

  it("trims out-of-bounds points from a partially-in-bounds route", () => {
    // 5-point route: 2 inside, 3 outside. Expect a 2-point route with the
    // outside coordinates NEVER appearing in the inside result.
    const mixed = parseGpx(`<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte><name>Mixed</name>
    <rtept lat="11.35" lon="142.50"/>
    <rtept lat="10.00" lon="100.00"/>
    <rtept lat="11.40" lon="142.55"/>
    <rtept lat="80.00" lon="-90.00"/>
    <rtept lat="-5.00" lon="0.00"/>
  </rte>
</gpx>`);
    const part = partitionByBounds(mixed, bounds);
    expect(part.inside.routes).toHaveLength(1);
    const kept = part.inside.routes[0]!;
    expect(kept.points).toHaveLength(2);
    expect(kept.points).toEqual([
      { lat: 11.35, lon: 142.5 },
      { lat: 11.4, lon: 142.55 },
    ]);
    // Crucially, none of the off-map coordinates leak through.
    for (const p of kept.points) {
      expect(isInBounds(p.lon, p.lat, bounds)).toBe(true);
    }
    expect(part.outsideRoutePoints).toBe(3);
    expect(part.outsideRoutes).toBe(0);
  });

  it("drops a route when fewer than 2 points survive bounds trimming", () => {
    // 4-point route with only 1 point inside → not a viable preset, drop entirely.
    const sparse = parseGpx(`<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte><name>Sparse</name>
    <rtept lat="11.35" lon="142.50"/>
    <rtept lat="10.00" lon="100.00"/>
    <rtept lat="80.00" lon="-90.00"/>
    <rtept lat="-5.00" lon="0.00"/>
  </rte>
</gpx>`);
    const part = partitionByBounds(sparse, bounds);
    expect(part.inside.routes).toHaveLength(0);
    expect(part.outsideRoutes).toBe(1);
    // 3 truly outside + 1 lonely inside that couldn't be salvaged.
    expect(part.outsideRoutePoints).toBe(4);
  });

  it("isInBounds is inclusive on the box edges", () => {
    expect(isInBounds(142.45, 11.30, bounds)).toBe(true);
    expect(isInBounds(142.44, 11.30, bounds)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// countPoints
// ---------------------------------------------------------------------------

describe("countPoints", () => {
  it("sums waypoints and all route/track points", () => {
    const r = parseGpx(SAMPLE_GPX);
    // 2 waypoints + 3 route points + 3 track points = 8
    expect(countPoints(r)).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// applyColumnAssignment
// ---------------------------------------------------------------------------

function makeMeta(
  headers: string[],
  dataRows: Record<string, string>[],
): RawColumnMeta {
  return {
    columns: headers.map((h) => ({ header: h, mappedAlias: null })),
    sampleRows: dataRows.slice(0, 5),
    allRows: dataRows,
    fileType: "csv",
  };
}

describe("applyColumnAssignment", () => {
  const rows: Record<string, string>[] = [
    { LATI: "11.35", LONG: "142.5", WAYPOINT_NAME: "Challenger", DEPTH_M: "10500", CAT: "fish", NOTES: "deep" },
    { LATI: "11.40", LONG: "142.55", WAYPOINT_NAME: "Sibling", DEPTH_M: "", CAT: "", NOTES: "" },
    { LATI: "not_a_number", LONG: "142.6", WAYPOINT_NAME: "Bad", DEPTH_M: "", CAT: "", NOTES: "" },
    { LATI: "", LONG: "", WAYPOINT_NAME: "Empty", DEPTH_M: "", CAT: "", NOTES: "" },
  ];
  const meta = makeMeta(["LATI", "LONG", "WAYPOINT_NAME", "DEPTH_M", "CAT", "NOTES"], rows);

  it("maps non-standard columns to lat/lon and returns correct waypoints", () => {
    const result = applyColumnAssignment(meta, {
      lat: "LATI",
      lon: "LONG",
      name: "WAYPOINT_NAME",
      depth: "DEPTH_M",
      type: "CAT",
      notes: "NOTES",
    });
    expect(result.waypoints).toHaveLength(2);
    const first = result.waypoints[0]!;
    expect(first.lat).toBe(11.35);
    expect(first.lon).toBe(142.5);
    expect(first.name).toBe("Challenger");
    expect(first.depth).toBe(10500);
    expect(first.type).toBe("fish");
    expect(first.notes).toBe("deep");
    expect(first.source).toBe("waypoint");
  });

  it("skips rows with non-finite or out-of-range coordinates", () => {
    const result = applyColumnAssignment(meta, {
      lat: "LATI",
      lon: "LONG",
      name: null,
      depth: null,
      type: null,
      notes: null,
    });
    expect(result.waypoints).toHaveLength(2);
  });

  it("returns empty result when lat or lon assignment is null", () => {
    const result = applyColumnAssignment(meta, {
      lat: null,
      lon: "LONG",
      name: null,
      depth: null,
      type: null,
      notes: null,
    });
    expect(result.waypoints).toHaveLength(0);
    expect(result.routes).toHaveLength(0);
  });

  it("skips optional fields when assignment is null", () => {
    const result = applyColumnAssignment(meta, {
      lat: "LATI",
      lon: "LONG",
      name: null,
      depth: null,
      type: null,
      notes: null,
    });
    expect(result.waypoints).toHaveLength(2);
    expect(result.waypoints[0]!.name).toBeUndefined();
    expect(result.waypoints[0]!.depth).toBeUndefined();
  });

  it("treats the assigned depth column as depth (no sign flip)", () => {
    const depthRows = [{ LAT: "11.35", LON: "142.5", D: "100" }];
    const depthMeta = makeMeta(["LAT", "LON", "D"], depthRows);
    const result = applyColumnAssignment(depthMeta, {
      lat: "LAT",
      lon: "LON",
      name: null,
      depth: "D",
      type: null,
      notes: null,
    });
    expect(result.waypoints[0]!.depth).toBe(100);
  });
});
