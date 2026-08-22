import { describe, expect, it } from "vitest";
import { PostMarkersBody, PatchMarkersIdBody } from "@workspace/api-zod";
import { validateMarkerGeometry } from "../markers.js";

const polygon = {
  version: 1 as const,
  kind: "area" as const,
  shape: "polygon" as const,
  vertices: [
    { lon: -136, lat: 58.5 },
    { lon: -135.9, lat: 58.5 },
    { lon: -135.9, lat: 58.6 },
  ],
};

const drift = {
  version: 1 as const,
  kind: "drift" as const,
  waypoints: [
    { lon: -136, lat: 58.5, recordedAt: "2026-01-01T00:00:00Z", depth: 20 },
    { lon: -135.9, lat: 58.6, recordedAt: "2026-01-01T00:10:00Z", depth: 25 },
  ],
  summary: {
    distanceM: 1000,
    durationS: 600,
    startAt: "2026-01-01T00:00:00Z",
    endAt: "2026-01-01T00:10:00Z",
    minDepth: 20,
    maxDepth: 25,
  },
};

describe("marker geometry contract", () => {
  it("accepts valid area and drift geometry in POST and PATCH bodies", () => {
    const base = { lon: -136, lat: 58.5, depth: 20, label: "mark" };
    expect(PostMarkersBody.safeParse({ ...base, geometry: polygon }).success).toBe(true);
    expect(PostMarkersBody.safeParse({ ...base, geometry: drift }).success).toBe(true);
    expect(PatchMarkersIdBody.safeParse({ geometry: polygon }).success).toBe(true);
  });

  it("preserves null legacy point semantics", () => {
    expect(validateMarkerGeometry(null)).toBeNull();
    expect(validateMarkerGeometry({ version: 1, kind: "point" })).toBeNull();
  });

  it("rejects degenerate polygons and invalid drift summaries", () => {
    expect(validateMarkerGeometry({
      ...polygon,
      vertices: [{ lon: 0, lat: 0 }, { lon: 1, lat: 1 }, { lon: 2, lat: 2 }],
    })).toMatch(/degenerate/);
    expect(validateMarkerGeometry({
      ...drift,
      summary: { ...drift.summary, endAt: "2025-12-31T23:59:00Z" },
    })).toMatch(/endAt/);
  });

  it("rejects impossible circles and out-of-range coordinates", () => {
    expect(validateMarkerGeometry({
      version: 1, kind: "area", shape: "circle",
      center: { lon: 0, lat: 0 }, radiusM: 0,
    })).toMatch(/radiusM/);
    expect(PostMarkersBody.safeParse({
      lon: 0, lat: 0, depth: 1, label: "mark",
      geometry: { ...polygon, vertices: [{ lon: 181, lat: 0 }, ...polygon.vertices.slice(1)] },
    }).success).toBe(false);
  });
});