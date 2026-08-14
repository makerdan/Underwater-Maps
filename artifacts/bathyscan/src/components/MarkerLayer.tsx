/**
 * MarkerLayer — fetches all markers for every visible dataset and renders
 * a MarkerSprite for each one inside the Three.js scene.
 *
 * Multi-primary: fans out useGetMarkers across all visible datasets (up to
 * VISIBLE_DATASETS_CAP = 4) and merges results. Each marker is placed in its
 * own dataset's coordinate frame (not the primary's): MarkerSprite receives
 * the activeGrid for the marker's datasetId so lonLatToWorldXZ uses the
 * correct bbox. Markers whose dataset has no loaded grid are suppressed with
 * a dev-mode console warning rather than placed using the wrong frame.
 *
 * When puzzle mode is active in the Overview Map, markers follow their
 * dataset tile — the puzzle transform is read from puzzleStore (written by
 * OverviewMap) and applied via applyPuzzleTransformToLonLat.
 *
 * Must be rendered inside the R3F Canvas (inside SceneContents in TourScene).
 */
import React, { useEffect, useMemo } from "react";
import {
  useGetMarkers,
  getGetMarkersQueryKey,
  useGetCatches,
  getGetCatchesQueryKey,
} from "@workspace/api-client-react";
import type { Marker, CatchEntry, TerrainData } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useTerrainStore } from "@/lib/terrainStore";
import { MarkerSprite } from "./MarkerSprite";
import { computeSecondaryMeshTransform } from "./NonPrimaryDatasetMeshes";
import { useSettingsStore } from "@/lib/settingsStore";
import { useMarkerLayerStore } from "@/lib/markerLayerStore";
import { markerGroupRef } from "@/lib/markerGroupRef";
import { usePuzzleStore } from "@/lib/puzzleStore";
import { applyPuzzleTransformToLonLat, tileCenterLonLat } from "@/lib/puzzleTransform";

// ---------------------------------------------------------------------------
// Fixed-slot hooks (hooks cannot be called in loops in React).
// We pre-call useGetMarkers for each of the VISIBLE_DATASETS_CAP slots and
// enable only the slots that have a visible dataset.
// ---------------------------------------------------------------------------

function useAllDatasetMarkers(): Marker[] {
  const visible = useTerrainStore((s) => s.visibleDatasets);

  const id0 = visible[0]?.datasetId ?? "";
  const id1 = visible[1]?.datasetId ?? "";
  const id2 = visible[2]?.datasetId ?? "";
  const id3 = visible[3]?.datasetId ?? "";

  const { data: m0 } = useGetMarkers(
    { datasetId: id0 },
    { query: { enabled: !!id0, queryKey: getGetMarkersQueryKey({ datasetId: id0 }) } },
  );
  const { data: m1 } = useGetMarkers(
    { datasetId: id1 },
    { query: { enabled: !!id1, queryKey: getGetMarkersQueryKey({ datasetId: id1 }) } },
  );
  const { data: m2 } = useGetMarkers(
    { datasetId: id2 },
    { query: { enabled: !!id2, queryKey: getGetMarkersQueryKey({ datasetId: id2 }) } },
  );
  const maxActiveDatasets = useSettingsStore((s) => s.maxActiveDatasets ?? 3);
  const { data: m3 } = useGetMarkers(
    { datasetId: id3 },
    { query: { enabled: !!id3 && maxActiveDatasets >= 4, queryKey: getGetMarkersQueryKey({ datasetId: id3 }) } },
  );

  const merged: Marker[] = [
    ...(m0 ?? []),
    ...(m1 ?? []),
    ...(m2 ?? []),
    ...(m3 ?? []),
  ];
  // Deduplicate by marker id in case a dataset appears more than once
  // (shouldn't happen in practice but is a safe guard).
  const seen = new Set<string>();
  return merged.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

/**
 * Fetch catch entries for every visible dataset (same fixed-slot pattern as
 * useAllDatasetMarkers) and group the distinct symbols per marker, insertion
 * order preserved. Used to render a row of catch symbols above each spot.
 */
export function useCatchSymbolsByMarker(): Map<string, string[]> {
  const visible = useTerrainStore((s) => s.visibleDatasets);
  const maxActiveDatasets = useSettingsStore((s) => s.maxActiveDatasets ?? 3);

  const id0 = visible[0]?.datasetId ?? "";
  const id1 = visible[1]?.datasetId ?? "";
  const id2 = visible[2]?.datasetId ?? "";
  const id3 = visible[3]?.datasetId ?? "";

  const { data: c0 } = useGetCatches(
    { datasetId: id0 },
    { query: { enabled: !!id0, queryKey: getGetCatchesQueryKey({ datasetId: id0 }) } },
  );
  const { data: c1 } = useGetCatches(
    { datasetId: id1 },
    { query: { enabled: !!id1, queryKey: getGetCatchesQueryKey({ datasetId: id1 }) } },
  );
  const { data: c2 } = useGetCatches(
    { datasetId: id2 },
    { query: { enabled: !!id2, queryKey: getGetCatchesQueryKey({ datasetId: id2 }) } },
  );
  const { data: c3 } = useGetCatches(
    { datasetId: id3 },
    { query: { enabled: !!id3 && maxActiveDatasets >= 4, queryKey: getGetCatchesQueryKey({ datasetId: id3 }) } },
  );

  return useMemo(() => {
    const all: CatchEntry[] = [
      ...(c0 ?? []),
      ...(c1 ?? []),
      ...(c2 ?? []),
      ...(c3 ?? []),
    ];
    return groupCatchSymbolsByMarker(all);
  }, [c0, c1, c2, c3]);
}

/**
 * Returns true when a marker's geographic coordinates fall within the primary
 * terrain's bounding box. Markers outside the bbox produce world XZ values
 * beyond ±50 and getTerrainSurfaceY would extrapolate rather than clamp —
 * suppressing them here is safer than rendering at an arbitrary off-edge position.
 * Exported for unit tests.
 */
export function isMarkerInBounds(
  marker: Pick<import("@workspace/api-client-react").Marker, "lon" | "lat">,
  terrain: Pick<import("@workspace/api-client-react").TerrainData, "minLon" | "maxLon" | "minLat" | "maxLat">,
): boolean {
  return (
    marker.lon >= terrain.minLon && marker.lon <= terrain.maxLon &&
    marker.lat >= terrain.minLat && marker.lat <= terrain.maxLat
  );
}

/**
 * Group catch symbols by markerId, one symbol per entry (duplicates kept —
 * two salmon entries render two salmon symbols), insertion order preserved.
 * Exported for unit tests.
 */
export function groupCatchSymbolsByMarker(entries: CatchEntry[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const e of entries) {
    const list = map.get(e.markerId) ?? [];
    list.push(e.symbol);
    if (!map.has(e.markerId)) map.set(e.markerId, list);
  }
  return map;
}

/**
 * Per-dataset info needed to render markers in the correct coordinate frame.
 * For the primary dataset the transform is identity; for secondaries it is the
 * same group transform applied by NonPrimaryDatasetMeshes so markers always
 * sit exactly on top of their corresponding terrain tile.
 */
interface DatasetMarkerGroup {
  grid: TerrainData;
  /** Primary world-space translation [cx, cy, cz] for the group. Primary = [0,0,0]. */
  position: [number, number, number];
  /** Scale [xScale, yScale, zScale]. Primary = [1,1,1]. */
  scale: [number, number, number];
}

export const MarkerLayer: React.FC = () => {
  const { terrain } = useAppState();
  const visibleDatasets = useTerrainStore((s) => s.visibleDatasets);
  const visibleMarkerTypes = useSettingsStore((s) => s.visibleMarkerTypes);
  const showMarkerLabels = useSettingsStore((s) => s.showMarkerLabels);
  const clusterThreshold = useSettingsStore((s) => s.markerClusterThreshold);
  const setSubsampleState = useMarkerLayerStore((s) => s.setSubsampleState);
  const clear = useMarkerLayerStore((s) => s.clear);

  // Puzzle store — read so each MarkerSprite receives an adjusted lon/lat when
  // its dataset tile has been moved in puzzle mode (task 3560).
  const puzzleMode = usePuzzleStore((s) => s.puzzleMode);
  const puzzleTransforms = usePuzzleStore((s) => s.puzzleTransforms);
  const overviewTransform = usePuzzleStore((s) => s.overviewTransform);
  const worldGrid = usePuzzleStore((s) => s.worldGrid);

  // Build a map from datasetId → { grid, position, scale } so each marker
  // can be rendered inside the same group transform its TerrainMesh occupies.
  //
  // Why: lonLatToWorldXZ maps a marker's lon/lat to its dataset's OWN local
  // world space ([-50,50]).  For secondary datasets that space is then
  // translated and scaled by NonPrimaryDatasetMeshes to align with the primary.
  // Wrapping secondary markers in an identical group transform means the same
  // lonLatToWorldXZ result yields the correct PRIMARY world-space position
  // without any additional math in MarkerSprite.
  const datasetGroups = useMemo((): Map<string, DatasetMarkerGroup> => {
    const map = new Map<string, DatasetMarkerGroup>();
    if (!terrain) return map;
    for (const v of visibleDatasets) {
      if (!v.activeGrid) continue;
      if (v.datasetId === terrain.datasetId) {
        // Primary: identity transform — markers sit directly in primary world space.
        map.set(v.datasetId, {
          grid: v.activeGrid,
          position: [0, 0, 0],
          scale: [1, 1, 1],
        });
      } else {
        // Secondary: use the same transform as the mesh so markers co-locate.
        const { cx, cy, cz, xScale, yScale, zScale } = computeSecondaryMeshTransform(terrain, v.activeGrid);
        map.set(v.datasetId, {
          grid: v.activeGrid,
          position: [cx, cy, cz],
          scale: [xScale, yScale, zScale],
        });
      }
    }
    return map;
  }, [terrain, visibleDatasets]);

  // Build a map from datasetId → overviewGrid for puzzle-transform lookups.
  // Only includes datasets that have an overviewGrid (bbox required for pivot).
  const overviewGridByDatasetId = useMemo(() => {
    const m = new Map<string, { minLon: number; maxLon: number; minLat: number; maxLat: number }>();
    for (const v of visibleDatasets) {
      if (v.overviewGrid) {
        m.set(v.datasetId, v.overviewGrid);
      }
    }
    return m;
  }, [visibleDatasets]);

  const markers = useAllDatasetMarkers();
  const catchSymbolsByMarker = useCatchSymbolsByMarker();

  const visibleMarkers = (!terrain || !markers.length)
    ? []
    : markers.filter(
        (m) => m.type === "depth_pole" || visibleMarkerTypes.includes(m.type as typeof visibleMarkerTypes[number]),
      ).filter((m) => {
        // For the primary dataset: check bounds against primary terrain bbox.
        // For secondary datasets: check bounds against their own grid bbox so
        // they are not incorrectly suppressed for being outside the primary area.
        const markerDatasetId = m.datasetId ?? "";
        if (!markerDatasetId && import.meta.env.DEV) {
          // A missing datasetId is always a data-quality bug upstream: without
          // it we cannot look up the correct dataset bbox and must fall back to
          // the primary terrain's bbox, which may incorrectly keep or drop the
          // marker. Surface this explicitly so it is easy to diagnose.
          console.warn(
            `[MarkerLayer] marker ${m.id} has no datasetId; falling back to primary terrain bbox for bounds check. This is a data-quality issue upstream.`,
          );
        }
        const dg = datasetGroups.get(markerDatasetId);
        const refGrid = dg?.grid ?? terrain;
        const inBounds = isMarkerInBounds(m, refGrid);
        if (!inBounds && import.meta.env.DEV) {
          console.warn(
            `[MarkerLayer] marker ${m.id} suppressed: lon=${m.lon} lat=${m.lat} is outside dataset bbox ` +
            `[${refGrid.minLon},${refGrid.maxLon}]×[${refGrid.minLat},${refGrid.maxLat}]`,
          );
        }
        return inBounds;
      });

  // When the count of visible markers exceeds the user's cluster threshold,
  // subsample uniformly so the scene stays readable.
  let rendered = visibleMarkers;
  if (clusterThreshold > 0 && visibleMarkers.length > clusterThreshold) {
    const stride = Math.ceil(visibleMarkers.length / clusterThreshold);
    rendered = visibleMarkers.filter((_, i) => i % stride === 0);
  }

  // Pre-compute puzzle-adjusted positions for all rendered markers in a single
  // pass so each MarkerSprite receives a stable prop (no per-render recalc).
  // Only runs when puzzle mode is active AND the store has all required data.
  const puzzleAdjustedPositions = useMemo<Map<string, { lon: number; lat: number }>>(() => {
    const result = new Map<string, { lon: number; lat: number }>();
    if (!puzzleMode || !overviewTransform) return result;

    // Use the worldGrid (union bbox) when available; fall back to the primary
    // dataset's overviewGrid as the projection reference.
    const refGrid = worldGrid ?? (visibleDatasets[0]?.overviewGrid ?? null);
    if (!refGrid) return result;

    for (const m of rendered) {
      if (!m.datasetId) continue;
      const xf = puzzleTransforms[m.datasetId];
      if (!xf) continue;
      const og = overviewGridByDatasetId.get(m.datasetId);
      if (!og) continue;

      const { centerLon, centerLat } = tileCenterLonLat(og);
      result.set(
        m.id,
        applyPuzzleTransformToLonLat(
          m.lon,
          m.lat,
          centerLon,
          centerLat,
          xf,
          refGrid as import("@workspace/api-client-react").TerrainData,
          overviewTransform,
        ),
      );
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- visibleDatasets covers overviewGrid changes; rendered covers marker content
  }, [puzzleMode, puzzleTransforms, overviewTransform, worldGrid, overviewGridByDatasetId, rendered, visibleDatasets]);

  // Publish subsampling state to the DOM-level HUD badge (outside R3F canvas).
  useEffect(() => {
    if (visibleMarkers.length === 0) {
      clear();
    } else {
      setSubsampleState(visibleMarkers.length, rendered.length);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- clear and setSubsampleState are Zustand setters (stable refs)
  }, [visibleMarkers.length, rendered.length]);

  // Clear store when this component unmounts (dataset cleared etc.)
  useEffect(() => () => { clear(); }, [clear]);

  if (!terrain || !markers.length) return null;

  // Group rendered markers by datasetId so each dataset's markers share a
  // single <group> with the correct position/scale transform.
  const byDataset = new Map<string, Marker[]>();
  for (const m of rendered) {
    if (!m.datasetId || !datasetGroups.has(m.datasetId)) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          `[MarkerLayer] No loaded grid for marker ${m.id} (datasetId=${m.datasetId}); marker suppressed.`,
        );
      }
      continue;
    }
    const key = m.datasetId;
    const list = byDataset.get(key) ?? [];
    list.push(m);
    if (!byDataset.has(key)) byDataset.set(key, list);
  }

  return (
    <group ref={(g) => { markerGroupRef.current = g; }}>
      {Array.from(byDataset.entries()).map(([datasetId, dsMarkers]) => {
        const dg = datasetGroups.get(datasetId)!;
        return (
          <group key={datasetId} name={`marker-group-${datasetId}`} position={dg.position} scale={dg.scale}>
            {dsMarkers.map((m) => (
              <MarkerSprite
                key={m.id}
                marker={m}
                terrain={dg.grid}
                showLabel={showMarkerLabels}
                catchSymbols={catchSymbolsByMarker.get(m.id)}
                effectiveLonLat={puzzleAdjustedPositions.get(m.id)}
              />
            ))}
          </group>
        );
      })}
    </group>
  );
};
