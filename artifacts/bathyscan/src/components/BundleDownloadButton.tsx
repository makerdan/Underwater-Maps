import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  usePostTerrainBundles,
  useGetTerrainBundlesPresetIdStatus,
  getGetTerrainBundlesPresetIdStatusQueryKey,
  getTerrainBundlesPresetId,
} from "@workspace/api-client-react";
import type { DatasetMeta, TerrainData } from "@workspace/api-client-react";

/**
 * BundleDownloadButton
 *
 * Renders a "Download bathymetry" action on preset dataset cards that carry a
 * `fetchStrategy`. Clicking it triggers POST /api/terrain/bundles, then polls
 * GET /api/terrain/bundles/:presetId/status until the background job reaches
 * `complete` (or `error`). On completion the processed bundle is fetched from
 * GET /api/terrain/bundles/:presetId, converted into a TerrainData grid, and
 * handed to the parent via `onLoaded` so it loads into the viewer.
 */

type Phase = "idle" | "starting" | "pending" | "running" | "loading" | "done" | "error";

const POLL_INTERVAL_MS = 2500;

/** Raw bundle shape written by the server job (BathyFetchBundle + stamps). */
interface RawBundle {
  depths?: unknown;
  topography?: unknown;
  hasTopography?: unknown;
  minDepth?: unknown;
  maxDepth?: unknown;
  width?: unknown;
  height?: unknown;
  bbox?: { minLon?: unknown; minLat?: unknown; maxLon?: unknown; maxLat?: unknown };
  dataSource?: unknown;
  label?: unknown;
  creditUrl?: unknown;
}

/**
 * Convert a downloaded bundle into the TerrainData shape the viewer consumes.
 * Throws with a human-readable message when the payload is malformed.
 */
export function bundleToTerrainData(raw: unknown, ds: DatasetMeta): TerrainData {
  const b = raw as RawBundle;
  const depths = b.depths;
  const width = b.width;
  const height = b.height;
  const bbox = b.bbox;
  if (
    !Array.isArray(depths) ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    width <= 0 ||
    height <= 0 ||
    depths.length !== width * height ||
    !bbox ||
    typeof bbox.minLon !== "number" ||
    typeof bbox.minLat !== "number" ||
    typeof bbox.maxLon !== "number" ||
    typeof bbox.maxLat !== "number"
  ) {
    throw new Error("Downloaded bundle is malformed (missing depth grid or bounds)");
  }
  const hasTopography = b.hasTopography === true && Array.isArray(b.topography);
  const terrain: TerrainData = {
    datasetId: ds.id,
    name: ds.name,
    waterType: ds.waterType,
    resolution: width,
    width,
    height,
    depths: depths as number[],
    minDepth: typeof b.minDepth === "number" ? b.minDepth : ds.minDepth,
    maxDepth: typeof b.maxDepth === "number" ? b.maxDepth : ds.maxDepth,
    minLon: bbox.minLon,
    maxLon: bbox.maxLon,
    minLat: bbox.minLat,
    maxLat: bbox.maxLat,
    centerLon: (bbox.minLon + bbox.maxLon) / 2,
    centerLat: (bbox.minLat + bbox.maxLat) / 2,
    hasTopography,
    ...(hasTopography ? { topography: b.topography as number[] } : {}),
    ...(typeof b.dataSource === "string"
      ? { dataSource: b.dataSource as TerrainData["dataSource"] }
      : {}),
    ...(typeof b.label === "string" ? { bathymetrySourceLabel: b.label } : {}),
    ...(typeof b.creditUrl === "string" ? { bathymetryCreditUrl: b.creditUrl } : {}),
  };
  return terrain;
}

const BTN_STYLE: React.CSSProperties = {
  fontSize: 13.5,
  padding: "3px 8px",
  background: "rgba(0,229,255,0.06)",
  border: "1px solid rgba(0,229,255,0.35)",
  borderRadius: 3,
  color: "#00e5ff",
  cursor: "pointer",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  fontFamily: "inherit",
};

export const BundleDownloadButton: React.FC<{
  dataset: DatasetMeta;
  onLoaded: (dataset: DatasetMeta, terrain: TerrainData) => void;
}> = ({ dataset, onLoaded }) => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progressNote, setProgressNote] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const postBundle = usePostTerrainBundles();

  const polling = phase === "pending" || phase === "running";
  const { data: status } = useGetTerrainBundlesPresetIdStatus(dataset.id, {
    query: {
      enabled: polling,
      queryKey: getGetTerrainBundlesPresetIdStatusQueryKey(dataset.id),
      refetchInterval: polling ? POLL_INTERVAL_MS : false,
      gcTime: 0,
    },
  });

  const loadBundle = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setPhase("loading");
    try {
      const raw = await getTerrainBundlesPresetId(dataset.id);
      const terrain = bundleToTerrainData(raw, dataset);
      if (!mountedRef.current) return;
      onLoaded(dataset, terrain);
      setPhase("done");
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : "Failed to load bundle");
      setPhase("error");
    } finally {
      loadingRef.current = false;
    }
  }, [dataset, onLoaded]);

  // React to poll results.
  useEffect(() => {
    if (!polling || !status) return;
    if (status.progressNote) setProgressNote(status.progressNote);
    if (status.status === "running" && phase !== "running") setPhase("running");
    if (status.status === "complete") void loadBundle();
    if (status.status === "error") {
      setErrorMsg(status.errorMessage ?? "Download failed");
      setPhase("error");
    }
  }, [status, polling, phase, loadBundle]);

  const start = useCallback(() => {
    setErrorMsg(null);
    setProgressNote(null);
    setPhase("starting");
    postBundle.mutate(
      { data: { presetId: dataset.id } },
      {
        onSuccess: (res) => {
          if (!mountedRef.current) return;
          if (res.status === "complete") {
            void loadBundle();
          } else {
            setPhase(res.status === "running" ? "running" : "pending");
          }
        },
        onError: (err) => {
          if (!mountedRef.current) return;
          const detail =
            err && typeof err === "object" && "error" in err
              ? String((err as { error?: unknown }).error)
              : "Could not start download";
          setErrorMsg(detail);
          setPhase("error");
        },
      },
    );
  }, [dataset.id, postBundle, loadBundle]);

  const busy = phase === "starting" || phase === "pending" || phase === "running" || phase === "loading";

  const statusLabel =
    phase === "starting"
      ? "Requesting…"
      : phase === "pending"
        ? "Queued…"
        : phase === "running"
          ? progressNote ?? "Downloading…"
          : phase === "loading"
            ? "Loading into viewer…"
            : null;

  return (
    <div
      data-testid={`bundle-download-${dataset.id}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
    >
      {phase === "done" ? (
        <span
          data-testid={`bundle-complete-${dataset.id}`}
          style={{ fontSize: 13.5, color: "#4ade80", letterSpacing: "0.08em" }}
        >
          ✓ BATHYMETRY LOADED
        </span>
      ) : busy ? (
        <span
          data-testid={`bundle-status-${dataset.id}`}
          role="status"
          style={{ fontSize: 13.5, color: "#7dd3fc", letterSpacing: "0.06em" }}
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              marginRight: 6,
              borderRadius: "50%",
              background: phase === "running" || phase === "loading" ? "#00e5ff" : "#f59e0b",
              boxShadow: "0 0 6px rgba(0,229,255,0.5)",
            }}
          />
          {statusLabel}
        </span>
      ) : (
        <button
          type="button"
          data-testid={`btn-download-bundle-${dataset.id}`}
          onClick={start}
          style={BTN_STYLE}
        >
          ⬇ {phase === "error" ? "Retry download" : "Download bathymetry"}
        </button>
      )}
      {phase === "error" && errorMsg && (
        <span
          data-testid={`bundle-error-${dataset.id}`}
          style={{ fontSize: 13, color: "#ef4444", overflowWrap: "anywhere" }}
        >
          {errorMsg}
        </span>
      )}
    </div>
  );
};
