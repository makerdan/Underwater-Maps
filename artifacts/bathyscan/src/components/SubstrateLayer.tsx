/**
 * SubstrateLayer — Alaska ShoreZone substrate polygons in the 3D R3F scene.
 *
 * Renders each substrate polygon (or sub-polygon of a MultiPolygon) as:
 *   - a semi-transparent filled ShapeGeometry draped just above the ocean
 *     surface, colored by CMECS substrate class (server `color`), and
 *   - a brighter LINE_LOOP outline floating slightly higher.
 *
 * Visibility is gated on `substrateColorMode` from uiStore — this is the
 * toggle the user sees as "SUBSTRATE" in the HUD. Clicking a fill mesh
 * sets `selectedSubstrate` in uiStore, which the HUD then renders as a
 * floating info card (class, CMECS code, raw ShoreZone descriptors,
 * approximate area, and the ShoreZone credit).
 *
 * Coordinate mapping mirrors lonLatToWorldXZ in terrain.ts, matching the
 * exact projection used by TerrainMesh and EfhZoneLayer.
 *
 * The component is intentionally rendered regardless of dataset id: the
 * server returns an empty FeatureCollection when no ShoreZone polygons
 * overlap the dataset AOI (e.g. Thorne Bay), in which case this layer
 * draws nothing — but the call still surfaces the `metadata.note` /
 * `nearestCoverage` info via the same API client, ready for future
 * use by an "out of coverage" badge.
 */
import React, { useEffect, useMemo, useCallback } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useAppState } from "@/lib/context";
import { useUiStore } from "@/lib/uiStore";
import { WORLD_SIZE } from "@/lib/terrain";
import {
  useGetSubstrate,
  getGetSubstrateQueryKey,
} from "@workspace/api-client-react";
import type {
  SubstrateFeature,
  SubstrateFeatureCollection,
} from "@workspace/api-client-react";

/** Y elevation for substrate filled polygons — just above ocean surface (Y=0). */
const FILL_Y = 0.6;
/** Y elevation for outlines — slightly above the fill so they are not z-fought. */
const OUTLINE_Y = 0.8;

function lonToWorldX(lon: number, minLon: number, lonRange: number): number {
  return ((lon - minLon) / lonRange) * WORLD_SIZE - WORLD_SIZE / 2;
}

function latToWorldZ(lat: number, minLat: number, latRange: number): number {
  return ((lat - minLat) / latRange) * WORLD_SIZE - WORLD_SIZE / 2;
}

function ringToLineGeometry(
  ring: number[][],
  minLon: number, lonRange: number,
  minLat: number, latRange: number,
): THREE.BufferGeometry {
  const pts: number[] = [];
  for (const pt of ring) {
    pts.push(
      lonToWorldX(pt[0] ?? 0, minLon, lonRange),
      OUTLINE_Y,
      latToWorldZ(pt[1] ?? 0, minLat, latRange),
    );
  }
  if (ring.length > 1) {
    const p = ring[0]!;
    pts.push(
      lonToWorldX(p[0] ?? 0, minLon, lonRange),
      OUTLINE_Y,
      latToWorldZ(p[1] ?? 0, minLat, latRange),
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

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
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, FILL_Y, 0);
  return geo;
}

interface PolyRender {
  fillGeometry: THREE.BufferGeometry | null;
  outlineGeometry: THREE.BufferGeometry;
  color: string;
  feature: SubstrateFeature;
}

function buildPolyRenders(
  features: SubstrateFeature[],
  minLon: number, maxLon: number,
  minLat: number, maxLat: number,
): PolyRender[] {
  const lonRange = maxLon - minLon || 1;
  const latRange = maxLat - minLat || 1;
  const out: PolyRender[] = [];

  for (const feature of features) {
    const geom = feature.geometry as
      | { type: "Polygon"; coordinates: number[][][] }
      | { type: "MultiPolygon"; coordinates: number[][][][] }
      | { type?: string };
    const color = feature.properties.color ?? "#e2d5a0";

    if (geom.type === "Polygon" && Array.isArray((geom as { coordinates?: unknown }).coordinates)) {
      const rings = (geom as { coordinates: number[][][] }).coordinates;
      const outer = rings[0];
      if (!outer) continue;
      out.push({
        fillGeometry: polygonToFillGeometry(rings, minLon, lonRange, minLat, latRange),
        outlineGeometry: ringToLineGeometry(outer, minLon, lonRange, minLat, latRange),
        color,
        feature,
      });
    } else if (
      geom.type === "MultiPolygon" &&
      Array.isArray((geom as { coordinates?: unknown }).coordinates)
    ) {
      const polys = (geom as { coordinates: number[][][][] }).coordinates;
      for (const rings of polys) {
        const outer = rings[0];
        if (!outer) continue;
        out.push({
          fillGeometry: polygonToFillGeometry(rings, minLon, lonRange, minLat, latRange),
          outlineGeometry: ringToLineGeometry(outer, minLon, lonRange, minLat, latRange),
          color,
          feature,
        });
      }
    }
  }
  return out;
}

export const SubstrateLayer: React.FC = () => {
  const { terrain } = useAppState();
  const substrateColorMode = useUiStore((s) => s.substrateColorMode);
  const setSelectedSubstrate = useUiStore((s) => s.setSelectedSubstrate);
  const selectedSubstrate = useUiStore((s) => s.selectedSubstrate);

  const datasetId = terrain?.datasetId ?? "";

  const { data: collection } = useGetSubstrate(
    datasetId,
    {
      query: {
        enabled: !!datasetId && substrateColorMode,
        queryKey: getGetSubstrateQueryKey(datasetId),
        staleTime: 5 * 60 * 1000,
      },
    },
  );

  const meta = (collection as SubstrateFeatureCollection | undefined)?.metadata as
    | { sourceName?: string; creditUrl?: string }
    | undefined;
  const sourceName = meta?.sourceName ?? "Alaska ShoreZone (NOAA AKR / ADF&G)";
  const creditUrl = meta?.creditUrl ?? "https://alaskafisheries.noaa.gov/shorezone/";

  const polys = useMemo(() => {
    if (!collection?.features?.length || !terrain) return [];
    return buildPolyRenders(
      collection.features,
      terrain.minLon, terrain.maxLon,
      terrain.minLat, terrain.maxLat,
    );
  }, [collection, terrain]);

  // Free GPU buffers when polys change or the component unmounts.
  useEffect(() => {
    return () => {
      for (const p of polys) {
        p.outlineGeometry.dispose();
        p.fillGeometry?.dispose();
      }
    };
  }, [polys]);

  const handleClick = useCallback(
    (feature: SubstrateFeature) => (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const props = feature.properties;
      setSelectedSubstrate({
        unitId: props.unitId,
        substrate: props.substrate,
        shoreZoneClass: props.shoreZoneClass,
        cmecsCode: props.cmecsCode,
        color: props.color,
        szMaterial: props.szMaterial ?? null,
        szForm: props.szForm ?? null,
        areaSqM: props.areaSqM ?? null,
        sourceName,
        creditUrl,
      });
    },
    [setSelectedSubstrate, sourceName, creditUrl],
  );

  if (!substrateColorMode || !polys.length) return null;

  return (
    <group name="substrate-polygons">
      {polys.map((p, i) => {
        const isSelected =
          selectedSubstrate?.unitId === p.feature.properties.unitId;
        return (
          <React.Fragment key={i}>
            {p.fillGeometry && (
              <mesh
                geometry={p.fillGeometry}
                renderOrder={2}
                onClick={handleClick(p.feature)}
              >
                <meshBasicMaterial
                  color={p.color}
                  transparent
                  opacity={isSelected ? 0.55 : 0.35}
                  depthWrite={false}
                  side={THREE.DoubleSide}
                />
              </mesh>
            )}
            <lineLoop geometry={p.outlineGeometry} renderOrder={3}>
              <lineBasicMaterial
                color={p.color}
                transparent
                opacity={isSelected ? 1.0 : 0.85}
                depthWrite={false}
                linewidth={2}
              />
            </lineLoop>
          </React.Fragment>
        );
      })}
    </group>
  );
};
