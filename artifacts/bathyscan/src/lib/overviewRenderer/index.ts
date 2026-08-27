/**
 * overviewRenderer — pure canvas drawing functions for the OverviewMap.
 *
 * No React dependencies. All functions accept a 2D canvas context plus
 * data params and draw directly. Called every rAF frame.
 *
 * This module is a compatibility facade: the implementation has been split
 * into focused internal modules under ./overviewRenderer/. Import from
 * "@/lib/overviewRenderer" (this file) — the internal module boundaries are
 * an implementation detail and may change.
 */
export { lonRangeOf, normaliseLon, lonLatToCanvas, canvasToLonLat, computeInitialTransform, computeFitTransform, clampTransform } from "./transforms";
export type { OverviewTransform } from "./transforms";
export { buildHillshadeLayer, buildHeatmapBitmap, renderHeatmap, renderHeatmapAtBbox } from "./terrainImagery";
export { renderGridLines, POLYGON_LOD_MIN_ZOOM, shouldDrawOverlayAtScale, renderHabitatOverlay, renderEfhOverlay, hitTestEfh, renderSubstrateOverlay, hitTestSubstrate, renderScaleBar, drawSelectionRect, buildIntertidalHotspotDescriptors, SYNTHETIC_HATCH_COLORS, renderSyntheticHatch, renderIntertidalBand } from "./overlays";
export type { WeatherStationPin, RawsStationPin, IntertidalHotspotPin, IntertidalSpotFeature } from "./overlays";
export {
  renderEfhLegend,
  hitTestEfhLegend,
  renderSubstrateLegend,
  hitTestSubstrateLegend,
  renderColormapLegend,
  OVERVIEW_CONTROL_LAYOUT,
  OVERVIEW_LEGEND_TOP,
} from "./legends";
export type { EfhLegendRow, EfhLegendLayout, SubstrateLegendRow, SubstrateLegendLayout } from "./legends";
export { renderViewCone, renderCameraArrow } from "./camera";
export { renderSavedTrails, renderSavedDrifts, hitTestSavedDrifts } from "./trails";
export type {
  CanvasTrailPoint,
  CanvasSavedTrail,
  SavedDriftEndpoint,
  SavedDriftHit,
} from "./trails";
export { MAX_NODATA_BOUNDARY_SEGMENTS, buildNodataBoundarySegments, renderNodataBoundary } from "./nodata";
export type { NodataBoundarySegment } from "./nodata";
export { MAX_CONTOUR_SEGMENTS, buildContourLines, renderContourLines } from "./contours";
export type { ContourSegment, ContourRenderOptions } from "./contours";
export { renderRoutePath, renderDriftPath } from "./routes";
export { computeBgAnchorAffine, computeBgFallbackRect, drawBackgroundImage, hasValidBgGeoAnchorPair, computeGapOverlapMask, GAP_OVERLAP_STEP_PX, drawGapOverlap } from "./puzzle";
export type { BgGeoAnchorPoint, BgAffine, GapOverlapTileInput, GapOverlapMask } from "./puzzle";
