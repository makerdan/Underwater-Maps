import { describe, it, expect } from "vitest";
import {
  serializeGpx,
  serializeKml,
  buildExportFilename,
  type ExportData,
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
