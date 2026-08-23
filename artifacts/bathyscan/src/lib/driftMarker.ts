import type { Marker, MarkerGeometry } from "@workspace/api-client-react";
import type { DriftWaypoint } from "./driftStore";

export type DriftMarkerGeometry = Extract<MarkerGeometry, { kind: "drift" }>;

export function isDriftMarker(marker: Pick<Marker, "geometry">): marker is Marker & { geometry: DriftMarkerGeometry } {
  return marker.geometry?.kind === "drift" &&
    Array.isArray(marker.geometry.waypoints) &&
    marker.geometry.waypoints.length >= 2 &&
    marker.geometry.waypoints.every((p) =>
      Number.isFinite(p.lon) && Number.isFinite(p.lat) &&
      Number.isFinite(p.depth) && typeof p.recordedAt === "string");
}

export function driftGeometryFromPath(path: DriftWaypoint[], startAt: Date = new Date()): DriftMarkerGeometry | null {
  if (path.length < 2) return null;
  const valid = path.filter((p) =>
    Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
    Number.isFinite(p.hookDepthM) && Number.isFinite(p.hour));
  if (valid.length < 2) return null;
  const points = valid.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    depth: Math.max(0, p.hookDepthM),
    recordedAt: new Date(startAt.getTime() + p.hour * 3600000).toISOString(),
  }));
  let distanceM = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const meanLat = ((a.lat + b.lat) / 2) * Math.PI / 180;
    const dLat = (b.lat - a.lat) * 111_132;
    const dLon = (b.lon - a.lon) * 111_132 * Math.cos(meanLat);
    distanceM += Math.hypot(dLat, dLon);
  }
  const depths = points.map((p) => p.depth);
  const endAt = new Date(startAt.getTime() + ((valid[valid.length - 1]!.hour + 1) * 3600000));
  return {
    version: 1,
    kind: "drift",
    waypoints: points,
    summary: {
      distanceM,
      durationS: Math.max(0, (endAt.getTime() - startAt.getTime()) / 1000),
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      minDepth: Math.min(...depths),
      maxDepth: Math.max(...depths),
    },
  };
}

export function sampleDriftWaypoints(geometry: DriftMarkerGeometry, maxPoints = 48) {
  const points = geometry.waypoints;
  if (points.length <= maxPoints) return points;
  const stride = (points.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => points[Math.round(i * stride)]!).filter(Boolean);
}