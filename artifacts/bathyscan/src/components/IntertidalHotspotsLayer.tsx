/**
 * IntertidalHotspotsLayer — Tidepool & Beachcombing hotspot polygons in the 3D scene.
 *
 * Renders each scored intertidal polygon as:
 *   - a semi-transparent filled ShapeGeometry draped above Y=0 (ocean surface), colored by
 *     the active intertidalScoreMode: teal (#0d9488) for tidepool, amber (#d97706) for beachcombing.
 *   - a bright LINE_LOOP outline floating slightly above the fill.
 *
 * Opacity scales with score intensity (score/100), providing an at-a-glance heat map.
 * Only visible when intertidalHotspotsEnabled is true in uiStore.
 * Clicking a polygon sets selectedHotspot in uiStore → opens IntertidalHotspotCard.
 */
import React, { useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useAppState } from "@/lib/context";
import { useUiStore } from "@/lib/uiStore";
import type { SelectedHotspot } from "@/lib/uiStore";
import { WORLD_SIZE } from "@/lib/terrain";
import { useGetIntertidalSpots, getGetIntertidalSpotsQueryKey } from "@workspace/api-client-react";
import type { ThreeEvent } from "@react-three/fiber";

const FILL_Y = 1.5;
const OUTLINE_Y = 1.7;

const TIDEPOOL_COLOR = "#0d9488";
const BEACHCOMBING_COLOR = "#d97706";

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
  y: number,
): THREE.BufferGeometry {
  const pts: number[] = [];
  for (const pt of ring) {
    pts.push(lonToWorldX(pt[0] ?? 0, minLon, lonRange), y, latToWorldZ(pt[1] ?? 0, minLat, latRange));
  }
  if (ring.length > 1) {
    const p = ring[0]!;
    pts.push(lonToWorldX(p[0] ?? 0, minLon, lonRange), y, latToWorldZ(p[1] ?? 0, minLat, latRange));
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
  const toV2 = (pt: number[]) =>
    new THREE.Vector2(lonToWorldX(pt[0] ?? 0, minLon, lonRange), latToWorldZ(pt[1] ?? 0, minLat, latRange));
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

interface HotspotRender {
  fillGeometry: THREE.BufferGeometry | null;
  outlineGeometry: THREE.BufferGeometry;
  color: string;
  fillOpacity: number;
  outlineOpacity: number;
  hotspot: SelectedHotspot;
}

interface RawFeatureProps {
  unitId?: string;
  substrate?: string;
  shoreZoneClass?: string;
  szMaterial?: string | null;
  szForm?: string | null;
  tidepoolScore?: number;
  beachcombingScore?: number;
  scoreSignals?: {
    tidepool?: {
      substrate?: string;
      bioband?: string | null;
      debris?: string | null;
      energy?: string | null;
      humanUse?: string | null;
      whySummary?: string;
    };
    beachcombing?: {
      substrate?: string;
      bioband?: string | null;
      debris?: string | null;
      energy?: string | null;
      humanUse?: string | null;
      whySummary?: string;
    };
  };
}

function buildHotspotRenders(
  features: Array<{ geometry: unknown; properties: RawFeatureProps }>,
  minLon: number, maxLon: number,
  minLat: number, maxLat: number,
  sourceName: string,
  creditUrl: string,
  mode: 'tidepool' | 'beachcombing',
): HotspotRender[] {
  const lonRange = maxLon - minLon || 1;
  const latRange = maxLat - minLat || 1;
  const out: HotspotRender[] = [];

  for (const feature of features) {
    const p = feature.properties;
    const tidepoolScore = p.tidepoolScore ?? 0;
    const beachcombingScore = p.beachcombingScore ?? 0;

    const activeScore = mode === 'tidepool' ? tidepoolScore : beachcombingScore;
    if (activeScore < 1) continue;

    const geom = feature.geometry as { type?: string; coordinates?: unknown };
    let polygons: number[][][][] = [];
    if (geom.type === "Polygon") {
      const coords = geom.coordinates as number[][][] | undefined;
      if (coords?.[0]) polygons = [coords];
    } else if (geom.type === "MultiPolygon") {
      const coords = geom.coordinates as number[][][][] | undefined;
      if (coords) polygons = coords.filter((p) => p?.[0]);
    } else continue;

    const color = mode === 'tidepool' ? TIDEPOOL_COLOR : BEACHCOMBING_COLOR;
    const fillOpacity = Math.max(0.07, (activeScore / 100) * 0.32);
    const outlineOpacity = Math.max(0.45, (activeScore / 100) * 0.9);

    const sig = p.scoreSignals ?? {};
    const hotspot: SelectedHotspot = {
      unitId: p.unitId ?? "unknown",
      substrate: p.substrate ?? "",
      shoreZoneClass: p.shoreZoneClass ?? "",
      tidepoolScore,
      beachcombingScore,
      szMaterial: p.szMaterial ?? null,
      szForm: p.szForm ?? null,
      signals: {
        tidepool: {
          substrate: sig.tidepool?.substrate ?? p.shoreZoneClass ?? "",
          bioband: sig.tidepool?.bioband ?? null,
          debris: sig.tidepool?.debris ?? null,
          energy: sig.tidepool?.energy ?? null,
          humanUse: sig.tidepool?.humanUse ?? null,
          whySummary: sig.tidepool?.whySummary ?? "",
        },
        beachcombing: {
          substrate: sig.beachcombing?.substrate ?? p.shoreZoneClass ?? "",
          bioband: sig.beachcombing?.bioband ?? null,
          debris: sig.beachcombing?.debris ?? null,
          energy: sig.beachcombing?.energy ?? null,
          humanUse: sig.beachcombing?.humanUse ?? null,
          whySummary: sig.beachcombing?.whySummary ?? "",
        },
      },
      sourceName,
      creditUrl,
    };

    for (const rings of polygons) {
      const outerRing = rings[0];
      if (!outerRing) continue;
      const outline = ringToLineGeometry(outerRing, minLon, lonRange, minLat, latRange, OUTLINE_Y);
      const fill = polygonToFillGeometry(rings, minLon, lonRange, minLat, latRange);
      out.push({ fillGeometry: fill, outlineGeometry: outline, color, fillOpacity, outlineOpacity, hotspot });
    }
  }
  return out;
}

export const IntertidalHotspotsLayer: React.FC = () => {
  const { terrain } = useAppState();
  const intertidalHotspotsEnabled = useUiStore((s) => s.intertidalHotspotsEnabled);
  const intertidalScoreMode = useUiStore((s) => s.intertidalScoreMode);
  const setSelectedHotspot = useUiStore((s) => s.setSelectedHotspot);

  const datasetId = terrain?.datasetId ?? "";

  const spotsParams = { type: intertidalScoreMode, minScore: 10 };
  const { data: spotsData } = useGetIntertidalSpots(
    datasetId,
    spotsParams,
    {
      query: {
        enabled: !!datasetId && intertidalHotspotsEnabled,
        queryKey: getGetIntertidalSpotsQueryKey(datasetId, spotsParams),
      },
    },
  );

  const renders = useMemo(() => {
    if (!spotsData || !terrain) return [];
    const meta = (spotsData as { metadata?: { sourceName?: string; sourceCredit?: string } }).metadata;
    return buildHotspotRenders(
      spotsData.features as Array<{ geometry: unknown; properties: RawFeatureProps }>,
      terrain.minLon, terrain.maxLon,
      terrain.minLat, terrain.maxLat,
      meta?.sourceName ?? "NOAA ShoreZone / AOOS",
      meta?.sourceCredit ?? "https://portal.aoos.org/",
      intertidalScoreMode,
    );
  }, [spotsData, terrain, intertidalScoreMode]);

  useEffect(() => {
    return () => {
      for (const r of renders) {
        r.outlineGeometry.dispose();
        r.fillGeometry?.dispose();
      }
    };
  }, [renders]);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      const hs = (e.object.userData?.hotspot ?? null) as SelectedHotspot | null;
      if (!hs) return;
      e.stopPropagation();
      setSelectedHotspot(hs);
    },
    [setSelectedHotspot],
  );

  if (!intertidalHotspotsEnabled || !renders.length) return null;

  return (
    <group name="intertidal-hotspots">
      {renders.map((r, i) => (
        <React.Fragment key={i}>
          {r.fillGeometry && (
            <mesh
              geometry={r.fillGeometry}
              renderOrder={4}
              userData={{ hotspot: r.hotspot }}
              onClick={handleClick}
              onPointerOver={() => { document.body.style.cursor = "pointer"; }}
              onPointerOut={() => { document.body.style.cursor = ""; }}
            >
              <meshBasicMaterial
                color={r.color}
                transparent
                opacity={r.fillOpacity}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>
          )}
          <lineLoop geometry={r.outlineGeometry} renderOrder={5}>
            <lineBasicMaterial
              color={r.color}
              transparent
              opacity={r.outlineOpacity}
              depthWrite={false}
              linewidth={2}
            />
          </lineLoop>
        </React.Fragment>
      ))}
    </group>
  );
};
