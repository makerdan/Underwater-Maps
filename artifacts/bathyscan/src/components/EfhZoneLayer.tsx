/**
 * EfhZoneLayer — Essential Fish Habitat polygon outlines in the 3D R3F scene.
 *
 * Renders each EFH species zone as a flat LINE_LOOP polygon outline floating
 * slightly above the ocean surface (Y = 1.2), coloured by species.
 *
 * Only visible when efhOverlayEnabled is true in uiStore and the active dataset
 * has bundled EFH data (currently only "thorne-bay").
 *
 * Coordinate mapping mirrors lonLatToWorldXZ in terrain.ts:
 *   worldX = ((lon - minLon) / lonRange) * WORLD_SIZE - WORLD_SIZE / 2
 *   worldZ = ((lat - minLat) / latRange) * WORLD_SIZE - WORLD_SIZE / 2
 */
import React, { useMemo } from "react";
import * as THREE from "three";
import { useAppState } from "@/lib/context";
import { useUiStore } from "@/lib/uiStore";
import { WORLD_SIZE } from "@/lib/terrain";
import { useGetEfh, getGetEfhQueryKey } from "@workspace/api-client-react";
import type { EfhFeature } from "@workspace/api-client-react";

const EFH_DATASETS = new Set(["thorne-bay"]);
/** Y elevation for EFH zone outlines — float above ocean surface */
const EFH_ZONE_Y = 1.2;

function lonToWorldX(lon: number, minLon: number, lonRange: number): number {
  return ((lon - minLon) / lonRange) * WORLD_SIZE - WORLD_SIZE / 2;
}

function latToWorldZ(lat: number, minLat: number, latRange: number): number {
  return ((lat - minLat) / latRange) * WORLD_SIZE - WORLD_SIZE / 2;
}

/** Converts one GeoJSON Polygon ring to a closed THREE.BufferGeometry line loop. */
function ringToLineGeometry(
  ring: number[][],
  minLon: number, lonRange: number,
  minLat: number, latRange: number,
): THREE.BufferGeometry {
  const pts: number[] = [];
  for (const pt of ring) {
    const x = lonToWorldX(pt[0] ?? 0, minLon, lonRange);
    const z = latToWorldZ(pt[1] ?? 0, minLat, latRange);
    pts.push(x, EFH_ZONE_Y, z);
  }
  // Ensure the loop is closed by repeating the first point
  if (ring.length > 1) {
    const p = ring[0]!;
    pts.push(lonToWorldX(p[0] ?? 0, minLon, lonRange), EFH_ZONE_Y, latToWorldZ(p[1] ?? 0, minLat, latRange));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

/** One species zone: a line loop + its hex color. */
interface ZoneLine {
  geometry: THREE.BufferGeometry;
  color: string;
  commonName: string;
}

function buildZoneLines(
  features: EfhFeature[],
  minLon: number, maxLon: number,
  minLat: number, maxLat: number,
): ZoneLine[] {
  const lonRange = maxLon - minLon || 1;
  const latRange = maxLat - minLat || 1;
  const lines: ZoneLine[] = [];

  for (const feature of features) {
    const geom = feature.geometry as { type?: string; coordinates?: number[][][] };
    if (geom.type !== "Polygon" || !geom.coordinates?.[0]) continue;

    const geo = ringToLineGeometry(geom.coordinates[0], minLon, lonRange, minLat, latRange);
    lines.push({
      geometry: geo,
      color: feature.properties.color ?? "#00e5ff",
      commonName: feature.properties.commonName ?? feature.properties.species ?? "",
    });
  }
  return lines;
}

export const EfhZoneLayer: React.FC = () => {
  const { terrain } = useAppState();
  const efhOverlayEnabled = useUiStore((s) => s.efhOverlayEnabled);

  const datasetId = terrain?.datasetId ?? "";
  const hasEfh = EFH_DATASETS.has(datasetId);

  const { data: efhData } = useGetEfh(
    { datasetId },
    { query: { enabled: hasEfh && efhOverlayEnabled, queryKey: getGetEfhQueryKey({ datasetId }) } },
  );

  const zoneLines = useMemo(() => {
    if (!efhData?.features || !terrain) return [];
    return buildZoneLines(
      efhData.features,
      terrain.minLon, terrain.maxLon,
      terrain.minLat, terrain.maxLat,
    );
  }, [efhData, terrain]);

  if (!efhOverlayEnabled || !zoneLines.length) return null;

  return (
    <group name="efh-zones">
      {zoneLines.map((zone, i) => (
        <lineLoop key={i} geometry={zone.geometry}>
          <lineBasicMaterial
            color={zone.color}
            transparent
            opacity={0.85}
            linewidth={2}
          />
        </lineLoop>
      ))}
    </group>
  );
};
