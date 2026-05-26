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
