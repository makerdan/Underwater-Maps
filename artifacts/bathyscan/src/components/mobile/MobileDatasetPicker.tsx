/**
 * MobileDatasetPicker — MOBILE-ONLY: compact dataset switcher for the mobile
 * Chart View. The full Explore sidebar (DatasetPanel) is not shown on mobile;
 * this reduced picker lists the catalog datasets for the active water type
 * plus the signed-in user's uploaded datasets, and switches the chosen
 * dataset with a single tap.
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
} from "@workspace/api-client-react";
import { useTerrainStore, type DatasetSource } from "@/lib/terrainStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useAuth } from "@/lib/clerkCompat";

interface MobileDatasetPickerProps {
  onClose: () => void;
}

export const MobileDatasetPicker: React.FC<MobileDatasetPickerProps> = ({ onClose }) => {
  const waterType = useSettingsStore((s) => s.waterType);
  const { isLoaded, isSignedIn } = useAuth();
  const primaryDatasetId = useTerrainStore((s) => s.primaryDatasetId);

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

  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: "block",
    width: "100%",
    textAlign: "left",
    background: active ? "rgba(0,229,255,0.12)" : "transparent",
    border: "none",
    borderBottom: "1px solid rgba(0,229,255,0.08)",
    color: active ? "#00e5ff" : "#cbd5e1",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "calc(14px * var(--bs-font-scale, 1))",
    padding: "14px 16px", // MOBILE-ONLY: ≥44px touch rows
    minHeight: 48,
    cursor: "pointer",
  });

  const headerStyle: React.CSSProperties = {
    padding: "10px 16px 6px",
    color: "#64748b",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
    letterSpacing: "0.2em",
    textTransform: "uppercase",
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
          <div style={{ ...headerStyle, padding: "16px" }}>Loading datasets…</div>
        )}

        {(userDatasets?.length ?? 0) > 0 && (
          <>
            <div style={headerStyle}>My datasets</div>
            {userDatasets!.map((d) => (
              <button
                key={d.id}
                type="button"
                data-testid={`mobile-dataset-option-${d.id}`}
                onClick={() => select(d.id, "user")}
                style={rowStyle(d.id === primaryDatasetId)}
              >
                {d.name}
              </button>
            ))}
          </>
        )}

        {(datasets?.length ?? 0) > 0 && (
          <>
            <div style={headerStyle}>Catalog</div>
            {datasets!.map((d) => (
              <button
                key={d.id}
                type="button"
                data-testid={`mobile-dataset-option-${d.id}`}
                onClick={() => select(d.id, "preset")}
                style={rowStyle(d.id === primaryDatasetId)}
              >
                {d.name}
              </button>
            ))}
          </>
        )}

        {!datasetsLoading && (datasets?.length ?? 0) === 0 && (userDatasets?.length ?? 0) === 0 && (
          <div style={{ ...headerStyle, padding: "16px" }}>
            No datasets available for this water type.
          </div>
        )}
      </div>
    </div>
  );
};
