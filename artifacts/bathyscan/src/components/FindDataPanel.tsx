/**
 * FindDataPanel — Dataset Discovery & Download slide-in drawer.
 *
 * Tabs:
 *   Search — NL / keyword search over the dataset catalog
 *   My Saves — user's saved catalog datasets with status + "Load" button
 *
 * NL search: types a query → calls POST /poe/query with searchDatasets tool
 * enabled → AI returns a searchDatasets tool call → client fetches
 * GET /api/datasets/catalog/search?q=... → results displayed as cards.
 *
 * Keyword fallback: if Poe returns text (no tool call), we also do a
 * direct catalog search so the user always gets results.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflinePackModal } from "@/components/OfflinePackModal";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDatasetsCatalogSearch,
  useGetDatasetsMySaves,
  useGetUserDatasets,
  usePostDatasetsCatalogIdSave,
  usePostDatasetsMySavesIdRetry,
  useDeleteDatasetsMySavesId,
  useDeleteUserDatasetsId,
  useGetNceiSearch,
  usePostNceiSave,
  getGetNceiSearchQueryKey,
  getGetDatasetsCatalogSearchQueryKey,
  getGetDatasetsMySavesQueryKey,
  getGetUserDatasetsQueryKey,
  type GetDatasetsCatalogSearchDataType,
  type DatasetCatalogSearchResult,
  type UserCatalogSave,
  type UserDatasetMeta,
  type NceiPortalResult,
} from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useAuth } from "@/lib/clerkCompat";
import { useSettingsStore } from "@/lib/settingsStore";
import { useUiStore } from "@/lib/uiStore";
import { CoordinateSearchForm } from "@/components/CoordinateSearchForm";
import { requestDatasetSwitch } from "@/lib/simulatedDataStore";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { HelpIcon } from "@/components/help/HelpButton";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

// Undo window for "soft" dataset deletes (ms). The row is hidden from the
// list immediately and the actual DELETE request is deferred until the
// window elapses, so a misclick can be reverted by clicking "Undo".
const UNDO_DELETE_WINDOW_MS = 5000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = "search" | "saves" | "ncei";

const DATA_TYPE_ICONS: Record<string, string> = {
  bathymetry: "🌊",
  substrate: "🪨",
  habitat: "🐟",
  lidar: "📡",
  chart: "🗺️",
  intertidal: "🏖️",
};

/** Catalog IDs that belong to the intertidal / shoreline category. */
export const INTERTIDAL_CATALOG_IDS = new Set([
  "adfg-intertidal-clam-habitat-se-alaska",
  "noaa-shorezone-tidal-pools-se-alaska",
  "noaa-shorezone-beachcombing-se-alaska",
]);

/**
 * Derive the catalog slug that the server will assign to an NCEI portal save
 * (mirrors the sanitizeNceiId + prefix logic in ncei.ts so the client can
 * check savedCatalogIds without a round-trip).
 */
function nceiPortalCatalogId(nceiId: string): string {
  const slug = nceiId
    .toLowerCase()
    .replace(/[^a-z0-9:.-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return `ncei-portal-${slug}`;
}

const DATA_TYPE_COLORS: Record<string, string> = {
  bathymetry: "#00e5ff",
  substrate: "#e2d5a0",
  habitat: "#4ade80",
  lidar: "#a78bfa",
  chart: "#fb923c",
};

const STATUS_COLORS: Record<string, string> = {
  queued: "#f59e0b",
  processing: "#60a5fa",
  ready: "#4ade80",
  failed: "#f87171",
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const PANEL: React.CSSProperties = {
  position: "fixed",
  top: 40,
  right: 0,
  bottom: 0,
  width: 380,
  background: "rgba(0,8,18,0.95)",
  backdropFilter: "blur(12px)",
  borderLeft: "1px solid rgba(0,229,255,0.12)",
  display: "flex",
  flexDirection: "column",
  zIndex: 100,
  fontFamily: "'JetBrains Mono', monospace",
  color: "#cbd5e1",
  pointerEvents: "auto",
};

const HEADER: React.CSSProperties = {
  padding: "14px 16px 10px",
  borderBottom: "1px solid rgba(0,229,255,0.1)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const TITLE: React.CSSProperties = {
  fontSize: 15,
  letterSpacing: "0.2em",
  color: "#00e5ff",
  textTransform: "uppercase",
  textShadow: "0 0 8px rgba(0,229,255,0.4)",
};

const TAB_BAR: React.CSSProperties = {
  display: "flex",
  borderBottom: "1px solid rgba(0,229,255,0.1)",
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "8px 0",
    fontSize: 13.5,
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    background: "none",
    border: "none",
    borderBottom: active ? "2px solid #00e5ff" : "2px solid transparent",
    color: active ? "#00e5ff" : "#94a3b8",
    cursor: "pointer",
    transition: "color 0.15s",
  };
}

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(0,229,255,0.2)",
  borderRadius: 4,
  padding: "8px 10px",
  fontSize: 16.5,
  color: "#e2e8f0",
  fontFamily: "'JetBrains Mono', monospace",
  outline: "none",
};

const CARD: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(0,229,255,0.08)",
  borderRadius: 6,
  padding: "10px 12px",
  marginBottom: 8,
};

function scoreBarStyle(score: number): React.CSSProperties {
  return {
    height: 2,
    width: `${Math.round(score * 100)}%`,
    background: `hsl(${120 + score * 120}, 80%, 55%)`,
    borderRadius: 1,
    marginTop: 6,
    transition: "width 0.3s",
  };
}

// ---------------------------------------------------------------------------
// BboxPreviewMap — lightweight SVG world mini-map showing coverage bbox
// ---------------------------------------------------------------------------

const BboxPreviewMap: React.FC<{
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
}> = ({ bbox }) => {
  const toX = (lon: number) => ((lon + 180) / 360) * 200;
  const toY = (lat: number) => ((90 - lat) / 180) * 100;

  const x1 = Math.min(toX(bbox.minLon), toX(bbox.maxLon));
  const y1 = Math.min(toY(bbox.maxLat), toY(bbox.minLat));
  const w = Math.max(2, Math.abs(toX(bbox.maxLon) - toX(bbox.minLon)));
  const h = Math.max(2, Math.abs(toY(bbox.minLat) - toY(bbox.maxLat)));

  return (
    <svg
      width={200}
      height={100}
      viewBox="0 0 200 100"
      style={{ display: "block", borderRadius: 3, marginBottom: 6 }}
      aria-label="Coverage map"
    >
      <rect width={200} height={100} fill="#050f1a" />
      {/* Simplified continent blocks */}
      <rect x={10} y={10} width={50} height={55} fill="#0e2b4a" rx={2} />
      <rect x={30} y={62} width={28} height={28} fill="#0e2b4a" rx={2} />
      <rect x={88} y={8} width={28} height={42} fill="#0e2b4a" rx={2} />
      <rect x={91} y={50} width={22} height={35} fill="#0e2b4a" rx={2} />
      <rect x={115} y={8} width={68} height={48} fill="#0e2b4a" rx={2} />
      <rect x={150} y={60} width={28} height={20} fill="#0e2b4a" rx={2} />
      {/* Coverage rect */}
      <rect
        x={x1} y={y1} width={w} height={h}
        fill="rgba(0,229,255,0.2)"
        stroke="#00e5ff"
        strokeWidth={1}
      />
    </svg>
  );
};

// ---------------------------------------------------------------------------
// NceiResultCard — card for a single NCEI portal search result
// ---------------------------------------------------------------------------

interface NceiResultCardProps {
  result: NceiPortalResult;
  onSave: (result: NceiPortalResult) => void;
  saving: boolean;
  saved: boolean;
  canSave: boolean;
}

const NceiResultCard: React.FC<NceiResultCardProps> = ({
  result,
  onSave,
  saving,
  saved,
  canSave,
}) => (
  <div style={CARD}>
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 21 }}>🌊</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "#e2e8f0",
            marginBottom: 2,
            lineHeight: 1.3,
          }}
        >
          {result.name}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#00e5ff",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          bathymetry · {result.sourceAgency}
        </div>
      </div>
      {!result.wcsAvailable && (
        <ViewscreenTooltip
          label="No NCEI WCS coverage — cannot be materialized in BathyScan yet"
          side="left"
        >
          <span style={{ fontSize: 12, color: "#f59e0b", letterSpacing: "0.06em" }}>
            N/A
          </span>
        </ViewscreenTooltip>
      )}
    </div>

    {result.description && (
      <div
        style={{ fontSize: 13.5, color: "#94a3b8", lineHeight: 1.5, marginBottom: 6 }}
      >
        {result.description.length > 120
          ? result.description.slice(0, 120) + "…"
          : result.description}
      </div>
    )}

    <BboxPreviewMap bbox={result.coverageBbox} />

    <div
      style={{ fontSize: 12, color: "#64748b", marginBottom: 4, fontVariantNumeric: "tabular-nums" }}
    >
      {result.coverageBbox.minLon.toFixed(1)}°,{result.coverageBbox.minLat.toFixed(1)}° →{" "}
      {result.coverageBbox.maxLon.toFixed(1)}°,{result.coverageBbox.maxLat.toFixed(1)}°
    </div>

    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>
      {result.resolutionMMin != null
        ? result.resolutionMMax != null && result.resolutionMMax !== result.resolutionMMin
          ? `${result.resolutionMMin}–${result.resolutionMMax} m res`
          : `${result.resolutionMMin} m res`
        : <span style={{ fontStyle: "italic", color: "#475569" }}>resolution unknown</span>}
    </div>

    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {result.metadataUrl && (
        <a
          href={result.metadataUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 12,
            padding: "3px 10px",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 3,
            color: "#94a3b8",
            textDecoration: "none",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Metadata
        </a>
      )}
      <ViewscreenTooltip
        label={
          !result.wcsAvailable
            ? "No NCEI WCS coverage for this dataset — cannot be materialized yet"
            : !canSave
              ? "Sign in to save datasets to your library"
              : saved
                ? "Already in your saved list"
                : "Save to your library using the NCEI WCS mosaic"
        }
        side="top"
      >
        <button
          onClick={() =>
            result.wcsAvailable && canSave && !saved && !saving && onSave(result)
          }
          disabled={!result.wcsAvailable || !canSave || saved || saving}
          style={{
            fontSize: 12,
            padding: "3px 10px",
            background: saved
              ? "rgba(74,222,128,0.1)"
              : "rgba(255,255,255,0.04)",
            border: `1px solid ${
              saved ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.1)"
            }`,
            borderRadius: 3,
            color:
              !result.wcsAvailable || !canSave
                ? "#64748b"
                : saved
                  ? "#4ade80"
                  : "#cbd5e1",
            cursor:
              !result.wcsAvailable || !canSave || saved ? "default" : "pointer",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            opacity: !result.wcsAvailable || !canSave ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save to Library"}
        </button>
      </ViewscreenTooltip>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Catalog result card
// ---------------------------------------------------------------------------

interface CatalogCardProps {
  entry: DatasetCatalogSearchResult;
  onSave: (id: string) => void;
  saving: boolean;
  saved: boolean;
  canSave: boolean;
  presetId: string | null;
  onLoad: (presetDatasetId: string) => void;
}

const CatalogCard: React.FC<CatalogCardProps> = ({ entry, onSave, saving, saved, canSave, presetId, onLoad }) => {
  const icon = DATA_TYPE_ICONS[entry.dataType] ?? "📦";
  const color = DATA_TYPE_COLORS[entry.dataType] ?? "#e2e8f0";
  const isIntertidal = INTERTIDAL_CATALOG_IDS.has(entry.id);
  const [offlineModalOpen, setOfflineModalOpen] = useState(false);

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 21 }}>{isIntertidal ? "🏖️" : icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginBottom: 2, lineHeight: 1.3 }}>
            {entry.name}
          </div>
          <div style={{ fontSize: 12, color, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {entry.dataType} · {entry.sourceAgency}
          </div>
          {isIntertidal && (
            <div style={{ marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  fontSize: 12,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "#fbbf24",
                  border: "1px solid rgba(251,191,36,0.4)",
                  borderRadius: 3,
                  padding: "1px 6px",
                  background: "rgba(251,191,36,0.08)",
                }}
              >
                🏖️ Intertidal / Shoreline
              </span>
            </div>
          )}
        </div>
        <span
          style={{
            fontSize: 12,
            letterSpacing: "0.08em",
            color: color,
            border: `1px solid ${color}40`,
            borderRadius: 3,
            padding: "1px 5px",
            flexShrink: 0,
          }}
        >
          {entry.waterType}
        </span>
      </div>

      {isIntertidal && (
        <div
          style={{
            fontSize: 12,
            color: "#94a3b8",
            fontStyle: "italic",
            marginBottom: 6,
            padding: "4px 6px",
            background: "rgba(251,191,36,0.05)",
            border: "1px solid rgba(251,191,36,0.12)",
            borderRadius: 3,
          }}
        >
          Shoreline / intertidal feature — not rendered as a 3D viewer layer
        </div>
      )}

      {entry.description && (
        <div style={{ fontSize: 13.5, color: "#cbd5e1", lineHeight: 1.5, marginBottom: 6 }}>
          {entry.description.slice(0, 120)}
          {entry.description.length > 120 && "…"}
        </div>
      )}

      <div style={{ display: "flex", gap: 4, fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>
        {entry.resolutionMMin != null && (
          <span>{entry.resolutionMMin}–{entry.resolutionMMax ?? "?"}m res</span>
        )}
        {entry.lastUpdated && (
          <span>· Updated {entry.lastUpdated.slice(0, 7)}</span>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {presetId && (
          <ViewscreenTooltip label="Open this dataset in the viewer" side="top">
            <button
              onClick={() => onLoad(presetId)}
              style={{
                fontSize: 12,
                padding: "3px 10px",
                background: "rgba(0,229,255,0.1)",
                border: "1px solid rgba(0,229,255,0.3)",
                borderRadius: 3,
                color: "#00e5ff",
                cursor: "pointer",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              Load
            </button>
          </ViewscreenTooltip>
        )}
        <ViewscreenTooltip
          label={
            !canSave
              ? "Sign in to save datasets to your library"
              : saved
                ? "Already in your saved list"
                : "Save to your library"
          }
          side="top"
        >
          <button
            onClick={() => canSave && !saved && !saving && onSave(entry.id)}
            disabled={!canSave || saved || saving}
            style={{
              fontSize: 12,
              padding: "3px 10px",
              background: saved ? "rgba(74,222,128,0.1)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${saved ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.1)"}`,
              borderRadius: 3,
              color: !canSave ? "#64748b" : saved ? "#4ade80" : "#cbd5e1",
              cursor: !canSave || saved ? "default" : "pointer",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              opacity: !canSave ? 0.6 : 1,
            }}
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
        </ViewscreenTooltip>
        {presetId && (
          <ViewscreenTooltip label="Save this area for offline field use" side="top">
            <button
              onClick={() => setOfflineModalOpen(true)}
              style={{
                fontSize: 12,
                padding: "3px 8px",
                background: "rgba(251,191,36,0.08)",
                border: "1px solid rgba(251,191,36,0.3)",
                borderRadius: 3,
                color: "#fbbf24",
                cursor: "pointer",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              ⬇ Offline
            </button>
          </ViewscreenTooltip>
        )}
      </div>

      {offlineModalOpen && (
        <OfflinePackModal
          dataset={{
            id: entry.id,
            name: entry.name,
            bbox: entry.coverageBbox
              ? { minLon: entry.coverageBbox.minLon, maxLon: entry.coverageBbox.maxLon, minLat: entry.coverageBbox.minLat, maxLat: entry.coverageBbox.maxLat }
              : null,
          }}
          onClose={() => setOfflineModalOpen(false)}
        />
      )}

      <div style={scoreBarStyle(entry.relevanceScore)} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// My Saves card
// ---------------------------------------------------------------------------

const SaveCard: React.FC<{
  save: UserCatalogSave;
  onLoadUserDataset: (userDatasetId: string) => void;
  onRetry: (saveId: string) => void;
  retrying: boolean;
  onDelete: (save: UserCatalogSave) => void;
  deleting: boolean;
}> = ({ save, onLoadUserDataset, onRetry, retrying, onDelete, deleting }) => {
  const statusColor = STATUS_COLORS[save.status] ?? "#e2e8f0";
  const icon = save.catalog ? (DATA_TYPE_ICONS[save.catalog.dataType] ?? "📦") : "📦";

  return (
    <div
      style={{ ...CARD, borderLeft: `2px solid ${statusColor}40`, opacity: deleting ? 0.5 : 1 }}
      data-testid={`save-card-${save.id}`}
      aria-busy={deleting || undefined}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, color: "#e2e8f0", fontWeight: 600, marginBottom: 1 }}>
            {save.catalog?.name ?? save.catalogId}
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            {save.catalog?.sourceAgency ?? "—"}
          </div>
        </div>
        <span
          style={{
            fontSize: 12,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: statusColor,
          }}
        >
          {save.status}
        </span>
        <ViewscreenTooltip label="Delete this saved dataset" side="left">
          <button
            type="button"
            data-testid={`btn-delete-save-${save.id}`}
            aria-label={`Delete saved dataset ${save.catalog?.name ?? save.catalogId}`}
            disabled={deleting}
            onClick={() => onDelete(save)}
            style={{
              background: "transparent",
              border: "none",
              color: "#cbd5e1",
              cursor: deleting ? "wait" : "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: "0 2px",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </ViewscreenTooltip>
      </div>
      {save.status === "ready" && save.datasetId && (
        <ViewscreenTooltip label="Open this dataset in the viewer" side="top">
          <button
            onClick={() => onLoadUserDataset(save.datasetId!)}
            style={{
              marginTop: 8,
              fontSize: 12,
              padding: "3px 12px",
              background: "rgba(0,229,255,0.1)",
              border: "1px solid rgba(0,229,255,0.3)",
              borderRadius: 3,
              color: "#00e5ff",
              cursor: "pointer",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Load into viewer
          </button>
        </ViewscreenTooltip>
      )}
      {save.status === "failed" && (
        <>
          {save.errorMessage && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#f87171", lineHeight: 1.4 }}>
              {save.errorMessage}
            </div>
          )}
          <ViewscreenTooltip label="Try materializing this dataset again" side="top">
            <button
              onClick={() => !retrying && onRetry(save.id)}
              disabled={retrying}
              data-testid={`save-retry-${save.id}`}
              style={{
                marginTop: 8,
                fontSize: 12,
                padding: "3px 12px",
                background: "rgba(248,113,113,0.1)",
                border: "1px solid rgba(248,113,113,0.3)",
                borderRadius: 3,
                color: retrying ? "#cbd5e1" : "#f87171",
                cursor: retrying ? "default" : "pointer",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          </ViewscreenTooltip>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Upload card (My Uploads section)
// ---------------------------------------------------------------------------

const UploadCard: React.FC<{
  dataset: UserDatasetMeta;
  onLoad: (id: string) => void;
  onDelete: (dataset: UserDatasetMeta) => void;
  deleting: boolean;
}> = ({ dataset, onLoad, onDelete, deleting }) => {
  const createdDate = useMemo(() => {
    const d = new Date(dataset.createdAt);
    if (Number.isNaN(d.getTime())) return dataset.createdAt.slice(0, 10);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, [dataset.createdAt]);

  return (
    <div
      style={{
        ...CARD,
        borderLeft: "2px solid rgba(167,139,250,0.4)",
        opacity: deleting ? 0.5 : 1,
      }}
      data-testid={`upload-card-${dataset.id}`}
      aria-busy={deleting || undefined}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>📤</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              color: "#e2e8f0",
              fontWeight: 600,
              marginBottom: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {dataset.name}
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>{createdDate}</div>
        </div>
        <ViewscreenTooltip label="Delete this uploaded dataset" side="left">
          <button
            type="button"
            data-testid={`btn-delete-upload-${dataset.id}`}
            aria-label={`Delete uploaded dataset ${dataset.name}`}
            disabled={deleting}
            onClick={() => onDelete(dataset)}
            style={{
              background: "transparent",
              border: "none",
              color: "#cbd5e1",
              cursor: deleting ? "wait" : "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: "0 2px",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </ViewscreenTooltip>
      </div>
      <ViewscreenTooltip label="Open this dataset in the viewer" side="top">
        <button
          onClick={() => onLoad(dataset.id)}
          data-testid={`btn-load-upload-${dataset.id}`}
          style={{
            marginTop: 8,
            fontSize: 12,
            padding: "3px 12px",
            background: "rgba(0,229,255,0.1)",
            border: "1px solid rgba(0,229,255,0.3)",
            borderRadius: 3,
            color: "#00e5ff",
            cursor: "pointer",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Load
        </button>
      </ViewscreenTooltip>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface FindDataPanelProps {
  onClose: () => void;
}

export const FindDataPanel: React.FC<FindDataPanelProps> = ({ onClose }) => {
  const [tab, setTab] = useState<Tab>("search");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [dataTypeFilter, setDataTypeFilter] = useState<string>("");
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<UserCatalogSave | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingUploadIds, setDeletingUploadIds] = useState<Set<string>>(new Set());
  const [confirmDeleteUpload, setConfirmDeleteUpload] = useState<UserDatasetMeta | null>(null);
  const [deleteUploadError, setDeleteUploadError] = useState<string | null>(null);
  // Saves whose row should be hidden from the list while their "Undo"
  // window is still open. Once the timer fires we commit the DELETE and
  // drop the id; if the user clicks Undo we just drop the id.
  const [pendingDeleteSaveIds, setPendingDeleteSaveIds] = useState<Set<string>>(
    () => new Set(),
  );
  const pendingDeletesRef = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => void }>(),
  );
  const { toast } = useToast();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nceiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether the user has explicitly interacted with this panel instance.
  // The NCEI bbox-seed auto-fetch is suppressed until interaction so the panel
  // always opens with an empty state (bug #3). Because <FindDataPanel> is keyed
  // by openFindDataCount, this ref resets naturally on every fresh open.
  const hasUserInteractedRef = useRef(false);
  const [nceiQuery, setNceiQuery] = useState("");
  const [debouncedNceiQuery, setDebouncedNceiQuery] = useState("");
  const [nceiSavingIds, setNceiSavingIds] = useState<Set<string>>(new Set());
  const [nceiFrom, setNceiFrom] = useState(1);
  const nceiFromRef = useRef(1);
  const [nceiAccumulated, setNceiAccumulated] = useState<NceiPortalResult[]>([]);
  const prevNceiPageRef = useRef<NceiPortalResult[] | undefined>(undefined);
  const { setDatasetId, setPendingExternalUserDatasetId, datasetId: currentDatasetId } = useAppState();
  const { isSignedIn } = useAuth();
  const qc = useQueryClient();

  // Debounce search query
  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(val), 400);
  }, []);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);
  useEffect(() => () => { if (nceiDebounceRef.current) clearTimeout(nceiDebounceRef.current); }, []);

  const handleNceiQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    hasUserInteractedRef.current = true;
    setNceiQuery(val);
    if (nceiDebounceRef.current) clearTimeout(nceiDebounceRef.current);
    nceiDebounceRef.current = setTimeout(() => setDebouncedNceiQuery(val), 400);
  }, []);

  // Catalog search
  // "intertidal" is a client-side-only filter (not a real dataType on the API),
  // so we don't forward it to the server — we filter results locally instead.
  const searchParams = {
    q: debouncedQuery || undefined,
    dataType: (dataTypeFilter && dataTypeFilter !== "intertidal" ? dataTypeFilter : undefined) as GetDatasetsCatalogSearchDataType | undefined,
  };
  const { data: rawSearchResults = [], isFetching: isSearching } = useGetDatasetsCatalogSearch(
    searchParams,
    {
      query: {
        queryKey: getGetDatasetsCatalogSearchQueryKey(searchParams),
        enabled: tab === "search",
        staleTime: 30_000,
      },
    },
  );

  // Client-side intertidal filter — the API doesn't know about this category,
  // so we narrow down the raw results ourselves when that chip is active.
  const searchResults = dataTypeFilter === "intertidal"
    ? rawSearchResults.filter((e) => INTERTIDAL_CATALOG_IDS.has(e.id))
    : rawSearchResults;

  // Invalidate catalog search when the user changes water type so freshwater /
  // saltwater datasets are filtered correctly on the next fetch.
  const waterType = useSettingsStore((s) => s.waterType);
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: getGetDatasetsCatalogSearchQueryKey(searchParams) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waterType]);

  // My Saves
  const {
    data: mySaves = [],
    refetch: refetchSaves,
    isFetching: isSaveFetching,
  } = useGetDatasetsMySaves({
    query: {
      queryKey: getGetDatasetsMySavesQueryKey(),
      // Always fetch when signed in so the search tab can reflect already-saved
      // entries without requiring the user to visit the saves tab first.
      enabled: !!isSignedIn,
      // Materialization runs server-side after POST /save returns. Poll so
      // status (queued → processing → ready/failed) and the resulting
      // datasetId become visible without forcing the user to refresh.
      refetchInterval: (q) => {
        const data = q.state.data as UserCatalogSave[] | undefined;
        if (!data) return false;
        return data.some((s) => s.status === "queued" || s.status === "processing") ? 2_000 : false;
      },
    },
  });

  // When a save's server-side materialization finishes, surface the new
  // user-dataset row in the rest of the app (notably DatasetPanel's "MY
  // UPLOADS" list) without forcing a manual refresh. We watch the polled
  // saves for status transitions into "ready" with a resolved datasetId
  // and invalidate the user-datasets list query on each fresh transition.
  const readyDatasetIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isSignedIn) return;
    let anyNew = false;
    for (const save of mySaves) {
      if (save.status === "ready" && save.datasetId) {
        if (!readyDatasetIdsRef.current.has(save.datasetId)) {
          readyDatasetIdsRef.current.add(save.datasetId);
          anyNew = true;
        }
      }
    }
    if (anyNew) {
      void qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
    }
  }, [mySaves, qc, isSignedIn]);

  // Catalog IDs that are already saved (any non-failed status). Used to disable
  // the Save button on search results when a save already exists, preventing
  // duplicate saves and greying out "ready" entries across panel re-opens.
  const savedCatalogIds = useMemo(
    () => new Set(mySaves.filter((s) => s.status !== "failed").map((s) => s.catalogId)),
    [mySaves],
  );

  // Derive the viewport bbox from the currently loaded dataset's catalog entry.
  // We match the active userDatasetId against the mySaves list (each save
  // tracks the materialize output's datasetId). When a match is found we
  // convert its coverageBbox to the "minLon,minLat,maxLon,maxLat" string
  // format expected by GET /ncei/search. This seeds nearby NCEI results
  // automatically without requiring the user to type a query.
  // An active manual coordinate search (circle on the Overview Map) takes
  // precedence over the loaded dataset's coverage bbox so the NCEI tab
  // surfaces records around the searched point.
  const coordSearchArea = useUiStore((s) => s.coordSearchArea);
  const viewportBboxString = useMemo<string | undefined>(() => {
    if (coordSearchArea) {
      const b = coordSearchArea.bbox;
      return `${b.west},${b.south},${b.east},${b.north}`;
    }
    if (!currentDatasetId) return undefined;
    const activeSave = mySaves.find((s) => s.datasetId === currentDatasetId);
    const bbox = activeSave?.catalog?.coverageBbox;
    if (!bbox) return undefined;
    return `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
  }, [coordSearchArea, currentDatasetId, mySaves]);

  // Reset NCEI pagination whenever the query or bbox seed changes
  useEffect(() => {
    nceiFromRef.current = 1;
    setNceiFrom(1);
    setNceiAccumulated([]);
    prevNceiPageRef.current = undefined;
  }, [debouncedNceiQuery, viewportBboxString]);

  // NCEI Portal search
  const nceiSearchParams = {
    q: debouncedNceiQuery || undefined,
    // Send the viewport bbox only after the user has explicitly interacted
    // (typed a query or changed tabs). Before any interaction the NCEI tab
    // must open with an empty state — not pre-populated results — so we
    // suppress the bbox seed until hasUserInteractedRef is set.
    bbox: (debouncedNceiQuery || !hasUserInteractedRef.current) ? undefined : viewportBboxString,
    from: nceiFrom > 1 ? nceiFrom : undefined,
  };
  const {
    data: nceiPage,
    isFetching: isNceiSearching,
    error: nceiError,
  } = useGetNceiSearch(nceiSearchParams, {
    query: {
      queryKey: getGetNceiSearchQueryKey(nceiSearchParams),
      enabled: tab === "ncei",
      staleTime: 10 * 60 * 1000,
    },
  });

  // Accumulate pages as they arrive. When nceiFrom is 1 we replace;
  // on subsequent pages we append. Early-return when data is undefined
  // (initial load / tab not active) to avoid acting on stale references.
  // prevNceiPageRef guards against re-processing the same React Query
  // result object on unrelated re-renders.
  useEffect(() => {
    if (nceiPage === undefined) return;
    if (nceiPage === prevNceiPageRef.current) return;
    prevNceiPageRef.current = nceiPage;
    if (nceiFromRef.current === 1) {
      setNceiAccumulated(nceiPage);
    } else {
      setNceiAccumulated((prev) => [...prev, ...nceiPage]);
    }
  }, [nceiPage]);

  const handleNceiLoadMore = useCallback(() => {
    const nextFrom = nceiFromRef.current + 20;
    nceiFromRef.current = nextFrom;
    setNceiFrom(nextFrom);
  }, []);

  // Show "Load more" when the last page returned exactly 20 results,
  // meaning there may be more records beyond this page.
  const nceiMayHaveMore = !isNceiSearching && (nceiPage?.length ?? 0) === 20;

  const nceiSaveMutation = usePostNceiSave();

  const handleNceiSave = useCallback(
    async (result: NceiPortalResult) => {
      if (!isSignedIn) return;
      setNceiSavingIds((s) => new Set(s).add(result.id));
      try {
        await nceiSaveMutation.mutateAsync({ data: { result } });
        void refetchSaves();
      } finally {
        setNceiSavingIds((s) => {
          const next = new Set(s);
          next.delete(result.id);
          return next;
        });
      }
    },
    [isSignedIn, nceiSaveMutation, refetchSaves],
  );

  // My Uploads — raw list of user-uploaded datasets
  const { data: userDatasets = [], isFetching: isUploadFetching } = useGetUserDatasets({
    query: {
      queryKey: getGetUserDatasetsQueryKey(),
      enabled: !!isSignedIn,
    },
  });

  // Dataset IDs already represented as catalog saves (any status).
  // We exclude these from the uploads section to avoid double-listing.
  const catalogSaveDatasetIds = useMemo(
    () => new Set(mySaves.map((s) => s.datasetId).filter(Boolean) as string[]),
    [mySaves],
  );

  // Uploads that are NOT already shown as a catalog save entry.
  const uploadOnlyDatasets = useMemo(
    () => userDatasets.filter((d) => !catalogSaveDatasetIds.has(d.id)),
    [userDatasets, catalogSaveDatasetIds],
  );

  const deleteUploadMutation = useDeleteUserDatasetsId();

  const handleRequestDeleteUpload = useCallback((dataset: UserDatasetMeta) => {
    setDeleteUploadError(null);
    setConfirmDeleteUpload(dataset);
  }, []);

  const handleConfirmDeleteUpload = useCallback(async () => {
    if (!confirmDeleteUpload) return;
    const target = confirmDeleteUpload;
    setConfirmDeleteUpload(null);
    setDeletingUploadIds((s) => new Set(s).add(target.id));
    try {
      await deleteUploadMutation.mutateAsync({ id: target.id });
      await qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
    } catch (err) {
      setDeleteUploadError(err instanceof Error ? err.message : "Could not delete uploaded dataset");
    } finally {
      setDeletingUploadIds((s) => {
        const next = new Set(s);
        next.delete(target.id);
        return next;
      });
    }
  }, [confirmDeleteUpload, deleteUploadMutation, qc]);

  const saveMutation = usePostDatasetsCatalogIdSave();
  const retryMutation = usePostDatasetsMySavesIdRetry();
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());

  const handleRetry = useCallback(
    async (saveId: string) => {
      if (!isSignedIn) return;
      setRetryingIds((s) => new Set(s).add(saveId));
      try {
        await retryMutation.mutateAsync({ id: saveId });
        void refetchSaves();
      } finally {
        setRetryingIds((s) => {
          const next = new Set(s);
          next.delete(saveId);
          return next;
        });
      }
    },
    [isSignedIn, retryMutation, refetchSaves],
  );

  const deleteSaveMutation = useDeleteDatasetsMySavesId();

  const handleRequestDelete = useCallback((save: UserCatalogSave) => {
    setDeleteError(null);
    setConfirmDelete(save);
  }, []);

  // Commit the deferred DELETE for a save. Used both by the 5s undo timer
  // and by the on-unmount flush so we don't leak ghost rows on the server.
  const commitDeleteSave = useCallback(
    async (target: UserCatalogSave) => {
      pendingDeletesRef.current.delete(target.id);
      setDeletingIds((s) => new Set(s).add(target.id));
      try {
        await deleteSaveMutation.mutateAsync({ id: target.id });
        // Drop the "saved" badge on the catalog card so users can re-save it.
        setSavedIds((s) => {
          const next = new Set(s);
          next.delete(target.catalogId);
          return next;
        });
        await Promise.all([
          qc.invalidateQueries({ queryKey: getGetDatasetsMySavesQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() }),
        ]);
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Could not delete saved dataset");
        // Restore the row to the visible list so the user can retry — the
        // server still has it because the mutation failed.
        setPendingDeleteSaveIds((s) => {
          const next = new Set(s);
          next.delete(target.id);
          return next;
        });
      } finally {
        setDeletingIds((s) => {
          const next = new Set(s);
          next.delete(target.id);
          return next;
        });
        setPendingDeleteSaveIds((s) => {
          if (!s.has(target.id)) return s;
          const next = new Set(s);
          next.delete(target.id);
          return next;
        });
      }
    },
    [deleteSaveMutation, qc],
  );

  const handleConfirmDelete = useCallback(() => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    setDeleteError(null);

    // Hide the row from the saves list immediately and start the undo
    // window. The DELETE request only fires once the timer elapses.
    setPendingDeleteSaveIds((s) => new Set(s).add(target.id));

    const undo = () => {
      const entry = pendingDeletesRef.current.get(target.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pendingDeletesRef.current.delete(target.id);
      setPendingDeleteSaveIds((s) => {
        const next = new Set(s);
        next.delete(target.id);
        return next;
      });
    };

    const timer = setTimeout(() => {
      void commitDeleteSave(target);
    }, UNDO_DELETE_WINDOW_MS);
    pendingDeletesRef.current.set(target.id, {
      timer,
      commit: () => {
        clearTimeout(timer);
        void commitDeleteSave(target);
      },
    });

    const name = target.catalog?.name ?? target.catalogId;
    const toastHandle = toast({
      title: "Saved dataset deleted",
      description: `"${name}" will be removed.`,
      duration: UNDO_DELETE_WINDOW_MS,
      action: (
        <ToastAction
          altText="Undo delete"
          data-testid="undo-delete-save"
          onClick={() => {
            undo();
            toastHandle.dismiss();
          }}
        >
          Undo
        </ToastAction>
      ),
    });
  }, [confirmDelete, commitDeleteSave, toast]);

  // If the panel unmounts (e.g. user closes the drawer) while undo windows
  // are still open, flush them so the server eventually receives the DELETE.
  useEffect(() => {
    const map = pendingDeletesRef.current;
    return () => {
      const entries = Array.from(map.values());
      map.clear();
      for (const entry of entries) entry.commit();
    };
  }, []);

  // Defensive stable sort (newest requested first, id tiebreaker) so the list
  // can't jump between polls even if the server ever returns unordered rows.
  const visibleSaves = mySaves
    .filter((s) => !pendingDeleteSaveIds.has(s.id))
    .sort((a, b) => {
      const t = new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime();
      if (t !== 0) return t;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const handleSave = useCallback(
    async (id: string) => {
      if (!isSignedIn) return;
      setSavingIds((s) => new Set(s).add(id));
      try {
        await saveMutation.mutateAsync({ id });
        setSavedIds((s) => new Set(s).add(id));
        void refetchSaves();
      } finally {
        setSavingIds((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }
    },
    [isSignedIn, saveMutation, refetchSaves],
  );

  const handleLoad = useCallback(
    (presetDatasetId: string) => {
      void requestDatasetSwitch({
        datasetId: presetDatasetId,
        onConfirm: () => {
          setDatasetId(presetDatasetId);
          onClose();
        },
      });
    },
    [setDatasetId, onClose],
  );

  // Load a materialized catalog save through the unified user-datasets read
  // path. DatasetPanel listens on `pendingExternalUserDatasetId` and runs the
  // /user/datasets/:id/{terrain,overview} fetch + classification pipeline.
  const handleLoadUserDataset = useCallback(
    (userDatasetId: string) => {
      void requestDatasetSwitch({
        datasetId: userDatasetId,
        onConfirm: () => {
          setPendingExternalUserDatasetId(userDatasetId);
          onClose();
        },
      });
    },
    [setPendingExternalUserDatasetId, onClose],
  );

  return (
    <div style={PANEL} role="dialog" aria-label="Find Data panel">
      {/* Header */}
      <div style={HEADER}>
        <span style={{ ...TITLE, display: "inline-flex", alignItems: "center", gap: 8 }}>
          Find Data
          <HelpIcon articleId="find-data" label="Find Data" />
        </span>
        <ViewscreenTooltip label="Close Find Data" side="left">
          <button
            onClick={onClose}
            aria-label="Close Find Data panel"
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 21,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </ViewscreenTooltip>
      </div>

      {/* Tabs */}
      <div style={TAB_BAR}>
        <ViewscreenTooltip label="Search the dataset catalog" side="bottom">
          <button style={tabStyle(tab === "search")} onClick={() => { hasUserInteractedRef.current = true; setTab("search"); }}>
            Search
          </button>
        </ViewscreenTooltip>
        <ViewscreenTooltip label="See datasets you saved" side="bottom">
          <button style={tabStyle(tab === "saves")} onClick={() => { hasUserInteractedRef.current = true; setTab("saves"); }}>
            My Saves
          </button>
        </ViewscreenTooltip>
        <ViewscreenTooltip label="Browse the NOAA/NCEI Bathymetry Geoportal" side="bottom">
          <button style={tabStyle(tab === "ncei")} onClick={() => { hasUserInteractedRef.current = true; setTab("ncei"); }}>
            NCEI Portal
          </button>
        </ViewscreenTooltip>
      </div>

      {/* Search tab */}
      {tab === "search" && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
          {/* Search bar */}
          <div style={{ padding: "12px 14px 8px" }}>
            <input
              style={INPUT_STYLE}
              value={query}
              onChange={handleQueryChange}
              placeholder='e.g. "Thorne Bay bathymetry" or "rockfish habitat"'
              autoFocus
              data-testid="find-data-search-input"
            />
            <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
              {["", "bathymetry", "substrate", "habitat", "lidar", "chart", "intertidal"].map((dt) => (
                <ViewscreenTooltip
                  key={dt}
                  label={
                    dt === "" ? "Show all data types" :
                    dt === "intertidal" ? "Filter to intertidal / shoreline entries" :
                    `Filter to ${dt} datasets`
                  }
                  side="bottom"
                >
                <button
                  onClick={() => setDataTypeFilter(dt)}
                  style={{
                    fontSize: 12,
                    padding: "2px 8px",
                    borderRadius: 3,
                    border: `1px solid ${dataTypeFilter === dt ? "rgba(0,229,255,0.4)" : "rgba(255,255,255,0.08)"}`,
                    background: dataTypeFilter === dt ? "rgba(0,229,255,0.1)" : "transparent",
                    color: dataTypeFilter === dt ? "#00e5ff" : "#94a3b8",
                    cursor: "pointer",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  {dt === "" ? "All" :
                   dt === "intertidal" ? `${DATA_TYPE_ICONS.intertidal} Intertidal / Shoreline` :
                   (DATA_TYPE_ICONS[dt] ?? "") + " " + dt}
                </button>
                </ViewscreenTooltip>
              ))}
            </div>
            {isSearching && (
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Searching…</div>
            )}

            {/* Manual coordinate + radius search */}
            <details
              data-testid="coord-search-section"
              style={{
                marginTop: 10,
                border: "1px solid rgba(0,229,255,0.12)",
                borderRadius: 4,
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <summary
                data-testid="coord-search-toggle"
                style={{
                  cursor: "pointer",
                  padding: "7px 10px",
                  fontSize: 12,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: "#7dd3fc",
                  userSelect: "none",
                }}
              >
                📍 Search by coordinates
              </summary>
              <div style={{ padding: "8px 10px 10px" }}>
                <CoordinateSearchForm onSubmitted={onClose} />
              </div>
            </details>
          </div>

          {/* Results */}
          <div
            style={{ flex: 1, overflowY: "auto", padding: "0 14px 14px" }}
            data-testid="find-data-results"
          >
            {searchResults.length === 0 && !isSearching && (
              <div style={{ fontSize: 13.5, color: "#94a3b8", textAlign: "center", paddingTop: 32 }}>
                {debouncedQuery
                  ? "No results found — try different keywords"
                  : "Type a query to discover datasets"}
              </div>
            )}
            {!isSignedIn && (
              <div
                style={{
                  fontSize: 13.5,
                  color: "#f59e0b",
                  textAlign: "center",
                  padding: "8px 0 12px",
                  letterSpacing: "0.05em",
                }}
              >
                Sign in to save catalog datasets to your account.
              </div>
            )}
            {searchResults.map((entry) => {
              const presetId = entry.id.startsWith("preset-") ? entry.id.replace("preset-", "") : null;
              return (
                <CatalogCard
                  key={entry.id}
                  entry={entry}
                  onSave={handleSave}
                  saving={savingIds.has(entry.id)}
                  saved={savedIds.has(entry.id) || savedCatalogIds.has(entry.id)}
                  canSave={!!isSignedIn}
                  presetId={presetId}
                  onLoad={handleLoad}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* My Saves tab */}
      {tab === "saves" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
          {!isSignedIn && (
            <div style={{ fontSize: 13.5, color: "#f59e0b", textAlign: "center", paddingTop: 32 }}>
              Sign in to see saved datasets.
            </div>
          )}
          {isSignedIn && isSaveFetching && (
            <div style={{ fontSize: 13.5, color: "#94a3b8", marginBottom: 8 }}>Loading…</div>
          )}

          {/* ── Catalog Saves section ── */}
          {isSignedIn && (
            <>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: "#64748b",
                  marginBottom: 8,
                  marginTop: 2,
                }}
              >
                Catalog Saves
              </div>
              {deleteError && (
                <div
                  data-testid="save-delete-error"
                  style={{
                    marginBottom: 8,
                    padding: "6px 8px",
                    border: "1px solid rgba(248,113,113,0.4)",
                    background: "rgba(248,113,113,0.08)",
                    borderRadius: 4,
                    fontSize: 13.5,
                    color: "#fca5a5",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span>⚠ {deleteError}</span>
                  <button
                    onClick={() => setDeleteError(null)}
                    aria-label="Dismiss error"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#cbd5e1",
                      cursor: "pointer",
                      fontSize: 15,
                    }}
                  >
                    ×
                  </button>
                </div>
              )}
              {!isSaveFetching && visibleSaves.length === 0 && (
                <div
                  style={{
                    fontSize: 13.5,
                    color: "#94a3b8",
                    textAlign: "center",
                    padding: "12px 0 16px",
                  }}
                >
                  No catalog saves yet — search and save some above
                </div>
              )}
              {visibleSaves.map((save) => (
                <SaveCard
                  key={save.id}
                  save={save}
                  onLoadUserDataset={handleLoadUserDataset}
                  onRetry={handleRetry}
                  retrying={retryingIds.has(save.id)}
                  onDelete={handleRequestDelete}
                  deleting={deletingIds.has(save.id)}
                />
              ))}
            </>
          )}

          {/* ── My Uploads section ── */}
          {isSignedIn && (
            <>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: "#64748b",
                  marginBottom: 8,
                  marginTop: 16,
                  paddingTop: 12,
                  borderTop: "1px solid rgba(0,229,255,0.08)",
                }}
              >
                My Uploads
              </div>
              {deleteUploadError && (
                <div
                  data-testid="upload-delete-error"
                  style={{
                    marginBottom: 8,
                    padding: "6px 8px",
                    border: "1px solid rgba(248,113,113,0.4)",
                    background: "rgba(248,113,113,0.08)",
                    borderRadius: 4,
                    fontSize: 13.5,
                    color: "#fca5a5",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span>⚠ {deleteUploadError}</span>
                  <button
                    onClick={() => setDeleteUploadError(null)}
                    aria-label="Dismiss error"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#cbd5e1",
                      cursor: "pointer",
                      fontSize: 15,
                    }}
                  >
                    ×
                  </button>
                </div>
              )}
              {isUploadFetching && (
                <div style={{ fontSize: 13.5, color: "#94a3b8", marginBottom: 8 }}>Loading…</div>
              )}
              {!isUploadFetching && uploadOnlyDatasets.length === 0 && (
                <div
                  style={{
                    fontSize: 13.5,
                    color: "#94a3b8",
                    textAlign: "center",
                    padding: "12px 0 16px",
                  }}
                >
                  No uploaded datasets yet
                </div>
              )}
              {uploadOnlyDatasets.map((dataset) => (
                <UploadCard
                  key={dataset.id}
                  dataset={dataset}
                  onLoad={handleLoadUserDataset}
                  onDelete={handleRequestDeleteUpload}
                  deleting={deletingUploadIds.has(dataset.id)}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* NCEI Portal tab */}
      {tab === "ncei" && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
          {/* Search bar */}
          <div style={{ padding: "12px 14px 8px" }}>
            <input
              style={INPUT_STYLE}
              value={nceiQuery}
              onChange={handleNceiQueryChange}
              placeholder='e.g. "Alaska DEM", "Southeast Alaska multibeam"'
              autoFocus
              data-testid="ncei-search-input"
            />
            <div
              style={{
                fontSize: 12,
                color: "#64748b",
                marginTop: 6,
                lineHeight: 1.5,
              }}
            >
              Searches the{" "}
              <a
                href="https://www.ncei.noaa.gov/maps/bathymetry/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#00e5ff", textDecoration: "none" }}
              >
                NOAA/NCEI Bathymetry Geoportal
              </a>
              . Datasets with WCS coverage can be saved to your library.
            </div>
            {isNceiSearching && (
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Searching…</div>
            )}
            {nceiError && (
              <div style={{ fontSize: 12, color: "#f87171", marginTop: 4 }}>
                ⚠ Could not reach the NCEI Geoportal — try again in a moment.
              </div>
            )}
          </div>

          {/* Results */}
          <div
            style={{ flex: 1, overflowY: "auto", padding: "0 14px 14px" }}
            data-testid="ncei-portal-results"
          >
            {!isSignedIn && (
              <div
                style={{
                  fontSize: 13.5,
                  color: "#f59e0b",
                  textAlign: "center",
                  padding: "8px 0 12px",
                  letterSpacing: "0.05em",
                }}
              >
                Sign in to save NCEI datasets to your library.
              </div>
            )}
            {nceiAccumulated.length === 0 && !isNceiSearching && !nceiError && (
              <div
                style={{ fontSize: 13.5, color: "#94a3b8", textAlign: "center", paddingTop: 32 }}
              >
                {debouncedNceiQuery
                  ? "No NCEI datasets matched — try different keywords"
                  : "Type a keyword to search the NCEI Bathymetry Geoportal"}
              </div>
            )}
            {nceiAccumulated.map((result) => (
              <NceiResultCard
                key={result.id}
                result={result}
                onSave={handleNceiSave}
                saving={nceiSavingIds.has(result.id)}
                saved={savedCatalogIds.has(nceiPortalCatalogId(result.id))}
                canSave={!!isSignedIn}
              />
            ))}
            {isNceiSearching && nceiFrom > 1 && (
              <div style={{ fontSize: 13.5, color: "#94a3b8", textAlign: "center", padding: "8px 0" }}>
                Loading more…
              </div>
            )}
            {nceiMayHaveMore && (
              <button
                onClick={handleNceiLoadMore}
                disabled={isNceiSearching}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "7px 0",
                  background: "rgba(0,229,255,0.06)",
                  border: "1px solid rgba(0,229,255,0.2)",
                  borderRadius: 4,
                  color: "#00e5ff",
                  fontSize: 13.5,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  cursor: isNceiSearching ? "not-allowed" : "pointer",
                  fontFamily: "'JetBrains Mono', monospace",
                  opacity: isNceiSearching ? 0.5 : 1,
                }}
                data-testid="ncei-load-more"
              >
                Load more
              </button>
            )}
          </div>
        </div>
      )}

      {confirmDelete && (
        <div
          role="dialog"
          aria-label="Confirm delete saved dataset"
          data-testid="confirm-delete-save"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,4,10,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
          }}
          onClick={() => setConfirmDelete(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "rgba(0,12,24,0.98)",
              border: "1px solid rgba(0,229,255,0.25)",
              borderRadius: 6,
              padding: "16px 18px",
              maxWidth: 320,
              fontFamily: "'JetBrains Mono', monospace",
              color: "#cbd5e1",
            }}
          >
            <div
              style={{
                fontSize: 16.5,
                color: "#e2e8f0",
                fontWeight: 700,
                marginBottom: 8,
                letterSpacing: "0.05em",
              }}
            >
              Delete &ldquo;{confirmDelete.catalog?.name ?? confirmDelete.catalogId}&rdquo;?
            </div>
            <div style={{ fontSize: 15, color: "#e2e8f0", lineHeight: 1.5, marginBottom: 14 }}>
              This will remove the saved dataset and its terrain grids from your library.
              You can re-save it from the catalog later.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setConfirmDelete(null)}
                data-testid="confirm-delete-cancel"
                style={{
                  fontSize: 13.5,
                  padding: "5px 12px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 3,
                  color: "#e2e8f0",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleConfirmDelete()}
                data-testid="confirm-delete-confirm"
                style={{
                  fontSize: 13.5,
                  padding: "5px 12px",
                  background: "rgba(248,113,113,0.12)",
                  border: "1px solid rgba(248,113,113,0.5)",
                  borderRadius: 3,
                  color: "#fca5a5",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload delete confirmation dialog */}
      {confirmDeleteUpload && (
        <div
          role="dialog"
          aria-label="Confirm delete uploaded dataset"
          data-testid="confirm-delete-upload"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,4,10,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
          }}
          onClick={() => setConfirmDeleteUpload(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "rgba(0,12,24,0.98)",
              border: "1px solid rgba(0,229,255,0.25)",
              borderRadius: 6,
              padding: "16px 18px",
              maxWidth: 320,
              fontFamily: "'JetBrains Mono', monospace",
              color: "#cbd5e1",
            }}
          >
            <div
              style={{
                fontSize: 16.5,
                color: "#e2e8f0",
                fontWeight: 700,
                marginBottom: 8,
                letterSpacing: "0.05em",
              }}
            >
              Delete &ldquo;{confirmDeleteUpload.name}&rdquo;?
            </div>
            <div style={{ fontSize: 15, color: "#e2e8f0", lineHeight: 1.5, marginBottom: 14 }}>
              This will permanently remove the uploaded dataset and its terrain data. This cannot be undone.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setConfirmDeleteUpload(null)}
                data-testid="confirm-delete-upload-cancel"
                style={{
                  fontSize: 13.5,
                  padding: "5px 12px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 3,
                  color: "#e2e8f0",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleConfirmDeleteUpload()}
                data-testid="confirm-delete-upload-confirm"
                style={{
                  fontSize: 13.5,
                  padding: "5px 12px",
                  background: "rgba(248,113,113,0.12)",
                  border: "1px solid rgba(248,113,113,0.5)",
                  borderRadius: 3,
                  color: "#fca5a5",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer attribution */}
      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid rgba(0,229,255,0.08)",
          fontSize: 10.5,
          color: "#64748b",
          letterSpacing: "0.05em",
        }}
      >
        Sources: NOAA/NCEI · GEBCO · Alaska ADF&G · USGS CoNED
      </div>
    </div>
  );
};
