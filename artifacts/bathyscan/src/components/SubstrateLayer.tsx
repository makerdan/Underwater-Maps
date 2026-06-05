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
import React, { useEffect, useMemo, useCallback, useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import { useAppState } from "@/lib/context";
import { useUiStore } from "@/lib/uiStore";
import { useZoneOverlayStore, substrateClassToSlot } from "@/lib/zoneOverlayStore";
import { WORLD_SIZE } from "@/lib/terrain";
import {
  useGetSubstrate,
  getGetSubstrateQueryKey,
} from "@workspace/api-client-react";
import { useSubstrateErrorToast } from "@/hooks/useSubstrateErrorToast";
import { useSubstrateCoverageToast } from "@/hooks/useSubstrateCoverageToast";
import { useTerrainStore } from "@/lib/terrainStore";
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

/**
 * Pure helper: maps a single SubstrateFeature + collection-level metadata
 * onto the SelectedSubstrate shape written to uiStore on click.
 *
 * Exported so unit tests can exercise the 3D click-dispatch logic without
 * spinning up a React Three Fiber canvas.
 */
export function buildSelectedSubstrate(
  feature: SubstrateFeature,
  sourceName: string,
  creditUrl: string,
): import("@/lib/uiStore").SelectedSubstrate {
  const props = feature.properties;
  return {
    unitId: props.unitId,
    substrate: props.substrate,
    shoreZoneClass: props.shoreZoneClass,
    cmecsCode: props.cmecsCode,
    color: props.color,
    szMaterial: props.szMaterial ?? null,
    szForm: props.szForm ?? null,
    areaSqM: props.areaSqM ?? null,
    natsur: props.natsur ?? null,
    encChart: props.encChart ?? null,
    sourceName,
    creditUrl,
  };
}

interface PolyRender {
  fillGeometry: THREE.BufferGeometry | null;
  outlineGeometry: THREE.BufferGeometry;
  color: string;
  feature: SubstrateFeature;
  /** Stable React key: unitId + polygon-part index within the feature. */
  stableKey: string;
}

/** Render descriptor for a NOAA historical bottom-sample Point feature. */
interface PointRender {
  /** World-space X position (matching lonToWorldX). */
  worldX: number;
  /** World-space Z position (matching latToWorldZ). */
  worldZ: number;
  color: string;
  feature: SubstrateFeature;
  stableKey: string;
}

/**
 * Pure helper: filters a SubstrateFeature array down to the classes that are
 * NOT in `hiddenSubstrateClasses`.
 *
 * This is the exact filter the 3D SubstrateLayer applies inside its `useMemo`
 * before calling `buildPolyRenders`. Exported so unit tests exercise the same
 * code path the component uses — a regression here is immediately visible in
 * both the component and the tests.
 */
export function filterVisibleSubstrateFeatures(
  features: SubstrateFeature[],
  hiddenClasses: Set<string>,
): SubstrateFeature[] {
  return features.filter(
    (f) => !hiddenClasses.has(f.properties.substrate.toLowerCase()),
  );
}

/**
 * Pure helper: computes the zone-overlay render props for a single polygon.
 *
 * Mirrors the per-polygon decision block inside SubstrateLayer's JSX map:
 *   - When `zoneOverlayEnabled` is true, looks up the substrate's slot in
 *     `zoneSlots` and returns the slot colour as `colorOverride` plus the
 *     slot's `visible` flag ANDed with `classVisible` into `isVisible`.
 *   - When `zoneOverlayEnabled` is false, `colorOverride` is `undefined` and
 *     visibility is determined solely by `classVisible`.
 *
 * Exported so unit tests can exercise the exact production path without
 * spinning up a React Three Fiber canvas.
 */
export function computePolyZoneProps(
  substrate: string,
  classVisible: boolean,
  zoneOverlayEnabled: boolean,
  zoneSlots: readonly import("@/lib/zoneOverlayStore").ZoneSlot[],
): { colorOverride: string | undefined; isVisible: boolean } {
  let colorOverride: string | undefined;
  let zoneVisible = true;
  if (zoneOverlayEnabled) {
    const slot = substrateClassToSlot(substrate);
    const zoneSlot = zoneSlots[slot];
    if (zoneSlot) {
      colorOverride = zoneSlot.color;
      zoneVisible = zoneSlot.visible;
    }
  }
  return { colorOverride, isVisible: classVisible && zoneVisible };
}

/**
 * Pure helper: converts an array of SubstrateFeatures with Point geometry
 * into PointRender descriptors used to draw sample-point markers in the 3D scene.
 *
 * Polygon/MultiPolygon features are silently skipped; only Point features are
 * converted.  Exported for unit testing.
 */
export function buildPointMarkers(
  features: SubstrateFeature[],
  minLon: number, maxLon: number,
  minLat: number, maxLat: number,
): PointRender[] {
  const lonRange = maxLon - minLon || 1;
  const latRange = maxLat - minLat || 1;
  const out: PointRender[] = [];
  for (const feature of features) {
    const geom = feature.geometry as { type?: string; coordinates?: unknown };
    if (geom.type !== "Point" || !Array.isArray(geom.coordinates)) continue;
    const [lon, lat] = geom.coordinates as [number, number];
    out.push({
      worldX: lonToWorldX(lon ?? 0, minLon, lonRange),
      worldZ: latToWorldZ(lat ?? 0, minLat, latRange),
      color: feature.properties.color ?? "#888888",
      feature,
      stableKey: feature.properties.unitId,
    });
  }
  return out;
}

/**
 * Pure helper: converts an array of SubstrateFeatures (already filtered to
 * only the visible ones) into the PolyRender descriptors the 3D scene uses.
 *
 * Exported so unit tests can exercise the geometry-building step without
 * spinning up a React Three Fiber canvas.
 */
export function buildPolyRenders(
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
        stableKey: `${feature.properties.unitId}:0`,
      });
    } else if (
      geom.type === "MultiPolygon" &&
      Array.isArray((geom as { coordinates?: unknown }).coordinates)
    ) {
      const polys = (geom as { coordinates: number[][][][] }).coordinates;
      for (let pi = 0; pi < polys.length; pi++) {
        const rings = polys[pi]!;
        const outer = rings[0];
        if (!outer) continue;
        out.push({
          fillGeometry: polygonToFillGeometry(rings, minLon, lonRange, minLat, latRange),
          outlineGeometry: ringToLineGeometry(outer, minLon, lonRange, minLat, latRange),
          color,
          feature,
          stableKey: `${feature.properties.unitId}:${pi}`,
        });
      }
    }
  }
  return out;
}

/** Radius (world units) of the flat disc used for NOAA sample-point markers. */
const SAMPLE_POINT_RADIUS = 0.35;

/** Y elevation for NOAA sample point markers — just above the polygon fill. */
const POINT_Y = 0.9;

/**
 * Pre-built flat disc geometry shared by all sample-point markers (immutable).
 * Rotated flat (XZ plane) — world position Y is set per-instance on the mesh.
 */
const SAMPLE_DISC_GEO = new THREE.CircleGeometry(SAMPLE_POINT_RADIUS, 12);
SAMPLE_DISC_GEO.rotateX(-Math.PI / 2);

interface SubstratePointDotProps {
  pt: PointRender;
  isVisible: boolean;
  isSelected: boolean;
  onClick: (e: import("@react-three/fiber").ThreeEvent<MouseEvent>) => void;
}

/**
 * Renders a single NOAA historical bottom-sample point as a flat disc in the
 * 3D scene.  Uses a shared CircleGeometry so there is no per-point GPU alloc.
 */
const SubstratePointDot: React.FC<SubstratePointDotProps> = ({
  pt,
  isVisible,
  isSelected,
  onClick,
}) => {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const progress = useRef(isVisible ? 1 : 0);

  useFrame((_, delta) => {
    const target = isVisible ? 1 : 0;
    const cur = progress.current;
    if (cur === target) return;
    const step = delta / FADE_DURATION;
    progress.current = target > cur
      ? Math.min(cur + step, target)
      : Math.max(cur - step, target);
    if (matRef.current) {
      matRef.current.opacity = (isSelected ? 0.95 : 0.75) * progress.current;
    }
  });

  return (
    <mesh
      position={[pt.worldX, POINT_Y, pt.worldZ]}
      geometry={SAMPLE_DISC_GEO}
      visible={isVisible || progress.current > 0}
      renderOrder={6}
      onClick={isVisible ? onClick : undefined}
    >
      <meshBasicMaterial
        ref={matRef}
        color={pt.color}
        transparent
        opacity={(isSelected ? 0.95 : 0.75) * progress.current}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

/** Duration of the fade in/out animation in seconds. */
const FADE_DURATION = 0.15;

/** Fill opacity targets when fully visible. */
const FILL_OPACITY_NORMAL = 0.35;
const FILL_OPACITY_SELECTED = 0.55;

/** Outline opacity targets when fully visible. */
const OUTLINE_OPACITY_NORMAL = 0.85;
const OUTLINE_OPACITY_SELECTED = 1.0;

interface SubstratePolyProps {
  poly: PolyRender;
  isVisible: boolean;
  isSelected: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  /** When provided, overrides the polygon's server-side color with a user-chosen zone color. */
  colorOverride?: string;
}

/**
 * Renders one substrate polygon (fill + outline) with a smooth opacity
 * fade (~150 ms) when `isVisible` changes. GPU buffers are never disposed
 * on a simple visibility toggle — opacity is lerped via `useFrame` and
 * `visible` is only flipped off once the fade has fully completed.
 */
const SubstratePoly: React.FC<SubstratePolyProps> = ({
  poly,
  isVisible,
  isSelected,
  onClick,
  colorOverride,
}) => {
  const resolvedColor = colorOverride ?? poly.color;
  const fillRef = useRef<THREE.Mesh>(null);
  const lineRef = useRef<THREE.LineLoop>(null);

  // Tracks the current fade progress: 0 = fully hidden, 1 = fully visible.
  // Starts at the correct value to avoid a pop on first render.
  const progress = useRef(isVisible ? 1 : 0);

  useFrame((_, delta) => {
    const target = isVisible ? 1 : 0;
    const cur = progress.current;
    if (cur === target) return;

    const step = delta / FADE_DURATION;
    const next = target > cur
      ? Math.min(cur + step, target)
      : Math.max(cur - step, target);
    progress.current = next;

    const fillMat = fillRef.current?.material as THREE.MeshBasicMaterial | undefined;
    if (fillMat) {
      fillMat.opacity = (isSelected ? FILL_OPACITY_SELECTED : FILL_OPACITY_NORMAL) * next;
      if (fillRef.current) fillRef.current.visible = next > 0;
    }

    const lineMat = lineRef.current?.material as THREE.LineBasicMaterial | undefined;
    if (lineMat) {
      lineMat.opacity = (isSelected ? OUTLINE_OPACITY_SELECTED : OUTLINE_OPACITY_NORMAL) * next;
      if (lineRef.current) lineRef.current.visible = next > 0;
    }
  });

  const fillOpacity = (isSelected ? FILL_OPACITY_SELECTED : FILL_OPACITY_NORMAL) * progress.current;
  const outlineOpacity = (isSelected ? OUTLINE_OPACITY_SELECTED : OUTLINE_OPACITY_NORMAL) * progress.current;
  const everVisible = progress.current > 0;

  return (
    <React.Fragment>
      {poly.fillGeometry && (
        <mesh
          ref={fillRef}
          geometry={poly.fillGeometry}
          visible={everVisible}
          renderOrder={4}
          onClick={isVisible ? onClick : undefined}
        >
          <meshBasicMaterial
            color={resolvedColor}
            transparent
            opacity={fillOpacity}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      <lineLoop
        ref={lineRef}
        geometry={poly.outlineGeometry}
        visible={everVisible}
        renderOrder={5}
      >
        <lineBasicMaterial
          color={resolvedColor}
          transparent
          opacity={outlineOpacity}
          depthWrite={false}
          linewidth={2}
        />
      </lineLoop>
    </React.Fragment>
  );
};

export const SubstrateLayer: React.FC = () => {
  const { terrain } = useAppState();
  const substrateColorMode = useUiStore((s) => s.substrateColorMode);
  const zoneOverlayEnabled = useUiStore((s) => s.zoneOverlayEnabled);
  const setSelectedSubstrate = useUiStore((s) => s.setSelectedSubstrate);
  const selectedSubstrate = useUiStore((s) => s.selectedSubstrate);
  const hiddenSubstrateClasses = useUiStore((s) => s.hiddenSubstrateClasses);
  const zoneSlots = useZoneOverlayStore((s) => s.slots);

  const datasetId = terrain?.datasetId ?? "";
  const visibleDatasets = useTerrainStore((s) => s.visibleDatasets);
  // Multi-primary: enable the layer if ANY visible dataset is a user upload.
  const isUserDataset = visibleDatasets.some((v) => v.source === "user");

  const { data: collection, isError: substrateIsError } = useGetSubstrate(
    datasetId,
    {
      query: {
        enabled: !!datasetId && substrateColorMode,
        queryKey: getGetSubstrateQueryKey(datasetId),
        staleTime: 5 * 60 * 1000,
      },
    },
  );

  const substrateEnabled = !!datasetId && substrateColorMode;

  useSubstrateErrorToast({
    isError: substrateIsError,
    isEmpty: !substrateIsError && collection !== undefined && collection.features.length === 0,
    datasetId,
    enabled: substrateEnabled,
  });

  useSubstrateCoverageToast({
    hasFeatures: !substrateIsError && (collection?.features?.length ?? 0) > 0,
    isUserDataset,
    datasetId,
    enabled: substrateEnabled,
  });

  const meta = (collection as SubstrateFeatureCollection | undefined)?.metadata as
    | { sourceName?: string; creditUrl?: string }
    | undefined;
  const sourceName = meta?.sourceName ?? "Alaska ShoreZone (NOAA AKR / ADF&G)";
  const creditUrl = meta?.creditUrl ?? "https://alaskafisheries.noaa.gov/shorezone/";

  // Build geometry for ALL polygon features once. hiddenSubstrateClasses is intentionally
  // excluded from the deps — visibility is toggled via mesh.visible so GPU buffers
  // are never disposed and recreated on a simple filter change.
  const allPolys = useMemo(() => {
    if (!collection?.features?.length || !terrain) return [];
    return buildPolyRenders(
      collection.features,
      terrain.minLon, terrain.maxLon,
      terrain.minLat, terrain.maxLat,
    );
  }, [collection, terrain]);

  // Build point marker descriptors for NOAA historical bottom-sample Point features.
  const allPoints = useMemo(() => {
    if (!collection?.features?.length || !terrain) return [];
    return buildPointMarkers(
      collection.features,
      terrain.minLon, terrain.maxLon,
      terrain.minLat, terrain.maxLat,
    );
  }, [collection, terrain]);

  // Free GPU buffers only when the dataset changes or the component unmounts —
  // not on every legend filter toggle.
  useEffect(() => {
    return () => {
      for (const p of allPolys) {
        p.outlineGeometry.dispose();
        p.fillGeometry?.dispose();
      }
    };
  }, [allPolys]);

  const handleClick = useCallback(
    (feature: SubstrateFeature) => (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      setSelectedSubstrate(buildSelectedSubstrate(feature, sourceName, creditUrl));
    },
    [setSelectedSubstrate, sourceName, creditUrl],
  );

  if (!substrateColorMode || (!allPolys.length && !allPoints.length)) return null;

  return (
    <group name="substrate-polygons">
      {allPolys.map((p) => {
        const isSelected =
          selectedSubstrate?.unitId === p.feature.properties.unitId;
        const classVisible = !hiddenSubstrateClasses.has(
          p.feature.properties.substrate.toLowerCase(),
        );
        // When the zone overlay is active, also respect per-slot zone visibility.
        const { colorOverride, isVisible } = computePolyZoneProps(
          p.feature.properties.substrate,
          classVisible,
          zoneOverlayEnabled,
          zoneSlots,
        );
        return (
          <SubstratePoly
            key={p.stableKey}
            poly={p}
            isVisible={isVisible}
            isSelected={isSelected}
            onClick={handleClick(p.feature)}
            colorOverride={colorOverride}
          />
        );
      })}
      {allPoints.map((pt) => {
        const isSelected = selectedSubstrate?.unitId === pt.feature.properties.unitId;
        const classVisible = !hiddenSubstrateClasses.has(
          pt.feature.properties.substrate.toLowerCase(),
        );
        return (
          <SubstratePointDot
            key={pt.stableKey}
            pt={pt}
            isVisible={classVisible}
            isSelected={isSelected}
            onClick={handleClick(pt.feature)}
          />
        );
      })}
    </group>
  );
};
