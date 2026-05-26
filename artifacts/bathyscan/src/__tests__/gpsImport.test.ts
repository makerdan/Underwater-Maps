import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  parseGpx,
  parseKml,
  parseKmz,
  parseCsv,
  parseGpsFile,
  partitionByBounds,
  countPoints,
  isInBounds,
  MAX_IMPORT_POINTS,
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

describe("parseCsv", () => {
  it("parses header-detected lat/lon plus optional columns", () => {
    const r = parseCsv(SAMPLE_CSV);
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
    const r = parseCsv(SAMPLE_CSV);
    const quoted = r.waypoints.find((w) => w.lat === 11.5)!;
    expect(quoted.name).toBe("Quoted, name");
    expect(quoted.notes).toBe("has, comma");
  });

  it("throws when no lat/lon columns are present", () => {
    expect(() => parseCsv("foo,bar\n1,2")).toThrow(/lat/i);
  });

  it("flips elevation to depth when no depth column is present", () => {
    const csv = "lat,lon,elevation\n11.35,142.5,-1234";
    const r = parseCsv(csv);
    expect(r.waypoints[0]!.depth).toBe(1234);
  });
});

describe("parseGpsFile", () => {
  it("dispatches by file extension", async () => {
    const file = new File([SAMPLE_GPX], "trip.gpx", { type: "application/gpx+xml" });
    const r = await parseGpsFile(file);
    expect(r.waypoints.length).toBe(2);
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
});

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

describe("countPoints", () => {
  it("sums waypoints and all route/track points", () => {
    const r = parseGpx(SAMPLE_GPX);
    // 2 waypoints + 3 route points + 3 track points = 8
    expect(countPoints(r)).toBe(8);
  });
});
