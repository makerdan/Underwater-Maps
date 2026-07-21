/**
 * ArcGIS REST fetcher — wraps the existing `fetchArcGisRestBathy` contour +
 * IDW interpolation logic via the exported `BathymetrySource` in terrain.ts.
 *
 * probe()  — queries the FeatureServer with resultRecordCount=1 to confirm
 *             features exist for the bbox without loading the full dataset.
 * fetch()  — delegates to the BATHYMETRY_SOURCES ArcGIS source `.fetch()`.
 */

import type {
  ArcGisRestFetchStrategy,
  BathymetryFetcher,
  BathyFetchBundle,
  Bbox,
  FetchStrategy,
  ProbeResult,
} from "./types.js";
import { BATHYMETRY_SOURCES } from "../terrain.js";

export const arcGisRestFetcher: BathymetryFetcher = {
  async probe(strategy: FetchStrategy, bbox: Bbox): Promise<ProbeResult> {
    if (strategy.kind !== "arcgis-rest") {
      return { available: false, title: "", error: "Wrong strategy kind for arcGisRestFetcher" };
    }
    const s = strategy as ArcGisRestFetchStrategy;
    const { minLon, minLat, maxLon, maxLat } = bbox;
    try {
      const params = new URLSearchParams({
        where: "1=1",
        geometry: `${minLon},${minLat},${maxLon},${maxLat}`,
        geometryType: "esriGeometryEnvelope",
        spatialRel: "esriSpatialRelIntersects",
        // Hosted ArcGIS services reject outFields naming absent columns —
        // request all fields instead.
        outFields: "*",
        inSR: "4326",
        returnGeometry: "false",
        resultRecordCount: "1",
        f: "json",
      });
      const r = await fetch(`${s.serviceUrl}/query?${params}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) {
        return { available: false, title: s.sourceLabel, error: `HTTP ${r.status}` };
      }
      const body = (await r.json()) as { error?: { message?: string }; features?: unknown[] };
      if (body.error) {
        return { available: false, title: s.sourceLabel, error: body.error.message ?? "ArcGIS error" };
      }
      const count = body.features?.length ?? 0;
      if (count === 0) {
        return { available: false, title: s.sourceLabel, error: "No features for this bbox" };
      }
      return {
        available: true,
        title: s.sourceLabel,
        resolution: "10–30 m contour survey (IDW interpolated)",
      };
    } catch (err) {
      return { available: false, title: s.sourceLabel, error: (err as Error).message };
    }
  },

  async fetch(strategy: FetchStrategy, bbox: Bbox, N: number): Promise<BathyFetchBundle> {
    if (strategy.kind !== "arcgis-rest") throw new Error("Wrong strategy kind");
    const s = strategy as ArcGisRestFetchStrategy;

    const meta = {
      id: `ondemand-arcgis-${Date.now()}`,
      name: s.sourceLabel,
      description: s.sourceLabel,
      waterType: "freshwater" as const,
      minDepth: 0,
      maxDepth: 0,
      centerLon: (bbox.minLon + bbox.maxLon) / 2,
      centerLat: (bbox.minLat + bbox.maxLat) / 2,
      bbox,
    };

    const source = s.sourceLabel.toLowerCase().includes("nysdec")
      ? BATHYMETRY_SOURCES["nysdec-bathy"]
      : BATHYMETRY_SOURCES["mn-dnr-bathy"];

    if (!source) throw new Error(`No ArcGIS source found for label: ${s.sourceLabel}`);

    const result = await source.fetch(meta, N);

    return {
      depths: result.depths,
      topography: result.topography ?? new Array(N * N).fill(0),
      hasTopography: result.hasTopography,
      minDepth: result.minDepth,
      maxDepth: result.maxDepth,
      width: N,
      height: N,
      bbox,
      dataSource: s.dataSource,
      label: s.sourceLabel,
      creditUrl: s.creditUrl,
    };
  },
};
