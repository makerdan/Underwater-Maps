/**
 * NonPrimaryDatasetMeshes — renders every visible-but-not-primary dataset
 * inside the primary's world coordinate system. Each non-primary mesh occupies
 * world units [-WORLD_SIZE/2, WORLD_SIZE/2] in its own frame; we wrap it in
 * a <group> that scales + translates that frame so its geographic footprint
 * lines up with the primary's footprint.
 *
 * Y alignment: each TerrainMesh internally normalises its own depth range to
 * [0, -MAX_DEPTH_WORLD] (sea-surface depth=minDepth at y=0, deepest at
 * y=-MAX_DEPTH_WORLD). To make a non-primary mesh read at its true ocean
 * depth relative to the primary, we re-scale and offset Y so equal world-Y
 * distances correspond to equal meters across all datasets, and y=0 always
 * represents depth=primary.minDepth.
 *
 *   worldY(depth) = (primary.minDepth - depth) / primaryDepthRange * MAX
 *   localY(depth) = -(depth - g.minDepth)     / gDepthRange       * MAX
 *
 * Solving for worldY in terms of localY gives:
 *   yScale  = gDepthRange / primaryDepthRange
 *   yOffset = (primary.minDepth - g.minDepth) / primaryDepthRange * MAX
 *
 * Envelope policy: the primary mesh occupies world-Y [0, -MAX_DEPTH_WORLD],
 * and a solid floor closes off everything below -MAX_DEPTH_WORLD. When a
 * secondary dataset is dramatically deeper (or shallower) than the primary,
 * the natural yScale/yOffset above can drive the mesh below the floor or
 * above the water surface, producing a sliver-or-tower that reads as broken.
 * To keep visuals legible we apply two clamps in order:
 *   1. Cap yScale at 1 so the secondary's vertical extent never exceeds the
 *      primary's world envelope (compressing exaggeration for very deep
 *      datasets — they lose true-depth correspondence but stay readable).
 *   2. Clamp yOffset so the mesh sits inside [0, -MAX_DEPTH_WORLD], moving
 *      it as close to its natural position as possible. The mesh is biased
 *      toward the floor when it would have extended deeper, and toward the
 *      surface when it would have extended above it.
 *
 * TidalContents is accepted as an optional component prop rather than
 * imported directly. This breaks the circular dependency that would exist if
 * TidalSceneContents (defined in TourScene) were imported here, and it keeps
 * this module independently testable.
 */
import React from "react";
import type { ComponentType } from "react";
import type { TerrainData } from "@workspace/api-client-react";
import type { TidalDataResult } from "@/hooks/useTidalData";
import type { DepthLayer } from "@/components/TidalCurrentArrows";
import { TerrainMesh } from "@/components/TerrainMesh";
import { LandmassMesh } from "@/components/LandmassMesh";
import { useTerrainStore } from "@/lib/terrainStore";
import {
  WORLD_SIZE,
  MAX_DEPTH_WORLD,
  normalizeLonDelta,
  type WaterSurface,
} from "@/lib/terrain";

// ---------------------------------------------------------------------------
// computeLatCorrectedLonScale
// ---------------------------------------------------------------------------
/**
 * Compute the X-axis scale for a secondary dataset mesh relative to the
 * primary dataset, correcting for latitude-dependent longitude compression.
 *
 * At high latitudes, 1° of longitude spans fewer metres than 1° of latitude.
 * A raw degree ratio (secLonRange / primaryLonRange) ignores this and produces
 * a horizontally-stretched mesh. The fix multiplies each span by
 * cos(midpointLatRad) before dividing, converting angular spans to
 * proportional linear distances at the respective midpoints.
 *
 * @param secLonRange   - Secondary dataset longitude span in degrees
 * @param secAvgLatRad  - Secondary dataset midpoint latitude in radians
 * @param primLonRange  - Primary dataset longitude span in degrees
 * @param primAvgLatRad - Primary dataset midpoint latitude in radians
 */
export function computeLatCorrectedLonScale(
  secLonRange: number,
  secAvgLatRad: number,
  primLonRange: number,
  primAvgLatRad: number,
): number {
  const denom = (primLonRange * Math.cos(primAvgLatRad)) || 1;
  return (secLonRange * Math.cos(secAvgLatRad)) / denom;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Minimal shape of TidalSceneContents' props, used for the optional TidalContents slot. */
export interface TidalContentsProps {
  tidalData: TidalDataResult | null;
  depthLayer: DepthLayer;
  terrain: TerrainData;
  waterSurface: WaterSurface;
  depthBias?: boolean;
}

export interface NonPrimaryDatasetMeshesProps {
  /** The active primary dataset — used as the reference coordinate frame. */
  primary: TerrainData;
  showLandmass: boolean;
  /** Per-dataset tidal data, keyed by datasetId. Used with TidalContents. */
  tidalDataMap?: Map<string, TidalDataResult>;
  /**
   * When true, TidalContents is rendered for each secondary dataset that has
   * tidal data. Requires TidalContents to be provided.
   */
  tidalOverlay?: boolean;
  depthLayer?: DepthLayer;
  waterSurface?: WaterSurface;
  /**
   * Optional component to render tidal scene contents for each secondary
   * dataset. Provided by TourScene as TidalSceneContents; omitted in tests so
   * tidal rendering is skipped without extra mocking.
   */
  TidalContents?: ComponentType<TidalContentsProps>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const NonPrimaryDatasetMeshes: React.FC<NonPrimaryDatasetMeshesProps> = ({
  primary,
  showLandmass,
  tidalDataMap,
  tidalOverlay,
  depthLayer = "surface",
  waterSurface = { visible: true, y: 0 },
  TidalContents,
}) => {
  const visible = useTerrainStore((s) => s.visibleDatasets);

  // Derive the primary dataset ID from the `primary` prop rather than reading
  // store.primaryDatasetId separately. The two sources update in different
  // React renders during a primary switch, causing a one-frame window where the
  // filter and the reference geometry are inconsistent. Using primary.datasetId
  // keeps filter + geometry reference in sync within a single render.
  const primaryId = primary.datasetId;

  // Normalize lon spans to handle antimeridian-crossing bounding boxes.
  const primaryLonRange = Math.abs(normalizeLonDelta(primary.maxLon - primary.minLon)) || 1;
  const primaryLatRange = (primary.maxLat - primary.minLat) || 1;
  const primaryDepthRange = (primary.maxDepth - primary.minDepth) || 1;

  return (
    <>
      {visible
        .filter((v) => v.datasetId !== primaryId && v.activeGrid)
        .map((v) => {
          const g = v.activeGrid as TerrainData;

          // Normalize lon span: handles antimeridian-crossing bboxes where
          // maxLon < minLon would otherwise yield a negative or ≈360° range.
          const secLonRange = Math.abs(normalizeLonDelta(g.maxLon - g.minLon)) || 1;
          const secLatRange = (g.maxLat - g.minLat) || 1;
          const secDepthRange = (g.maxDepth - g.minDepth) || 1;

          // Latitude-corrected longitude scale: degrees of longitude shrink
          // as lat increases (width ∝ cos(lat)). Multiply each dataset's lon
          // span by cos(midpoint lat) to convert from angular to proportional
          // linear distance before dividing, so secondary meshes at high
          // latitudes are not horizontally stretched.
          const primaryAvgLatRad = ((primary.minLat + primary.maxLat) / 2) * (Math.PI / 180);
          const secAvgLatRad = ((g.minLat + g.maxLat) / 2) * (Math.PI / 180);
          const xScale = computeLatCorrectedLonScale(secLonRange, secAvgLatRad, primaryLonRange, primaryAvgLatRad);
          const zScale = secLatRange / primaryLatRange;
          const naturalYScale = secDepthRange / primaryDepthRange;

          const secCenterLon = (g.minLon + g.maxLon) / 2;
          const secCenterLat = (g.minLat + g.maxLat) / 2;
          const primCenterLon = (primary.minLon + primary.maxLon) / 2;
          const primCenterLat = (primary.minLat + primary.maxLat) / 2;

          // normalizeLonDelta folds the raw difference into [−180, +180] so that
          // a secondary dataset on the opposite side of the ±180° antimeridian
          // from the primary is placed at the correct short offset (~10°) rather
          // than a full-globe translation (~350°). Without this normalization,
          // the raw difference wraps to ≈±360° — approximately a full globe
          // width in world units — whenever the two centers straddle the dateline.
          const cx = (normalizeLonDelta(secCenterLon - primCenterLon) / primaryLonRange) * WORLD_SIZE;
          const cz = -((secCenterLat - primCenterLat) / primaryLatRange) * WORLD_SIZE;
          const naturalCy =
            ((primary.minDepth - g.minDepth) / primaryDepthRange) * MAX_DEPTH_WORLD;

          // Envelope clamp (see header comment): cap vertical extent to the
          // primary's world envelope, then slide the mesh into [-MAX, 0].
          const yScale = Math.min(naturalYScale, 1);
          const extent = yScale * MAX_DEPTH_WORLD;
          const cyMin = extent - MAX_DEPTH_WORLD; // lower bound: bottom rests on floor
          const cyMax = 0;                         // upper bound: top rests at surface
          const cy = Math.max(cyMin, Math.min(cyMax, naturalCy));

          // Multi-primary: tidal overlay for this secondary dataset (if data available)
          const secTidalData = tidalDataMap?.get(v.datasetId) ?? null;

          return (
            <group
              key={v.datasetId}
              name={v.datasetId}
              position={[cx, cy, cz]}
              scale={[xScale, yScale, zScale]}
            >
              <TerrainMesh grid={g} depthBias />
              {showLandmass && <LandmassMesh grid={g} depthBias />}
              {tidalOverlay && secTidalData && TidalContents && (
                <TidalContents
                  tidalData={secTidalData}
                  depthLayer={depthLayer}
                  terrain={g}
                  waterSurface={waterSurface}
                  depthBias
                />
              )}
            </group>
          );
        })}
    </>
  );
};
