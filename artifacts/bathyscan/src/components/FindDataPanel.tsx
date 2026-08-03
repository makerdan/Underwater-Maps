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
import { formatFreshness } from "@/lib/freshnessUtils";
import { useTerrainStore, MAX_ACTIVE_DATASETS } from "@/lib/terrainStore";
import { OfflinePackModal } from "@/components/OfflinePackModal";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import {
  useGetDatasetsCatalogSearch,
  useGetDatasetsMySaves,
  usePostDatasetsCatalogIdSave,
  useGetNceiSearch,
  usePostNceiSave,
  getSearchFederated,
  getGetSearchFederatedQueryKey,
  useGetSearchFederatedSources,
  getGetSearchFederatedSourcesQueryKey,
  usePostSearchFederatedSave,
  getGetNceiSearchQueryKey,
  getGetDatasetsCatalogSearchQueryKey,
  getGetDatasetsMySavesQueryKey,
  getGetUserDatasetsQueryKey,
  getGetUserFoldersQueryKey,
  type GetDatasetsCatalogSearchDataType,
  type DatasetCatalogSearchResult,
  type UserCatalogSave,
  type NceiPortalResult,
  type FederatedSearchResult,
  type FederatedSourceStatus,
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
import { MySavesSection } from "@/components/MySavesSection";


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = "search" | "ncei" | "my-saves";

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
  fontSize: "calc(15px * var(--bs-font-scale, 1))",
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
    fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
  fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
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
      <span style={{ fontSize: "calc(21px * var(--bs-font-scale, 1))" }}>🌊</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "calc(15px * var(--bs-font-scale, 1))",
            fontWeight: 700,
            color: "#e2e8f0",
            marginBottom: 2,
            lineHeight: 1.3,
          }}
        >
          {result.name ?? "Untitled"}
        </div>
        <div
          style={{
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            color: "#00e5ff",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          bathymetry · {result.sourceAgency ?? "Unknown"}
        </div>
      </div>
      {!result.wcsAvailable && (
        <ViewscreenTooltip
          label="No NCEI WCS coverage — cannot be materialized in BathyScan yet"
          side="left"
        >
          <span style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#f59e0b", letterSpacing: "0.06em" }}>
            N/A
          </span>
        </ViewscreenTooltip>
      )}
    </div>

    {result.description && (
      <div
        style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", lineHeight: 1.5, marginBottom: 6 }}
      >
        {result.description.length > 120
          ? result.description.slice(0, 120) + "…"
          : result.description}
      </div>
    )}

    {result.coverageBbox ? (
      <>
        <BboxPreviewMap bbox={result.coverageBbox} />
        <div
          style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#64748b", marginBottom: 4, fontVariantNumeric: "tabular-nums" }}
        >
          {result.coverageBbox.minLon.toFixed(1)}°,{result.coverageBbox.minLat.toFixed(1)}° →{" "}
          {result.coverageBbox.maxLon.toFixed(1)}°,{result.coverageBbox.maxLat.toFixed(1)}°
        </div>
      </>
    ) : (
      <div
        style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#475569", marginBottom: 4, fontStyle: "italic" }}
      >
        No location data
      </div>
    )}

    <div style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#64748b", marginBottom: 6 }}>
      {result.resolutionMMin != null
        ? result.resolutionMMax != null && result.resolutionMMax !== result.resolutionMMin
          ? `${result.resolutionMMin}–${result.resolutionMMax} m res`
          : `${result.resolutionMMin} m res`
        : <span style={{ fontStyle: "italic", color: "#475569" }}>resolution unknown</span>}
    </div>

    {result.modified && (
      <div style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#94a3b8", marginBottom: 6 }}>
        Updated {result.modified.slice(0, 7)}
      </div>
    )}

    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {result.metadataUrl && (
        <a
          href={result.metadataUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
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
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
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
  /** True when at least one dataset is already loaded (enables the ADD button). */
  hasPrimary: boolean;
  /** True when this preset's id is already in the terrain store's selected/visible pool. */
  inView: boolean;
  /** True when the terrain store has reached MAX_ACTIVE_DATASETS. */
  atCap: boolean;
  /** Called with the presetId and optional survey date when the user clicks ADD. */
  onAddToView: (presetId: string, dataUpdatedAt?: string | null) => void;
  /**
   * When set, the Save button is disabled regardless of `canSave` and this
   * message is shown as the tooltip reason. Used to block NCEI WCS saves
   * when no terrain area is currently loaded in the viewer.
   */
  saveBlockedReason?: string;
}

const CatalogCard: React.FC<CatalogCardProps> = ({ entry, onSave, saving, saved, canSave, presetId, onLoad, hasPrimary, inView, atCap, onAddToView, saveBlockedReason }) => {
  const icon = DATA_TYPE_ICONS[entry.dataType] ?? "📦";
  const color = DATA_TYPE_COLORS[entry.dataType] ?? "#e2e8f0";
  const isIntertidal = INTERTIDAL_CATALOG_IDS.has(entry.id);
  const [offlineModalOpen, setOfflineModalOpen] = useState(false);

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: "calc(21px * var(--bs-font-scale, 1))" }}>{isIntertidal ? "🏖️" : icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "calc(15px * var(--bs-font-scale, 1))", fontWeight: 700, color: "#e2e8f0", marginBottom: 2, lineHeight: 1.3 }}>
            {entry.name}
          </div>
          <div style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {entry.dataType} · {entry.sourceAgency}
          </div>
          {isIntertidal && (
            <div style={{ marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  fontSize: "calc(12px * var(--bs-font-scale, 1))",
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
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
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
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
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
        <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#cbd5e1", lineHeight: 1.5, marginBottom: 6 }}>
          {entry.description.slice(0, 120)}
          {entry.description.length > 120 && "…"}
        </div>
      )}

      <div style={{ display: "flex", gap: 4, fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#94a3b8", marginBottom: 6 }}>
        {entry.resolutionMMin != null && (
          <span>{entry.resolutionMMin}–{entry.resolutionMMax ?? "?"}m res</span>
        )}
        {entry.lastUpdated && (
          <span>· Updated {entry.lastUpdated.slice(0, 7)}</span>
        )}
      </div>
      {formatFreshness(entry.createdAt) && (
        <div style={{ fontSize: "calc(11px * var(--bs-font-scale, 1))", color: "#475569", letterSpacing: "0.06em", marginBottom: 4 }}>
          Sourced {formatFreshness(entry.createdAt)}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {presetId && hasPrimary && (
          <ViewscreenTooltip
            label={
              inView
                ? "Already added to the 3D view"
                : atCap
                  ? `View is full (max ${MAX_ACTIVE_DATASETS} datasets)`
                  : "Add this dataset alongside the current view"
            }
            side="top"
          >
            <button
              data-testid={`catalog-add-to-view-${entry.id}`}
              onClick={() => !inView && !atCap && onAddToView(presetId!, entry.lastUpdated ?? null)}
              disabled={inView || atCap}
              style={{
                fontSize: "calc(12px * var(--bs-font-scale, 1))",
                padding: "3px 10px",
                background: inView
                  ? "rgba(74,222,128,0.1)"
                  : "rgba(255,255,255,0.04)",
                border: `1px solid ${inView ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.15)"}`,
                borderRadius: 3,
                color: inView ? "#4ade80" : atCap ? "#64748b" : "#cbd5e1",
                cursor: inView || atCap ? "default" : "pointer",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                opacity: atCap && !inView ? 0.6 : 1,
              }}
            >
              {inView ? "IN VIEW" : "ADD"}
            </button>
          </ViewscreenTooltip>
        )}
        {presetId && (
          <ViewscreenTooltip label="Open this dataset in the viewer" side="top">
            <button
              onClick={() => onLoad(presetId)}
              style={{
                fontSize: "calc(12px * var(--bs-font-scale, 1))",
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
            saveBlockedReason
              ? saveBlockedReason
              : !canSave
                ? "Sign in to save datasets to your library"
                : saved
                  ? "Already in your saved list"
                  : "Save to your library"
          }
          side="top"
        >
          <button
            onClick={() => !saveBlockedReason && canSave && !saved && !saving && onSave(entry.id)}
            disabled={!!saveBlockedReason || !canSave || saved || saving}
            style={{
              fontSize: "calc(12px * var(--bs-font-scale, 1))",
              padding: "3px 10px",
              background: saved ? "rgba(74,222,128,0.1)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${saved ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.1)"}`,
              borderRadius: 3,
              color: (!!saveBlockedReason || !canSave) ? "#64748b" : saved ? "#4ade80" : "#cbd5e1",
              cursor: (!!saveBlockedReason || !canSave || saved) ? "default" : "pointer",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              opacity: (!!saveBlockedReason || !canSave) ? 0.6 : 1,
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
                fontSize: "calc(12px * var(--bs-font-scale, 1))",
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
// (My Saves components moved to MySavesSection.tsx)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Federated (multi-source) search — external result card + sources summary
// ---------------------------------------------------------------------------

/**
 * Mirror of the server-side `sanitizeFederatedId` / `sanitizeNceiId`
 * functions (both identical). Converts any string into a URL/DB-safe slug.
 *
 * Must stay in sync with:
 *   artifacts/api-server/src/routes/search-federated.ts  → sanitizeFederatedId
 *   artifacts/api-server/src/routes/ncei.ts              → sanitizeNceiId
 */
function sanitizeFederatedSlug(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9:.-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Derive the catalog ID that the server will have persisted for a federated
 * search result, mirroring the server's upsert logic:
 *   - NCEI items (sourceId = "ncei-geoportal") → POST /ncei/save strips the
 *     "ncei-geoportal:" prefix then prefixes with "ncei-portal-".
 *   - All other sources → POST /search/federated/save prefixes with "fed-"
 *     using the full item.id.
 *
 * Used by `federatedMaterializedMap` to correlate a search card with its
 * ready mySave entry so the ADD button can be shown.
 */
function federatedItemToCatalogId(item: FederatedSearchResult): string {
  if (item.sourceId === "ncei-geoportal") {
    const stripped = item.id.replace(/^ncei-geoportal:/, "");
    return `ncei-portal-${sanitizeFederatedSlug(stripped)}`;
  }
  return `fed-${sanitizeFederatedSlug(item.id)}`;
}

/** Rebuild an NceiPortalResult from a federated NCEI item so the existing
 *  NCEI save flow (POST /ncei/save) can be reused verbatim. */
function federatedToNceiResult(item: FederatedSearchResult): NceiPortalResult | null {
  if (item.sourceId !== "ncei-geoportal" || !item.coverageBbox) return null;
  return {
    id: item.id.replace(/^ncei-geoportal:/, ""),
    name: item.name,
    description: item.description ?? null,
    sourceAgency: "NOAA NCEI",
    resolutionMMin: item.resolutionMMin ?? null,
    resolutionMMax: item.resolutionMMax ?? null,
    coverageBbox: item.coverageBbox,
    metadataUrl: item.url ?? null,
    wcsAvailable: item.importable,
  };
}

const FederatedResultCard: React.FC<{
  item: FederatedSearchResult;
  canSave: boolean;
  saving: boolean;
  onSaveNcei: (result: NceiPortalResult) => void;
  onSaveFederated: (item: FederatedSearchResult) => void;
  /** When provided (and addDsId is non-null), renders an ADD / IN VIEW button. */
  onAddToView?: (dsId: string) => void;
  /** The materialized user-dataset id for this federated item, or null if not yet ready. */
  addDsId?: string | null;
  /** True when addDsId is already in the terrain store's selected/visible pool. */
  inView?: boolean;
  /** True when the terrain store has reached MAX_ACTIVE_DATASETS. */
  atViewCap?: boolean;
}> = ({ item, canSave, saving, onSaveNcei, onSaveFederated, onAddToView, addDsId, inView = false, atViewCap = false }) => {
  const nceiResult = item.importable ? federatedToNceiResult(item) : null;
  // Every importable result gets a save action: NCEI results reuse the
  // existing /ncei/save flow; all other sources go through the generic
  // /search/federated/save endpoint (same catalog-save pipeline).
  const canImport = item.importable && !!item.coverageBbox;
  return (
    <div
      data-testid={`federated-result-${item.id}`}
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 6,
        padding: "10px 12px",
        marginTop: 8,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span
          data-testid="federated-source-chip"
          style={{
            fontSize: "calc(10px * var(--bs-font-scale, 1))",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#7dd3fc",
            border: "1px solid rgba(125,211,252,0.3)",
            borderRadius: 3,
            padding: "1px 6px",
          }}
        >
          {item.sourceLabel}
        </span>
        <span
          data-testid={item.importable ? "badge-importable" : "badge-link-only"}
          style={{
            fontSize: "calc(10px * var(--bs-font-scale, 1))",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            borderRadius: 3,
            padding: "1px 6px",
            color: item.importable ? "#4ade80" : "#94a3b8",
            border: `1px solid ${item.importable ? "rgba(74,222,128,0.35)" : "rgba(148,163,184,0.3)"}`,
          }}
        >
          {item.importable ? "Importable" : "Link-only"}
        </span>
      </div>
      <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#e2e8f0", marginTop: 5, fontWeight: 600 }}>
        {item.name}
      </div>
      {item.description && (
        <div
          style={{
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            color: "#94a3b8",
            marginTop: 3,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {item.description}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 7, alignItems: "center" }}>
        {canImport && (
          <button
            data-testid="federated-save-button"
            disabled={!canSave || saving}
            onClick={() => (nceiResult ? onSaveNcei(nceiResult) : onSaveFederated(item))}
            style={{
              fontSize: "calc(11px * var(--bs-font-scale, 1))",
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid rgba(74,222,128,0.4)",
              background: "rgba(74,222,128,0.1)",
              color: "#4ade80",
              cursor: canSave && !saving ? "pointer" : "default",
              opacity: canSave ? 1 : 0.5,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {saving ? "Saving…" : "Save & Import"}
          </button>
        )}
        {onAddToView && addDsId && (
          <ViewscreenTooltip
            label={
              inView
                ? "Remove from 3D view"
                : atViewCap
                  ? `View limit reached`
                  : "Add alongside current dataset in 3D view"
            }
            side="top"
          >
            <button
              data-testid={`federated-add-to-view-${item.id}`}
              onClick={() => onAddToView(addDsId)}
              disabled={atViewCap && !inView}
              style={{
                fontSize: "calc(11px * var(--bs-font-scale, 1))",
                padding: "4px 10px",
                borderRadius: 4,
                border: inView
                  ? "1px solid rgba(0,229,255,0.5)"
                  : atViewCap
                    ? "1px solid rgba(100,116,139,0.3)"
                    : "1px solid rgba(0,229,255,0.3)",
                background: inView ? "rgba(0,229,255,0.15)" : "rgba(0,229,255,0.06)",
                color: inView ? "#00e5ff" : atViewCap ? "#64748b" : "#67e8f9",
                cursor: atViewCap && !inView ? "not-allowed" : "pointer",
                opacity: atViewCap && !inView ? 0.4 : 1,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {inView ? "IN VIEW" : "ADD"}
            </button>
          </ViewscreenTooltip>
        )}
        {item.url && (
          <a
            data-testid="federated-open-link"
            href={item.url}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: "calc(11px * var(--bs-font-scale, 1))",
              color: "#7dd3fc",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Open source page ↗
          </a>
        )}
      </div>
    </div>
  );
};

const FederatedSourcesSummary: React.FC<{
  sources: FederatedSourceStatus[];
  pendingCount?: number;
}> = ({ sources, pendingCount = 0 }) => {
  const ok = sources.filter((s) => s.status === "ok");
  const failed = sources.filter((s) => s.status !== "ok");
  return (
    <div
      data-testid="federated-sources-summary"
      style={{
        fontSize: "calc(11px * var(--bs-font-scale, 1))",
        color: "#64748b",
        letterSpacing: "0.05em",
        marginTop: 6,
      }}
    >
      Checked {sources.length} source{sources.length === 1 ? "" : "s"} — {ok.length} responded
      {pendingCount > 0 && (
        <span data-testid="federated-sources-pending" style={{ color: "#7dd3fc" }}>
          {" "}· still checking {pendingCount}…
        </span>
      )}
      {failed.length > 0 && (
        <span style={{ color: "#f59e0b" }}>
          {" "}· unavailable: {failed.map((s) => s.label).join(", ")}
        </span>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Area-request labels
// ---------------------------------------------------------------------------

/** Best-effort UUID for area-request grouping (crypto.randomUUID when available). */
function newAreaRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // RFC-4122-ish v4 fallback for older WebViews; the server only requires a
  // UUID-shaped string, uniqueness per search is what matters.
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );
}

/** "57.05°N, 135.33°W" style coordinate summary for auto-folder names. */
function formatLatLonLabel(lat: number, lon: number): string {
  const latStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
  const lonStr = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  return `${latStr}, ${lonStr}`;
}

/** Human-readable label for a "west,south,east,north" bbox string. */
function bboxStringLabel(bboxStr: string): string | null {
  const center = bboxStringCenter(bboxStr);
  if (!center) return null;
  return `Area ${formatLatLonLabel(center.lat, center.lon)}`;
}

/** Center point of a "west,south,east,north" bbox string. */
function bboxStringCenter(bboxStr: string): { lat: number; lon: number } | null {
  const parts = bboxStr.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts as [number, number, number, number];
  return { lat: (south + north) / 2, lon: (west + east) / 2 };
}

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
  const { setDatasetId, setCatalogSourcedAt, setPendingExternalUserDatasetId, datasetId: currentDatasetId } = useAppState();
  const { isSignedIn, isLoaded } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  // Terrain store — used to derive "Add to View" state for catalog cards and
  // to gate NCEI WCS saves (which require an active terrain area bbox).
  const terrainVisibleDatasets = useTerrainStore((s) => s.visibleDatasets);
  const terrainSelectedIds = useTerrainStore((s) => s.selectedIds);
  const terrainActiveGrid = useTerrainStore((s) => s.activeGrid);

  const hasCatalogPrimary = terrainVisibleDatasets.length > 0;
  const atCatalogCap = terrainSelectedIds.length >= MAX_ACTIVE_DATASETS;
  // Set of all dataset IDs currently selected (active or queued) — for "IN VIEW" state.
  const catalogSelectedIdSet = useMemo(
    () => new Set([
      ...terrainVisibleDatasets.map((v) => v.datasetId),
      ...terrainSelectedIds,
    ]),
    [terrainVisibleDatasets, terrainSelectedIds],
  );

  const handleCatalogAddToView = useCallback((presetId: string, dataUpdatedAt?: string | null) => {
    const state = useTerrainStore.getState();
    state.addSelected(presetId, "preset", dataUpdatedAt);
  }, []);

  // ADD-to-view handler for materialized federated results (user datasets).
  // Mirrors DatasetPanel.handleAddToView: toggle-removes when already visible,
  // otherwise adds alongside the current primary.
  const handleFederatedAddToView = useCallback((dsId: string) => {
    const state = useTerrainStore.getState();
    const alreadyVisible = state.visibleDatasets.some((v) => v.datasetId === dsId);
    if (alreadyVisible) {
      state.toggleVisible({ datasetId: dsId, source: "user" });
    } else {
      state.addSelected(dsId, "user");
    }
  }, []);

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
  const { data: rawSearchResults = [], isFetching: isSearching, dataUpdatedAt: catalogDataUpdatedAt } = useGetDatasetsCatalogSearch(
    searchParams,
    {
      query: {
        queryKey: getGetDatasetsCatalogSearchQueryKey(searchParams),
        enabled: tab === "search" && debouncedQuery.trim().length > 0,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- qc is a stable QueryClient ref; waterType is the sole invalidation trigger (searchParams changes self-refetch via react-query)
  }, [waterType]);

  // My Saves — polled to keep savedCatalogIds current and to feed handleSaveFolderResponse
  const {
    data: mySaves = [],
    refetch: refetchSaves,
  } = useGetDatasetsMySaves({
    query: {
      queryKey: getGetDatasetsMySavesQueryKey(),
      // Always fetch when signed in so the search tab can reflect already-saved
      // entries without requiring the user to visit the saves tab first.
      enabled: isLoaded && isSignedIn === true,
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
  // Catalog IDs that are already saved (any non-failed status). Used to disable
  // the Save button on search results when a save already exists, preventing
  // duplicate saves and greying out "ready" entries across panel re-opens.
  const savedCatalogIds = useMemo(
    () => new Set(mySaves.filter((s) => s.status !== "failed").map((s) => s.catalogId)),
    [mySaves],
  );

  // Map from federated item.id → materialized user datasetId for any save that
  // has completed (status="ready" with a datasetId). Drives the ADD / IN VIEW
  // button on FederatedResultCard — only items already in the library can be
  // added alongside an active dataset in the viewer.
  const federatedMaterializedMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const save of mySaves) {
      if (save.status === "ready" && save.datasetId && save.catalogId) {
        m.set(save.catalogId, save.datasetId);
      }
    }
    return m;
  }, [mySaves]);

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

  // -------------------------------------------------------------------------
  // Area-request grouping context.
  //
  // Every save issued from one area search carries the same client-generated
  // request id; when more than two saves share an id, the server auto-creates
  // a dataset folder named after the search and routes all of the request's
  // saves (including ones still downloading/processing) into it. The id is
  // regenerated whenever the effective search context changes, so each
  // distinct search gets its own folder.
  // -------------------------------------------------------------------------
  const areaRequestRef = useRef<{ key: string; id: string } | null>(null);
  const currentAreaSearch = useMemo<{
    key: string;
    label: string;
    center?: { lat: number; lon: number };
  } | null>(() => {
    if (tab === "ncei") {
      const q = debouncedNceiQuery.trim();
      if (q) return { key: `ncei:q:${q.toLowerCase()}`, label: q };
      if (viewportBboxString) {
        // Coordinate/viewport-driven search — include the center point so
        // the server can name the auto-folder after a nearby place instead
        // of raw coordinates (label stays as the fallback name).
        const label = coordSearchArea
          ? `Area ${formatLatLonLabel(coordSearchArea.lat, coordSearchArea.lon)} (${coordSearchArea.radiusKm} km)`
          : bboxStringLabel(viewportBboxString);
        const center = coordSearchArea
          ? { lat: coordSearchArea.lat, lon: coordSearchArea.lon }
          : bboxStringCenter(viewportBboxString);
        if (label) {
          return {
            key: `ncei:bbox:${viewportBboxString}`,
            label,
            ...(center ? { center } : {}),
          };
        }
      }
      return null;
    }
    // Search tab — catalog + federated results are keyed by the query text.
    const q = debouncedQuery.trim();
    if (q) return { key: `search:q:${q.toLowerCase()}`, label: q };
    return null;
  }, [tab, debouncedQuery, debouncedNceiQuery, viewportBboxString, coordSearchArea]);

  const getAreaRequest = useCallback(():
    | { id: string; label: string; center?: { lat: number; lon: number } }
    | undefined => {
    if (!currentAreaSearch) return undefined;
    if (!areaRequestRef.current || areaRequestRef.current.key !== currentAreaSearch.key) {
      areaRequestRef.current = { key: currentAreaSearch.key, id: newAreaRequestId() };
    }
    return {
      id: areaRequestRef.current.id,
      label: currentAreaSearch.label,
      ...(currentAreaSearch.center ? { center: currentAreaSearch.center } : {}),
    };
  }, [currentAreaSearch]);

  // When a save response comes back stamped with a folderId, an auto-folder
  // was created (or reused) server-side — refresh the folder tree and the
  // user-datasets list so the new folder and any moved items appear
  // immediately in the Dataset Library and My Saves views.
  const handleSaveFolderResponse = useCallback(
    (row: UserCatalogSave | undefined) => {
      if (!row?.folderId) return;
      void qc.invalidateQueries({ queryKey: getGetUserFoldersQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
    },
    [qc],
  );

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
    dataUpdatedAt: nceiDataUpdatedAt,
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
        const areaRequest = getAreaRequest();
        const row = await nceiSaveMutation.mutateAsync({
          data: { result, ...(areaRequest ? { areaRequest } : {}) },
        });
        handleSaveFolderResponse(row);
        void refetchSaves().catch(() => {
          toast({
            title: "Saved, but couldn't refresh the list — reload to see it.",
          });
        });
      } catch {
        toast({ title: "Failed to save. Please try again.", variant: "destructive" });
      } finally {
        setNceiSavingIds((s) => {
          const next = new Set(s);
          next.delete(result.id);
          return next;
        });
      }
    },
    [isSignedIn, nceiSaveMutation, refetchSaves, getAreaRequest, handleSaveFolderResponse, toast],
  );

  // Generic save for importable non-NCEI federated results — goes through
  // POST /search/federated/save (same catalog-save/materialize pipeline).
  const federatedSaveMutation = usePostSearchFederatedSave();
  const handleFederatedSave = useCallback(
    async (item: FederatedSearchResult) => {
      if (!isSignedIn) return;
      setNceiSavingIds((s) => new Set(s).add(item.id));
      try {
        const areaRequest = getAreaRequest();
        const row = await federatedSaveMutation.mutateAsync({
          data: { result: item, ...(areaRequest ? { areaRequest } : {}) },
        });
        handleSaveFolderResponse(row);
        void refetchSaves().catch(() => {
          toast({
            title: "Saved, but couldn't refresh the list — reload to see it.",
          });
        });
      } catch {
        toast({ title: "Failed to save. Please try again.", variant: "destructive" });
      } finally {
        setNceiSavingIds((s) => {
          const next = new Set(s);
          next.delete(item.id);
          return next;
        });
      }
    },
    [isSignedIn, federatedSaveMutation, refetchSaves, getAreaRequest, handleSaveFolderResponse, toast],
  );

  // Federated multi-source search (Search tab, "External sources" section).
  //
  // Partial-results fan-out: the client fetches the static connector
  // registry once, then issues ONE /search/federated request per source id.
  // Each source's results render the moment its request resolves — a slow
  // or dead upstream never blocks the rest (its per-source timeout on the
  // server caps the worst case, and here it just stays "checking…" until
  // then). Local catalog results already render above this section, so the
  // local-catalog connector is excluded from the fan-out entirely.
  const federatedActive = tab === "search" && debouncedQuery.trim().length > 0;
  const { data: federatedSourceRegistry } = useGetSearchFederatedSources({
    query: {
      queryKey: getGetSearchFederatedSourcesQueryKey(),
      enabled: federatedActive,
      staleTime: Infinity,
    },
  });
  const externalSourceInfos = useMemo(
    () => (federatedSourceRegistry?.sources ?? []).filter((s) => s.id !== "local-catalog"),
    [federatedSourceRegistry],
  );

  const federatedQueries = useQueries({
    queries: externalSourceInfos.map((src) => {
      const params = { q: debouncedQuery || undefined, sources: src.id };
      return {
        queryKey: getGetSearchFederatedQueryKey(params),
        queryFn: ({ signal }: { signal?: AbortSignal }) =>
          getSearchFederated(params, { signal }),
        enabled: federatedActive,
        staleTime: 5 * 60 * 1000,
        retry: false,
      };
    }),
  });

  // True while the registry itself or ALL sources are still loading (the
  // very first paint); once any source resolves we render partial results.
  const isFederatedSearching =
    federatedActive &&
    (externalSourceInfos.length === 0 ||
      federatedQueries.every((q) => q.isPending));
  const federatedSettled =
    federatedActive &&
    externalSourceInfos.length > 0 &&
    federatedQueries.some((s) => !s.isPending);
  const federatedPendingCount = federatedQueries.filter((q) => q.isPending).length;

  // Derived plainly (no useMemo): the source list length varies as the
  // registry loads, so a spread dependency array would change size between
  // renders — a React hooks violation. The arrays are tiny; recomputing per
  // render is cheap.
  const federatedExternalResults = federatedQueries.flatMap(
    (q) => (q.data?.results ?? []).filter((r) => r.sourceId !== "local-catalog"),
  );
  // Per-source status merged from each query: server-reported status when
  // the request resolved, a synthetic "error" row when the request itself
  // failed, and nothing while still pending (counted separately).
  const federatedSources = externalSourceInfos.flatMap((src, i) => {
    const q = federatedQueries[i];
    if (!q || q.isPending) return [];
    if (q.error || !q.data) {
      return [{
        sourceId: src.id,
        label: src.label,
        status: "error" as const,
        resultCount: 0,
        tookMs: 0,
        error: "Request failed",
      }];
    }
    return q.data.sources;
  });

  const saveMutation = usePostDatasetsCatalogIdSave();
  const handleSave = useCallback(
    async (id: string) => {
      if (!isSignedIn) return;
      setSavingIds((s) => new Set(s).add(id));
      try {
        const areaRequest = getAreaRequest();

        // For NCEI WCS catalog entries, read the active terrain's bbox and
        // send it as requestBbox so the materializer fetches that specific
        // surveyed corridor rather than the full multi-degree coverage bbox
        // (which times out or returns a near-flat grid with no coverage).
        let requestBbox: { minLon: number; minLat: number; maxLon: number; maxLat: number } | undefined;
        if (id.startsWith("ncei-")) {
          const grid = useTerrainStore.getState().activeGrid;
          if (grid && isFinite(grid.minLon) && isFinite(grid.maxLon) && isFinite(grid.minLat) && isFinite(grid.maxLat)) {
            requestBbox = {
              minLon: grid.minLon,
              minLat: grid.minLat,
              maxLon: grid.maxLon,
              maxLat: grid.maxLat,
            };
          }
        }

        const row = await saveMutation.mutateAsync({
          id,
          data: {
            ...(areaRequest ? { areaRequest } : {}),
            ...(requestBbox ? { requestBbox } : {}),
          },
        });
        handleSaveFolderResponse(row);
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
    [isSignedIn, saveMutation, refetchSaves, getAreaRequest, handleSaveFolderResponse],
  );

  const handleLoad = useCallback(
    (presetDatasetId: string) => {
      const entry = searchResults.find(
        (e) => e.id === `preset-${presetDatasetId}` || e.id === presetDatasetId,
      );
      const createdAt = entry?.createdAt ?? null;
      void requestDatasetSwitch({
        datasetId: presetDatasetId,
        onConfirm: () => {
          setDatasetId(presetDatasetId);
          setCatalogSourcedAt({ forDatasetId: presetDatasetId, date: createdAt });
          onClose();
        },
      });
    },
    [setDatasetId, setCatalogSourcedAt, searchResults, onClose],
  );

  // ── My Saves tab — load callbacks ─────────────────────────────────────────
  // Mirror of DatasetPanel's handleLoadCatalogSaveFromLeft / handleLoadUserDatasetFromLeft
  // but also calls onClose() so FindDataPanel closes after the load is queued.

  // NOTE: Both load handlers below intentionally catch any error thrown by
  // `requestDatasetSwitch` (e.g. an uncaught exception escaping its internal
  // try/catch) and surface it as a toast. `onClose()` is NOT called in the
  // catch block so the panel stays open and the user can retry.
  // Future callers of `requestDatasetSwitch` should follow the same pattern —
  // always wrap in try/catch and show a toast on failure.

  const handleLoadCatalogSave = useCallback(
    async (save: UserCatalogSave) => {
      const previewId = save.datasetId ?? save.catalogId;
      const datasetName = save.displayLabel ?? save.catalog?.name ?? save.catalogId;
      try {
        await requestDatasetSwitch({
          datasetId: previewId,
          datasetName,
          onConfirm: () => {
            setPendingExternalUserDatasetId(save.datasetId!);
            setCatalogSourcedAt({ forDatasetId: save.datasetId!, date: save.catalog?.createdAt ?? null });
            onClose();
          },
        });
      } catch {
        toast({ title: "Couldn't load dataset — please try again.", variant: "destructive" });
      }
    },
    [setPendingExternalUserDatasetId, setCatalogSourcedAt, onClose, toast],
  );

  const handleLoadUserDataset = useCallback(
    async (userDatasetId: string, createdAt?: string | null) => {
      try {
        await requestDatasetSwitch({
          datasetId: userDatasetId,
          onConfirm: () => {
            setPendingExternalUserDatasetId(userDatasetId);
            setCatalogSourcedAt({ forDatasetId: userDatasetId, date: createdAt ?? null });
            onClose();
          },
        });
      } catch {
        toast({ title: "Couldn't load dataset — please try again.", variant: "destructive" });
      }
    },
    [setPendingExternalUserDatasetId, setCatalogSourcedAt, onClose, toast],
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
              fontSize: "calc(21px * var(--bs-font-scale, 1))",
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
        <ViewscreenTooltip label="Browse the NOAA/NCEI Bathymetry Geoportal" side="bottom">
          <button style={tabStyle(tab === "ncei")} onClick={() => { hasUserInteractedRef.current = true; setTab("ncei"); }}>
            NCEI Portal
          </button>
        </ViewscreenTooltip>
        <ViewscreenTooltip label="Your saved and uploaded datasets" side="bottom">
          <button style={tabStyle(tab === "my-saves")} onClick={() => setTab("my-saves")} data-testid="find-data-my-saves-tab">
            My Saves
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
                    fontSize: "calc(12px * var(--bs-font-scale, 1))",
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
              <div style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#94a3b8", marginTop: 4 }}>Searching…</div>
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
                  fontSize: "calc(12px * var(--bs-font-scale, 1))",
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
              <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", textAlign: "center", paddingTop: 32 }}>
                {debouncedQuery
                  ? "No results found — try different keywords"
                  : "Type a query to discover datasets"}
              </div>
            )}
            {!isSignedIn && (
              <div
                style={{
                  fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
              // NCEI WCS catalog entries require an active terrain bbox to materialise
              // a meaningful survey corridor.  Disable Save when no terrain is loaded.
              const isNceiWcsEntry = entry.id.startsWith("ncei-");
              const saveBlockedReason =
                isNceiWcsEntry && !terrainActiveGrid
                  ? "Load a terrain in this area first, then save to download it."
                  : undefined;
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
                  hasPrimary={hasCatalogPrimary}
                  inView={presetId !== null && catalogSelectedIdSet.has(presetId)}
                  atCap={atCatalogCap}
                  onAddToView={handleCatalogAddToView}
                  saveBlockedReason={saveBlockedReason}
                />
              );
            })}
            {searchResults.length > 0 && catalogDataUpdatedAt > 0 && !isSearching && (
              <div style={{ fontSize: "calc(11px * var(--bs-font-scale, 1))", color: "#475569", letterSpacing: "0.06em", textAlign: "right", paddingTop: 6, paddingBottom: 2 }}>
                Results as of {formatFreshness(catalogDataUpdatedAt)}
              </div>
            )}

            {/* External sources — federated multi-source search */}
            {debouncedQuery.trim().length > 0 && (
              <div data-testid="federated-section" style={{ marginTop: 14 }}>
                <div
                  style={{
                    fontSize: "calc(11px * var(--bs-font-scale, 1))",
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                    color: "#7dd3fc",
                    borderTop: "1px solid rgba(0,229,255,0.12)",
                    paddingTop: 10,
                  }}
                >
                  🌐 External sources
                </div>
                {isFederatedSearching && (
                  <div style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#94a3b8", marginTop: 4 }}>
                    Checking external sources…
                  </div>
                )}
                {federatedSettled && (
                  <>
                    <FederatedSourcesSummary
                      sources={federatedSources}
                      pendingCount={federatedPendingCount}
                    />
                    {federatedExternalResults.length === 0 && federatedPendingCount === 0 && (
                      <div style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#94a3b8", marginTop: 6 }}>
                        No external results for this query.
                      </div>
                    )}
                    {federatedExternalResults.map((item) => {
                      const addDsId = federatedMaterializedMap.get(federatedItemToCatalogId(item)) ?? null;
                      const itemInView = addDsId ? catalogSelectedIdSet.has(addDsId) : false;
                      return (
                        <FederatedResultCard
                          key={item.id}
                          item={item}
                          canSave={!!isSignedIn}
                          saving={
                            nceiSavingIds.has(item.id.replace(/^ncei-geoportal:/, "")) ||
                            nceiSavingIds.has(item.id)
                          }
                          onSaveNcei={handleNceiSave}
                          onSaveFederated={handleFederatedSave}
                          onAddToView={hasCatalogPrimary ? handleFederatedAddToView : undefined}
                          addDsId={addDsId}
                          inView={itemInView}
                          atViewCap={atCatalogCap}
                        />
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
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
                fontSize: "calc(12px * var(--bs-font-scale, 1))",
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
              <div style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#94a3b8", marginTop: 4 }}>Searching…</div>
            )}
            {nceiError && (
              <div style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#f87171", marginTop: 4 }}>
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
                  fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
                style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", textAlign: "center", paddingTop: 32 }}
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
            {nceiAccumulated.length > 0 && nceiDataUpdatedAt > 0 && !isNceiSearching && (
              <div style={{ fontSize: "calc(11px * var(--bs-font-scale, 1))", color: "#475569", letterSpacing: "0.06em", textAlign: "right", paddingTop: 6, paddingBottom: 2 }}>
                Results as of {formatFreshness(nceiDataUpdatedAt)}
              </div>
            )}
            {isNceiSearching && nceiFrom > 1 && (
              <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", textAlign: "center", padding: "8px 0" }}>
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
                  fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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

      {/* My Saves tab */}
      {tab === "my-saves" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 14px 14px" }} data-testid="find-data-my-saves-content">
          <MySavesSection
            onLoadCatalogSave={handleLoadCatalogSave}
            onLoadUserDataset={handleLoadUserDataset}
            onBrowseDatasets={() => setTab("search")}
            browseLabel="SEARCH DATASETS →"
          />
        </div>
      )}

      {/* Footer attribution */}
      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid rgba(0,229,255,0.08)",
          fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
          color: "#64748b",
          letterSpacing: "0.05em",
        }}
      >
        Sources: NOAA/NCEI · GEBCO · Alaska ADF&G · USGS CoNED
      </div>
    </div>
  );
};
