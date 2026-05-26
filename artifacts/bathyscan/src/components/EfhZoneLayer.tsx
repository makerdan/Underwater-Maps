/**
 * EfhZoneLayer — Essential Fish Habitat polygons in the 3D R3F scene.
 *
 * Renders each EFH species zone as both:
 *   - a semi-transparent filled polygon (ShapeGeometry) draped just above the
 *     ocean surface, colored by species, and
 *   - a brighter LINE_LOOP outline floating slightly higher.
 *
 * Colors and alphas mirror the OverviewMap 2D legend (fill ≈ 0.18 alpha,
 * outline ≈ 0.85 alpha), so the same species reads as the same hue in both
 * views.
 *
 * Only visible when efhOverlayEnabled is true in uiStore and the active dataset
 * has bundled EFH data.
 *
 * Coordinate mapping mirrors lonLatToWorldXZ in terrain.ts:
 *   worldX = ((lon - minLon) / lonRange) * WORLD_SIZE - WORLD_SIZE / 2
 *   worldZ = ((lat - minLat) / latRange) * WORLD_SIZE - WORLD_SIZE / 2
 */
import React, { useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useAppState } from "@/lib/context";
import { useUiStore } from "@/lib/uiStore";
import { WORLD_SIZE } from "@/lib/terrain";
import {
  useGetEfh,
  getGetEfhQueryKey,
  useGetDatasets,
  getGetDatasetsQueryKey,
} from "@workspace/api-client-react";
import type { EfhFeature, EfhSpeciesProperties } from "@workspace/api-client-react";
import { useSettingsStore } from "@/lib/settingsStore";
import type { ThreeEvent } from "@react-three/fiber";
/** Y elevation for EFH filled polygons — just above ocean surface (Y=0). */
const EFH_FILL_Y = 1.0;
/** Y elevation for EFH outlines — slightly above the fill so they are not z-fought. */
const EFH_OUTLINE_Y = 1.2;

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
    pts.push(x, EFH_OUTLINE_Y, z);
  }
  // Ensure the loop is closed by repeating the first point
  if (ring.length > 1) {
    const p = ring[0]!;
    pts.push(
      lonToWorldX(p[0] ?? 0, minLon, lonRange),
      EFH_OUTLINE_Y,
      latToWorldZ(p[1] ?? 0, minLat, latRange),
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

/**
 * Build a flat horizontal ShapeGeometry from a GeoJSON polygon (outer ring +
 * optional holes). The returned geometry lies in the XZ plane at Y = EFH_FILL_Y.
 */
function polygonToFillGeometry(
  rings: number[][][],
  minLon: number, lonRange: number,
  minLat: number, latRange: number,
): THREE.BufferGeometry | null {
  const outer = rings[0];
  if (!outer || outer.length < 3) return null;

  const toV2 = (pt: number[]): THREE.Vector2 =>
    new THREE.Vector2(
      lonToWorldX(pt[0] ?? 0, minLon, lonRange),
      latToWorldZ(pt[1] ?? 0, minLat, latRange),
    );

  const shape = new THREE.Shape(outer.map(toV2));
  for (let i = 1; i < rings.length; i++) {
    const hole = rings[i];
    if (!hole || hole.length < 3) continue;
    shape.holes.push(new THREE.Path(hole.map(toV2)));
  }

  const geo = new THREE.ShapeGeometry(shape);
  // ShapeGeometry produces vertices in the XY plane (Z=0). Lay it flat in the
  // world XZ plane at Y = EFH_FILL_Y. The Vector2.y values above were lat→Z,
  // so rotating −π/2 around X moves them into +Z and gives the right facing.
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, EFH_FILL_Y, 0);
  return geo;
}

/** One species zone: a fill mesh + line loop + its hex color. */
interface ZoneRender {
  fillGeometry: THREE.BufferGeometry | null;
  outlineGeometry: THREE.BufferGeometry;
  color: string;
  commonName: string;
  /** Full species properties used to populate the EfhDetailPanel on click. */
  properties: EfhSpeciesProperties;
}

function buildZoneRenders(
  features: EfhFeature[],
  minLon: number, maxLon: number,
  minLat: number, maxLat: number,
): ZoneRender[] {
  const lonRange = maxLon - minLon || 1;
  const latRange = maxLat - minLat || 1;
  const out: ZoneRender[] = [];

  for (const feature of features) {
    const geom = feature.geometry as {
      type?: string;
      coordinates?: number[][][] | number[][][][];
    };

    // Normalize Polygon and MultiPolygon to a single list of polygons, where each
    // polygon is an array of rings (rings[0] is the outer ring, rings[1..] are holes).
    let polygons: number[][][][] = [];
    if (geom.type === "Polygon") {
      const coords = geom.coordinates as number[][][] | undefined;
      if (coords?.[0]) polygons = [coords];
    } else if (geom.type === "MultiPolygon") {
      const coords = geom.coordinates as number[][][][] | undefined;
      if (coords) polygons = coords.filter((p) => p?.[0]);
    } else {
      continue;
    }

    for (const rings of polygons) {
      const outerRing = rings[0];
      if (!outerRing) continue;
      const outline = ringToLineGeometry(outerRing, minLon, lonRange, minLat, latRange);
      const fill = polygonToFillGeometry(rings, minLon, lonRange, minLat, latRange);
      out.push({
        fillGeometry: fill,
        outlineGeometry: outline,
        color: feature.properties.color ?? "#00e5ff",
        commonName: feature.properties.commonName ?? feature.properties.species ?? "",
        properties: feature.properties,
      });
    }
  }
  return out;
}

export const EfhZoneLayer: React.FC = () => {
  const { terrain } = useAppState();
  const efhOverlayEnabled = useUiStore((s) => s.efhOverlayEnabled);
  const setSelectedEfh = useUiStore((s) => s.setSelectedEfh);

  const datasetId = terrain?.datasetId ?? "";

  // For user-saved noaa-efh-* datasets, the polygons are embedded directly in
  // the terrain response under `habitatPolygons` — no secondary /efh fetch needed.
  const embeddedPolygons = terrain?.habitatPolygons ?? null;

  const waterTypeForDatasets = useSettingsStore((s) => s.waterType);
  const { data: allDatasets } = useGetDatasets(
    { waterType: waterTypeForDatasets },
    { query: { queryKey: getGetDatasetsQueryKey({ waterType: waterTypeForDatasets }) } },
  );
  const hasEfh = !!allDatasets?.find((d) => d.id === datasetId)?.hasEfh;

  // Only fetch from /efh for preset datasets (hasEfh flag). For user-saved EFH
  // datasets the polygons arrive via `habitatPolygons` on the terrain object.
  const { data: efhData } = useGetEfh(
    { datasetId },
    { query: { enabled: hasEfh && efhOverlayEnabled && !embeddedPolygons, queryKey: getGetEfhQueryKey({ datasetId }) } },
  );

  // Prefer embedded polygons (user-saved datasets) over the fetched preset data.
  const activeFeatures = embeddedPolygons?.features ?? efhData?.features ?? null;

  const zones = useMemo(() => {
    if (!activeFeatures || !terrain) return [];
    return buildZoneRenders(
      activeFeatures,
      terrain.minLon, terrain.maxLon,
      terrain.minLat, terrain.maxLat,
    );
  }, [activeFeatures, terrain]);

  // Free GPU buffers when zones change or the component unmounts
  useEffect(() => {
    return () => {
      for (const z of zones) {
        z.outlineGeometry.dispose();
        z.fillGeometry?.dispose();
      }
    };
  }, [zones]);

  // Single stable click handler — pulls the species properties off the
  // intersected mesh's userData so we don't have to rebuild a closure per
  // zone on every render.
  const handleZoneClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      const props = (e.object.userData?.efhProperties ?? null) as
        | EfhSpeciesProperties
        | null;
      if (!props) return;
      // Stop the click from also dispatching to terrain / other layers
      // beneath the zone — otherwise the fly-controls' onClick would fire
      // and yank the camera around the moment the user inspects a zone.
      e.stopPropagation();
      setSelectedEfh(props);
    },
    [setSelectedEfh],
  );

  if (!efhOverlayEnabled || !zones.length) return null;

  return (
    <group name="efh-zones">
      {zones.map((zone, i) => (
        <React.Fragment key={i}>
          {zone.fillGeometry && (
            <mesh
              geometry={zone.fillGeometry}
              renderOrder={2}
              userData={{ efhProperties: zone.properties }}
              onClick={handleZoneClick}
              onPointerOver={() => { document.body.style.cursor = "pointer"; }}
              onPointerOut={() => { document.body.style.cursor = ""; }}
            >
              <meshBasicMaterial
                color={zone.color}
                transparent
                opacity={0.18}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>
          )}
          <lineLoop geometry={zone.outlineGeometry} renderOrder={3}>
            <lineBasicMaterial
              color={zone.color}
              transparent
              opacity={0.85}
              depthWrite={false}
              linewidth={2}
            />
          </lineLoop>
        </React.Fragment>
      ))}
    </group>
  );
};
