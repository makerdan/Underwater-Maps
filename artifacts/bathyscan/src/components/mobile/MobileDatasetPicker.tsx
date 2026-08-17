/**
 * MobileDatasetPicker — MOBILE-ONLY: compact dataset switcher for the mobile
 * Chart View. The full Explore sidebar (DatasetPanel) is not shown on mobile;
 * this reduced picker lists the catalog datasets for the active water type
 * plus the signed-in user's uploaded datasets, and switches the chosen
 * dataset with a single tap.
 *
 * Offline-download support: each row carries an offline-status badge and a
 * per-dataset "⬇" download button; each section has a "⬇ All" shortcut.
 * Tapping either calls the `onDownloadOffline` prop with a ready-to-run
 * `BulkDataset[]` array — the shell host renders `BulkOfflinePanel` from there.
 *
 * Loading plumbing is entirely reused: selecting an entry calls
 * terrainStore.setSinglePrimary(), and the always-mounted
 * VisibleDatasetsLoader fetches the terrain + overview grids exactly as it
 * does for desktop flows.
 */
import React from "react";
import {
  useGetDatasets,
  getGetDatasetsQueryKey,
  useGetUserDatasets,
  getGetUserDatasetsQueryKey,
  type DatasetMeta,
  type UserDatasetMeta,
} from "@workspace/api-client-react";
import { useTerrainStore, type DatasetSource } from "@/lib/terrainStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useAuth } from "@/lib/clerkCompat";
import { useOfflinePackStatuses, type PackStatus } from "@/hooks/useOfflinePackStatus";
import type { BulkDataset } from "@/hooks/useBulkOfflinePack";

// ── Helpers to build BulkDataset from catalog/user items ──────────────────

function catalogToBulkDataset(d: DatasetMeta): BulkDataset {
  return { id: d.id, name: d.name, bbox: d.bbox };
}

function userToBulkDataset(d: UserDatasetMeta): BulkDataset {
  return {
    id: d.id,
    name: d.name,
    bbox: d.bbox ?? undefined,
    ...(d.resolutionM != null ? { resolutionM: d.resolutionM } : {}),
  };
}

// ── Offline status badge ───────────────────────────────────────────────────

/** MOBILE-ONLY: compact inline offline-status indicator. */
function OfflineStatusBadge({ status }: { status: PackStatus }) {
  if (status === "none") return null;
  const isStale = status === "stale";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
        color: isStale ? "#fbbf24" : "#4ade80",
        background: isStale ? "rgba(251,191,36,0.12)" : "rgba(74,222,128,0.12)",
        border: `1px solid ${isStale ? "rgba(251,191,36,0.3)" : "rgba(74,222,128,0.3)"}`,
        borderRadius: 4,
        padding: "1px 5px",
        marginLeft: 8,
        flexShrink: 0,
        fontFamily: "'JetBrains Mono', monospace",
      }}
      title={isStale ? "Offline pack saved but tide data has expired" : "Available offline"}
    >
      {isStale ? "⟳ Stale" : "✓ Offline"}
    </span>
  );
}

// ── Download button ────────────────────────────────────────────────────────

/** MOBILE-ONLY: 44×44 touch-target download icon button. */
function DownloadBtn({
  onClick,
  label,
}: {
  onClick: (e: React.MouseEvent) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        color: "#94a3b8",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "calc(18px * var(--bs-font-scale, 1))",
        minWidth: 44,
        minHeight: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      ⬇
    </button>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────

interface MobileDatasetPickerProps {
  onClose: () => void;
  /**
   * Called when the user requests an offline download. Receives a
   * ready-to-use BulkDataset[] and a human-readable scope label.
   * The shell host is responsible for rendering BulkOfflinePanel.
   */
  onDownloadOffline: (datasets: BulkDataset[], scopeLabel: string) => void;
}

export const MobileDatasetPicker: React.FC<MobileDatasetPickerProps> = ({
  onClose,
  onDownloadOffline,
}) => {
  const waterType = useSettingsStore((s) => s.waterType);
  const { isLoaded, isSignedIn } = useAuth();
  const primaryDatasetId = useTerrainStore((s) => s.primaryDatasetId);
  const packStatuses = useOfflinePackStatuses();

  const { data: datasets, isLoading: datasetsLoading } = useGetDatasets(
    { waterType },
    { query: { queryKey: getGetDatasetsQueryKey({ waterType }) } },
  );
  const { data: userDatasets } = useGetUserDatasets({
    query: {
      enabled: isLoaded && isSignedIn === true,
      queryKey: getGetUserDatasetsQueryKey(),
    },
  });

  const select = (datasetId: string, source: DatasetSource) => {
    // Replace ALL visible datasets with the chosen one and let
    // VisibleDatasetsLoader stream its grids in — the mobile chart is
    // single-dataset by design ("the chosen dataset").
    useTerrainStore.getState().setSinglePrimary(datasetId, source);
    onClose();
  };

  // ── Styles ───────────────────────────────────────────────────────────────

  const headerRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 4,
  };

  const headerStyle: React.CSSProperties = {
    padding: "10px 16px 6px",
    color: "#64748b",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
    letterSpacing: "0.2em",
    textTransform: "uppercase",
    flex: 1,
  };

  const sectionDownloadBtnStyle: React.CSSProperties = {
    background: "none",
    border: "1px solid rgba(0,229,255,0.2)",
    borderRadius: 5,
    color: "#64748b",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "calc(11px * var(--bs-font-scale, 1))",
    padding: "3px 10px",
    marginRight: 8,
    minHeight: 32,
    cursor: "pointer",
    letterSpacing: "0.05em",
  };

  return (
    // MOBILE-ONLY: full-screen scrim + bottom sheet-style list.
    <div
      data-testid="mobile-dataset-picker"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 60,
        background: "rgba(2,8,24,0.72)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Choose dataset"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxHeight: "70%",
          overflowY: "auto",
          background: "rgba(2,8,18,0.97)",
          borderTop: "1px solid rgba(0,229,255,0.25)",
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid rgba(0,229,255,0.15)",
          }}
        >
          <span
            style={{
              color: "#00e5ff",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(12.5px * var(--bs-font-scale, 1))",
              letterSpacing: "0.2em",
            }}
          >
            CHOOSE DATASET
          </span>
          <button
            type="button"
            aria-label="Close dataset picker"
            data-testid="mobile-dataset-picker-close"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              fontSize: "calc(22px * var(--bs-font-scale, 1))",
              minWidth: 44,
              minHeight: 44,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        {datasetsLoading && (
          <div
            style={{
              padding: "16px",
              color: "#64748b",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
            }}
          >
            Loading datasets…
          </div>
        )}

        {/* ── My datasets section ─────────────────────────────────────── */}
        {(userDatasets?.length ?? 0) > 0 && (
          <>
            <div style={headerRowStyle}>
              <div style={headerStyle}>My datasets</div>
              <button
                type="button"
                aria-label="Download all my datasets offline"
                data-testid="mobile-picker-download-all-user"
                style={sectionDownloadBtnStyle}
                onClick={() => {
                  const bulk = (userDatasets ?? []).map(userToBulkDataset);
                  onDownloadOffline(bulk, "My datasets");
                }}
              >
                ⬇ All
              </button>
            </div>

            {userDatasets!.map((d) => {
              const status = packStatuses.get(d.id) ?? "none";
              const isActive = d.id === primaryDatasetId;
              return (
                <div
                  key={d.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    borderBottom: "1px solid rgba(0,229,255,0.08)",
                    background: isActive ? "rgba(0,229,255,0.12)" : "transparent",
                  }}
                >
                  {/* Selection target */}
                  <button
                    type="button"
                    data-testid={`mobile-dataset-option-${d.id}`}
                    onClick={() => select(d.id, "user")}
                    style={{
                      flex: 1,
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      color: isActive ? "#00e5ff" : "#cbd5e1",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "calc(14px * var(--bs-font-scale, 1))",
                      padding: "14px 16px",
                      minHeight: 48,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                    >
                      {d.name}
                    </span>
                    <OfflineStatusBadge status={status} />
                  </button>
                  {/* Per-dataset download */}
                  <DownloadBtn
                    label={`Download ${d.name} offline`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownloadOffline([userToBulkDataset(d)], d.name);
                    }}
                  />
                </div>
              );
            })}
          </>
        )}

        {/* ── Catalog section ─────────────────────────────────────────── */}
        {(datasets?.length ?? 0) > 0 && (
          <>
            <div style={headerRowStyle}>
              <div style={headerStyle}>Catalog</div>
              <button
                type="button"
                aria-label="Download all catalog datasets offline"
                data-testid="mobile-picker-download-all-catalog"
                style={sectionDownloadBtnStyle}
                onClick={() => {
                  const bulk = (datasets ?? []).map(catalogToBulkDataset);
                  onDownloadOffline(bulk, "All catalog datasets");
                }}
              >
                ⬇ All
              </button>
            </div>

            {datasets!.map((d) => {
              const status = packStatuses.get(d.id) ?? "none";
              const isActive = d.id === primaryDatasetId;
              return (
                <div
                  key={d.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    borderBottom: "1px solid rgba(0,229,255,0.08)",
                    background: isActive ? "rgba(0,229,255,0.12)" : "transparent",
                  }}
                >
                  {/* Selection target */}
                  <button
                    type="button"
                    data-testid={`mobile-dataset-option-${d.id}`}
                    onClick={() => select(d.id, "preset")}
                    style={{
                      flex: 1,
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      color: isActive ? "#00e5ff" : "#cbd5e1",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "calc(14px * var(--bs-font-scale, 1))",
                      padding: "14px 16px",
                      minHeight: 48,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                    >
                      {d.name}
                    </span>
                    <OfflineStatusBadge status={status} />
                  </button>
                  {/* Per-dataset download */}
                  <DownloadBtn
                    label={`Download ${d.name} offline`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownloadOffline([catalogToBulkDataset(d)], d.name);
                    }}
                  />
                </div>
              );
            })}
          </>
        )}

        {!datasetsLoading && (datasets?.length ?? 0) === 0 && (userDatasets?.length ?? 0) === 0 && (
          <div
            style={{
              padding: "16px",
              color: "#64748b",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
            }}
          >
            No datasets available for this water type.
          </div>
        )}
      </div>
    </div>
  );
};
