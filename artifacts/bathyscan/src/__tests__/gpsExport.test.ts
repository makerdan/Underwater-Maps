import { describe, it, expect } from "vitest";
import {
  serializeGpx,
  serializeKml,
  serializeTrailsGpx,
  buildExportFilename,
  type ExportData,
  type ExportTrail,
} from "../lib/gpsExport";
import { parseGpx, parseKml } from "../lib/gpsImport";

const SAMPLE: ExportData = {
  datasetName: "Mariana Trench Survey",
  markers: [
    {
      lon: 142.5,
      lat: 11.35,
      depth: 10500,
      label: "Challenger Deep",
      type: "fish",
      notes: "Deepest point",
    },
    {
      lon: 142.55,
      lat: 11.4,
      depth: 0,
      label: 'Surface "buoy" & co',
      type: "custom",
      notes: null,
    },
  ],
  routes: [
    {
      name: "Survey leg",
      points: [
        { lon: 142.45, lat: 11.3 },
        { lon: 142.48, lat: 11.32 },
        { lon: 142.5, lat: 11.34 },
      ],
    },
  ],
};

describe("serializeGpx", () => {
  it("renders waypoints and routes that re-parse cleanly", () => {
    const xml = serializeGpx(SAMPLE);
    expect(xml).toContain("<?xml");
    expect(xml).toContain("<gpx ");
    const parsed = parseGpx(xml);
    expect(parsed.waypoints).toHaveLength(2);
    expect(parsed.waypoints[0]!.name).toBe("Challenger Deep");
    // depth (positive) ↔ ele (negative)
    expect(parsed.waypoints[0]!.depth).toBe(10500);
    expect(parsed.routes).toHaveLength(1);
    expect(parsed.routes[0]!.name).toBe("Survey leg");
    expect(parsed.routes[0]!.points).toHaveLength(3);
  });

  it("escapes XML-special characters in labels", () => {
    const xml = serializeGpx(SAMPLE);
    expect(xml).toContain("&quot;buoy&quot;");
    expect(xml).toContain("&amp;");
  });
});

describe("serializeKml", () => {
  it("renders points and linestrings that re-parse cleanly", () => {
    const xml = serializeKml(SAMPLE);
    const parsed = parseKml(xml);
    expect(parsed.waypoints).toHaveLength(2);
    expect(parsed.waypoints[0]!.name).toBe("Challenger Deep");
    expect(parsed.routes).toHaveLength(1);
    expect(parsed.routes[0]!.points).toHaveLength(3);
  });
});

describe("serializeGpx — null/undefined input guards", () => {
  it("does not throw when a marker has null label and null notes", () => {
    const data: ExportData = {
      datasetName: "Test",
      markers: [
        {
          lon: 10,
          lat: 20,
          depth: 5,
          label: null as unknown as string,
          type: null as unknown as string,
          notes: null,
        },
      ],
      routes: [],
    };
    expect(() => serializeGpx(data)).not.toThrow();
    const xml = serializeGpx(data);
    expect(xml).toContain("<wpt ");
  });

  it("does not throw when a marker has undefined label", () => {
    const data: ExportData = {
      datasetName: "Test",
      markers: [
        {
          lon: 10,
          lat: 20,
          depth: 5,
          label: undefined as unknown as string,
          type: "custom",
        },
      ],
      routes: [],
    };
    expect(() => serializeGpx(data)).not.toThrow();
  });

  it("does not throw when a route has null name", () => {
    const data: ExportData = {
      datasetName: "Test",
      markers: [],
      routes: [
        {
          name: null as unknown as string,
          points: [
            { lon: 1, lat: 2 },
            { lon: 3, lat: 4 },
          ],
        },
      ],
    };
    expect(() => serializeGpx(data)).not.toThrow();
  });

  it("outputs '0' (not NaN) for non-finite coordinates and does not throw", () => {
    const data: ExportData = {
      datasetName: "Test",
      markers: [
        {
          lon: NaN,
          lat: Infinity,
          depth: NaN,
          label: "Bad coords",
          type: "custom",
        },
      ],
      routes: [],
    };
    expect(() => serializeGpx(data)).not.toThrow();
    const xml = serializeGpx(data);
    // NaN/Infinity coordinates fall back to "0"
    expect(xml).toContain('lat="0"');
    expect(xml).toContain('lon="0"');
  });
});

describe("serializeKml — null/undefined input guards", () => {
  it("does not throw when a marker has null label", () => {
    const data: ExportData = {
      datasetName: "Test",
      markers: [
        {
          lon: 10,
          lat: 20,
          depth: 5,
          label: null as unknown as string,
          type: "custom",
        },
      ],
      routes: [],
    };
    expect(() => serializeKml(data)).not.toThrow();
  });

  it("does not throw when a route name is null", () => {
    const data: ExportData = {
      datasetName: "Test",
      markers: [],
      routes: [
        {
          name: null as unknown as string,
          points: [
            { lon: 1, lat: 2 },
            { lon: 3, lat: 4 },
          ],
        },
      ],
    };
    expect(() => serializeKml(data)).not.toThrow();
  });
});

describe("serializeTrailsGpx", () => {
  const TRAIL: ExportTrail = {
    id: "t1",
    name: "Morning drift",
    colour: "#ff6600",
    points: [
      { lon: 142.5, lat: 11.35, timestamp: Date.UTC(2026, 0, 15, 8, 0, 0) },
      { lon: 142.51, lat: 11.36, timestamp: Date.UTC(2026, 0, 15, 8, 0, 10) },
    ],
  };

  it("emits <trk><trkseg><trkpt> with lat/lon and ISO <time> per point", () => {
    const xml = serializeTrailsGpx([TRAIL]);
    expect(xml).toContain("<trk>");
    expect(xml).toContain("<name>Morning drift</name>");
    expect(xml).toContain("<trkseg>");
    expect(xml.match(/<trkpt /g)).toHaveLength(2);
    expect(xml).toContain('lat="11.3500000"');
    expect(xml).toContain('lon="142.5000000"');
    expect(xml).toContain("<time>2026-01-15T08:00:00.000Z</time>");
    expect(xml).toContain("<time>2026-01-15T08:00:10.000Z</time>");
    // Well-formed nesting order.
    expect(xml.indexOf("<trk>")).toBeLessThan(xml.indexOf("<trkseg>"));
    expect(xml.indexOf("<trkseg>")).toBeLessThan(xml.indexOf("<trkpt "));
    expect(xml.indexOf("</trkseg>")).toBeLessThan(xml.indexOf("</trk>"));
  });

  it("returns an empty string for no trails", () => {
    expect(serializeTrailsGpx([])).toBe("");
  });

  it("escapes XML-special characters in trail names", () => {
    const xml = serializeTrailsGpx([{ ...TRAIL, name: 'Reef <&> "run"' }]);
    expect(xml).toContain("<name>Reef &lt;&amp;&gt; &quot;run&quot;</name>");
  });

  it("omits <time> for non-finite timestamps without throwing", () => {
    const xml = serializeTrailsGpx([
      {
        ...TRAIL,
        points: [{ lon: 1, lat: 2, timestamp: NaN }],
      },
    ]);
    expect(xml).toContain("<trkpt ");
    expect(xml).not.toContain("<time>");
  });

  it("full GPX document with trails re-parses cleanly (round-trip)", () => {
    const xml = serializeGpx({ ...SAMPLE, trails: [TRAIL] });
    expect(xml).toContain("<trk>");
    // Track elements come after routes per the GPX 1.1 schema order.
    expect(xml.indexOf("</rte>")).toBeLessThan(xml.indexOf("<trk>"));
    const parsed = parseGpx(xml);
    // The importer flattens <trk> segments into route entries.
    expect(parsed.waypoints).toHaveLength(2);
    const track = parsed.routes.find((r) => r.name === "Morning drift");
    expect(track).toBeDefined();
    expect(track!.points).toHaveLength(2);
    expect(track!.points[0]!.lat).toBeCloseTo(11.35, 6);
    expect(track!.points[0]!.lon).toBeCloseTo(142.5, 6);
  });

  it("KML export includes selected trails as LineStrings", () => {
    const xml = serializeKml({ ...SAMPLE, trails: [TRAIL] });
    const parsed = parseKml(xml);
    // 1 route + 1 trail = 2 line placemarks.
    expect(parsed.routes).toHaveLength(2);
  });
});

describe("buildExportFilename", () => {
  it("uses dataset slug + ISO date + extension", () => {
    const fn = buildExportFilename(
      "Mariana Trench",
      "gpx",
      new Date("2025-03-04T12:00:00Z"),
    );
    expect(fn).toMatch(/^Mariana-Trench-\d{4}-\d{2}-\d{2}\.gpx$/);
  });

  it("falls back to bathyscan when the name has no usable chars", () => {
    expect(buildExportFilename("///", "kml", new Date("2025-01-01")))
      .toMatch(/^bathyscan-\d{4}-\d{2}-\d{2}\.kml$/);
  });
});
