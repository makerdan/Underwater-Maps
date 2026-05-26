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

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  useGetDatasetsCatalogSearch,
  useGetDatasetsMySaves,
  usePostDatasetsCatalogIdSave,
  getGetDatasetsCatalogSearchQueryKey,
  getGetDatasetsMySavesQueryKey,
  type GetDatasetsCatalogSearchDataType,
  type DatasetCatalogSearchResult,
  type UserCatalogSave,
} from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { requestDatasetSwitch } from "@/lib/simulatedDataStore";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { HelpIcon } from "@/components/help/HelpButton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = "search" | "saves";

const DATA_TYPE_ICONS: Record<string, string> = {
  bathymetry: "🌊",
  substrate: "🪨",
  habitat: "🐟",
  lidar: "📡",
  chart: "🗺️",
};

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
  top: 0,
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
  fontSize: 10,
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
    fontSize: 9,
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    background: "none",
    border: "none",
    borderBottom: active ? "2px solid #00e5ff" : "2px solid transparent",
    color: active ? "#00e5ff" : "#475569",
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
  fontSize: 11,
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
// Catalog result card
// ---------------------------------------------------------------------------

interface CatalogCardProps {
  entry: DatasetCatalogSearchResult;
  onSave: (id: string) => void;
  saving: boolean;
  saved: boolean;
  presetId?: string | null;
  onLoad: (presetDatasetId: string) => void;
}

const CatalogCard: React.FC<CatalogCardProps> = ({ entry, onSave, saving, saved, presetId: _presetId, onLoad: _onLoad }) => {
  void _presetId;
  void _onLoad;
  const icon = DATA_TYPE_ICONS[entry.dataType] ?? "📦";
  const color = DATA_TYPE_COLORS[entry.dataType] ?? "#94a3b8";

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#e2e8f0", marginBottom: 2, lineHeight: 1.3 }}>
            {entry.name}
          </div>
          <div style={{ fontSize: 8, color, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {entry.dataType} · {entry.sourceAgency}
          </div>
        </div>
        <span
          style={{
            fontSize: 8,
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

      {entry.description && (
        <div style={{ fontSize: 9, color: "#64748b", lineHeight: 1.5, marginBottom: 6 }}>
          {entry.description.slice(0, 120)}
          {entry.description.length > 120 && "…"}
        </div>
      )}

      <div style={{ display: "flex", gap: 4, fontSize: 8, color: "#475569", marginBottom: 6 }}>
        {entry.resolutionMMin != null && (
          <span>{entry.resolutionMMin}–{entry.resolutionMMax ?? "?"}m res</span>
        )}
        {entry.lastUpdated && (
          <span>· Updated {entry.lastUpdated.slice(0, 7)}</span>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <ViewscreenTooltip label={saved ? "Already in your saved list" : "Save to your library"} side="top">
        <button
          onClick={() => !saved && !saving && onSave(entry.id)}
          disabled={saved || saving}
          style={{
            fontSize: 8,
            padding: "3px 10px",
            background: saved ? "rgba(74,222,128,0.1)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${saved ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.1)"}`,
            borderRadius: 3,
            color: saved ? "#4ade80" : "#64748b",
            cursor: saved ? "default" : "pointer",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </button>
        </ViewscreenTooltip>
      </div>

      <div style={scoreBarStyle(entry.relevanceScore)} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// My Saves card
// ---------------------------------------------------------------------------

const SaveCard: React.FC<{
  save: UserCatalogSave;
  onLoad: (id: string) => void;
}> = ({ save, onLoad: _onLoad }) => {
  void _onLoad;
  const statusColor = STATUS_COLORS[save.status] ?? "#94a3b8";
  const icon = save.catalog ? (DATA_TYPE_ICONS[save.catalog.dataType] ?? "📦") : "📦";

  return (
    <div style={{ ...CARD, borderLeft: `2px solid ${statusColor}40` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: "#e2e8f0", fontWeight: 600, marginBottom: 1 }}>
            {save.catalog?.name ?? save.catalogId}
          </div>
          <div style={{ fontSize: 8, color: "#475569" }}>
            {save.catalog?.sourceAgency ?? "—"}
          </div>
        </div>
        <span
          style={{
            fontSize: 8,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: statusColor,
          }}
        >
          {save.status}
        </span>
      </div>
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { setDatasetId } = useAppState();

  // Debounce search query
  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(val), 400);
  }, []);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // Catalog search
  const searchParams = {
    q: debouncedQuery || undefined,
    dataType: (dataTypeFilter || undefined) as GetDatasetsCatalogSearchDataType | undefined,
  };
  const { data: searchResults = [], isFetching: isSearching } = useGetDatasetsCatalogSearch(
    searchParams,
    {
      query: {
        queryKey: getGetDatasetsCatalogSearchQueryKey(searchParams),
        enabled: tab === "search",
        staleTime: 30_000,
      },
    },
  );

  // My Saves
  const {
    data: mySaves = [],
    refetch: refetchSaves,
    isFetching: isSaveFetching,
  } = useGetDatasetsMySaves({
    query: {
      queryKey: getGetDatasetsMySavesQueryKey(),
      enabled: tab === "saves",
    },
  });

  const saveMutation = usePostDatasetsCatalogIdSave();

  const handleSave = useCallback(
    async (id: string) => {
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
    [saveMutation, refetchSaves],
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
              color: "#475569",
              cursor: "pointer",
              fontSize: 14,
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
          <button style={tabStyle(tab === "search")} onClick={() => setTab("search")}>
            Search
          </button>
        </ViewscreenTooltip>
        <ViewscreenTooltip label="See datasets you saved" side="bottom">
          <button style={tabStyle(tab === "saves")} onClick={() => setTab("saves")}>
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
              {["", "bathymetry", "substrate", "habitat", "lidar", "chart"].map((dt) => (
                <ViewscreenTooltip key={dt} label={dt === "" ? "Show all data types" : `Filter to ${dt} datasets`} side="bottom">
                <button
                  onClick={() => setDataTypeFilter(dt)}
                  style={{
                    fontSize: 8,
                    padding: "2px 8px",
                    borderRadius: 3,
                    border: `1px solid ${dataTypeFilter === dt ? "rgba(0,229,255,0.4)" : "rgba(255,255,255,0.08)"}`,
                    background: dataTypeFilter === dt ? "rgba(0,229,255,0.1)" : "transparent",
                    color: dataTypeFilter === dt ? "#00e5ff" : "#475569",
                    cursor: "pointer",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  {dt === "" ? "All" : (DATA_TYPE_ICONS[dt] ?? "") + " " + dt}
                </button>
                </ViewscreenTooltip>
              ))}
            </div>
            {isSearching && (
              <div style={{ fontSize: 8, color: "#475569", marginTop: 4 }}>Searching…</div>
            )}
          </div>

          {/* Results */}
          <div
            style={{ flex: 1, overflowY: "auto", padding: "0 14px 14px" }}
            data-testid="find-data-results"
          >
            {searchResults.length === 0 && !isSearching && (
              <div style={{ fontSize: 9, color: "#475569", textAlign: "center", paddingTop: 32 }}>
                {debouncedQuery
                  ? "No results found — try different keywords"
                  : "Type a query to discover datasets"}
              </div>
            )}
            {searchResults.map((entry) => (
              <CatalogCard
                key={entry.id}
                entry={entry}
                onSave={handleSave}
                saving={savingIds.has(entry.id)}
                saved={savedIds.has(entry.id)}
                onLoad={handleLoad}
              />
            ))}
          </div>
        </div>
      )}

      {/* My Saves tab */}
      {tab === "saves" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
          {isSaveFetching && (
            <div style={{ fontSize: 9, color: "#475569", marginBottom: 8 }}>Loading…</div>
          )}
          {!isSaveFetching && mySaves.length === 0 && (
            <div style={{ fontSize: 9, color: "#475569", textAlign: "center", paddingTop: 32 }}>
              No saved datasets yet — search and save some above
            </div>
          )}
          {mySaves.map((save) => (
            <SaveCard key={save.id} save={save} onLoad={handleLoad} />
          ))}
        </div>
      )}

      {/* Footer attribution */}
      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid rgba(0,229,255,0.08)",
          fontSize: 7,
          color: "#334155",
          letterSpacing: "0.05em",
        }}
      >
        Sources: NOAA/NCEI · GEBCO · Alaska ADF&G · USGS CoNED
      </div>
    </div>
  );
};
