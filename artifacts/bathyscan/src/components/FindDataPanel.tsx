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
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDatasetsCatalogSearch,
  useGetDatasetsMySaves,
  usePostDatasetsCatalogIdSave,
  usePostDatasetsMySavesIdRetry,
  useDeleteDatasetsMySavesId,
  getGetDatasetsCatalogSearchQueryKey,
  getGetDatasetsMySavesQueryKey,
  getGetUserDatasetsQueryKey,
  type GetDatasetsCatalogSearchDataType,
  type DatasetCatalogSearchResult,
  type UserCatalogSave,
} from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useAuth } from "@/lib/clerkCompat";
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
  canSave: boolean;
  presetId: string | null;
  onLoad: (presetDatasetId: string) => void;
}

const CatalogCard: React.FC<CatalogCardProps> = ({ entry, onSave, saving, saved, canSave, presetId, onLoad }) => {
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
        {presetId && (
          <ViewscreenTooltip label="Open this dataset in the viewer" side="top">
            <button
              onClick={() => onLoad(presetId)}
              style={{
                fontSize: 8,
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
              fontSize: 8,
              padding: "3px 10px",
              background: saved ? "rgba(74,222,128,0.1)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${saved ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.1)"}`,
              borderRadius: 3,
              color: !canSave ? "#334155" : saved ? "#4ade80" : "#64748b",
              cursor: !canSave || saved ? "default" : "pointer",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              opacity: !canSave ? 0.6 : 1,
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
  onLoadUserDataset: (userDatasetId: string) => void;
  onRetry: (saveId: string) => void;
  retrying: boolean;
  onDelete: (save: UserCatalogSave) => void;
  deleting: boolean;
}> = ({ save, onLoadUserDataset, onRetry, retrying, onDelete, deleting }) => {
  const statusColor = STATUS_COLORS[save.status] ?? "#94a3b8";
  const icon = save.catalog ? (DATA_TYPE_ICONS[save.catalog.dataType] ?? "📦") : "📦";

  return (
    <div
      style={{ ...CARD, borderLeft: `2px solid ${statusColor}40`, opacity: deleting ? 0.5 : 1 }}
      data-testid={`save-card-${save.id}`}
      aria-busy={deleting || undefined}
    >
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
              color: "#64748b",
              cursor: deleting ? "wait" : "pointer",
              fontSize: 12,
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
              fontSize: 8,
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
            <div style={{ marginTop: 6, fontSize: 8, color: "#f87171", lineHeight: 1.4 }}>
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
                fontSize: 8,
                padding: "3px 12px",
                background: "rgba(248,113,113,0.1)",
                border: "1px solid rgba(248,113,113,0.3)",
                borderRadius: 3,
                color: retrying ? "#64748b" : "#f87171",
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
  const { setDatasetId, setPendingExternalUserDatasetId } = useAppState();
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

  const visibleSaves = mySaves.filter((s) => !pendingDeleteSaveIds.has(s.id));

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
            {!isSignedIn && (
              <div
                style={{
                  fontSize: 9,
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
          {isSaveFetching && (
            <div style={{ fontSize: 9, color: "#475569", marginBottom: 8 }}>Loading…</div>
          )}
          {!isSaveFetching && visibleSaves.length === 0 && (
            <div style={{ fontSize: 9, color: "#475569", textAlign: "center", paddingTop: 32 }}>
              No saved datasets yet — search and save some above
            </div>
          )}
          {!isSignedIn && (
            <div style={{ fontSize: 9, color: "#f59e0b", textAlign: "center", paddingTop: 32 }}>
              Sign in to see saved datasets.
            </div>
          )}
          {deleteError && (
            <div
              data-testid="save-delete-error"
              style={{
                marginBottom: 8,
                padding: "6px 8px",
                border: "1px solid rgba(248,113,113,0.4)",
                background: "rgba(248,113,113,0.08)",
                borderRadius: 4,
                fontSize: 9,
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
                  color: "#64748b",
                  cursor: "pointer",
                  fontSize: 10,
                }}
              >
                ×
              </button>
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
                fontSize: 11,
                color: "#e2e8f0",
                fontWeight: 700,
                marginBottom: 8,
                letterSpacing: "0.05em",
              }}
            >
              Delete &ldquo;{confirmDelete.catalog?.name ?? confirmDelete.catalogId}&rdquo;?
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.5, marginBottom: 14 }}>
              This will remove the saved dataset and its terrain grids from your library.
              You can re-save it from the catalog later.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setConfirmDelete(null)}
                data-testid="confirm-delete-cancel"
                style={{
                  fontSize: 9,
                  padding: "5px 12px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 3,
                  color: "#94a3b8",
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
                  fontSize: 9,
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
