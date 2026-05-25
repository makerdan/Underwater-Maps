/**
 * MarkerForm — floating panel for creating a persisted seafloor marker.
 *
 * Opened by pressing G or right-clicking the canvas in fly mode.
 * Pre-fills lon/lat/depth from cameraStore.lastClickedGps.
 * On submit, calls usePostMarkers and invalidates the markers query.
 */
import React, { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";
import { useAppState } from "@/lib/context";
import {
  usePostMarkers,
  getGetMarkersQueryKey,
  MarkerInputType,
} from "@workspace/api-client-react";
import {
  MARKER_TYPES,
  MARKER_COLOR,
  type MarkerTypeValue,
} from "@/lib/markerConstants";

const PANEL: React.CSSProperties = {
  background: "rgba(2,8,24,0.92)",
  border: "1px solid rgba(0,229,255,0.25)",
  borderRadius: 8,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  color: "#94a3b8",
  fontSize: 11,
  width: 300,
  backdropFilter: "blur(8px)",
  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
};

export const MarkerForm: React.FC = () => {
  const gps = useCameraStore((s) => s.lastClickedGps);
  const setMarkerFormOpen = useUiStore((s) => s.setMarkerFormOpen);
  const { terrain } = useAppState();
  const qc = useQueryClient();

  const [markerType, setMarkerType] = useState<MarkerTypeValue>(MarkerInputType.custom);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [labelError, setLabelError] = useState("");

  // Reset form whenever it opens (gps changes)
  useEffect(() => {
    setLabel("");
    setNotes("");
    setLabelError("");
    setMarkerType("custom");
  }, [gps]);

  const postMarkers = usePostMarkers();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) {
      setLabelError("Label is required");
      return;
    }
    if (!gps || !terrain) return;

    postMarkers.mutate(
      {
        data: {
          datasetId: terrain.datasetId,
          lon: gps.lon,
          lat: gps.lat,
          depth: gps.depth,
          type: markerType,
          label: label.trim().slice(0, 60),
          notes: notes.trim().slice(0, 500) || null,
        },
      },
      {
        onSuccess: () => {
          void qc.invalidateQueries({
            queryKey: getGetMarkersQueryKey({ datasetId: terrain.datasetId }),
          });
          setMarkerFormOpen(false);
        },
      },
    );
  };

  const handleCancel = () => setMarkerFormOpen(false);

  if (!gps || !terrain) return null;

  const selectedType = MARKER_TYPES.find((t) => t.value === markerType);

  return (
    <div style={PANEL}>
      {/* Header */}
      <div
        style={{
          borderBottom: "1px solid rgba(0,229,255,0.12)",
          padding: "10px 14px 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.2em",
            color: "#00e5ff",
            textShadow: "0 0 6px rgba(0,229,255,0.5)",
            fontWeight: 700,
          }}
        >
          ▼ DROP MARKER
        </span>
        <button
          onClick={handleCancel}
          style={{
            background: "none",
            border: "none",
            color: "#475569",
            fontSize: 14,
            cursor: "pointer",
            lineHeight: 1,
            padding: "0 2px",
          }}
          title="Cancel"
        >
          ×
        </button>
      </div>

      {/* Coordinates (read-only) */}
      <div
        style={{
          padding: "7px 14px 6px",
          borderBottom: "1px solid rgba(0,229,255,0.08)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 6,
        }}
      >
        {[
          { key: "lon",   val: gps.lon.toFixed(4) },
          { key: "lat",   val: gps.lat.toFixed(4) },
          { key: "depth", val: `${Math.round(gps.depth)}m` },
        ].map(({ key, val }) => (
          <div key={key}>
            <div style={{ fontSize: 8, letterSpacing: "0.12em", color: "#334155", marginBottom: 1 }}>
              {key.toUpperCase()}
            </div>
            <div style={{ fontSize: 10, color: "#64748b" }}>{val}</div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        {/* Type selector */}
        <div style={{ padding: "9px 14px 4px" }}>
          <div style={{ fontSize: 8, letterSpacing: "0.12em", color: "#334155", marginBottom: 5 }}>
            TYPE
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {MARKER_TYPES.map((t) => {
              const active = markerType === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setMarkerType(t.value)}
                  style={{
                    fontSize: 9,
                    padding: "3px 7px",
                    borderRadius: 3,
                    border: `1px solid ${active ? t.color : "rgba(0,229,255,0.12)"}`,
                    background: active ? `${t.color}18` : "transparent",
                    color: active ? t.color : "#475569",
                    cursor: "pointer",
                    letterSpacing: "0.08em",
                    transition: "all 0.1s",
                    fontFamily: "inherit",
                  }}
                >
                  {t.icon} {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Label */}
        <div style={{ padding: "8px 14px 4px" }}>
          <label
            style={{ display: "block", fontSize: 8, letterSpacing: "0.12em", color: "#334155", marginBottom: 4 }}
          >
            LABEL *
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value.slice(0, 60));
              if (e.target.value.trim()) setLabelError("");
            }}
            placeholder="e.g. Large school of rockfish"
            maxLength={60}
            style={{
              width: "100%",
              background: "rgba(0,229,255,0.04)",
              border: `1px solid ${labelError ? "#ef4444" : "rgba(0,229,255,0.15)"}`,
              borderRadius: 3,
              color: "#e2e8f0",
              fontSize: 11,
              padding: "5px 8px",
              fontFamily: "inherit",
              boxSizing: "border-box",
              outline: "none",
            }}
          />
          {labelError && (
            <div style={{ fontSize: 9, color: "#ef4444", marginTop: 3 }}>⚠ {labelError}</div>
          )}
          <div style={{ fontSize: 8, color: "#1e293b", marginTop: 2, textAlign: "right" }}>
            {label.length}/60
          </div>
        </div>

        {/* Notes */}
        <div style={{ padding: "4px 14px 8px" }}>
          <label
            style={{ display: "block", fontSize: 8, letterSpacing: "0.12em", color: "#334155", marginBottom: 4 }}
          >
            NOTES (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
            placeholder="Additional observations..."
            maxLength={500}
            rows={3}
            style={{
              width: "100%",
              background: "rgba(0,229,255,0.04)",
              border: "1px solid rgba(0,229,255,0.12)",
              borderRadius: 3,
              color: "#e2e8f0",
              fontSize: 11,
              padding: "5px 8px",
              fontFamily: "inherit",
              resize: "none",
              boxSizing: "border-box",
              outline: "none",
            }}
          />
          <div style={{ fontSize: 8, color: "#1e293b", textAlign: "right" }}>{notes.length}/500</div>
        </div>

        {/* Actions */}
        <div
          style={{
            borderTop: "1px solid rgba(0,229,255,0.08)",
            padding: "8px 14px",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={handleCancel}
            style={{
              fontSize: 9,
              letterSpacing: "0.12em",
              padding: "5px 14px",
              borderRadius: 3,
              border: "1px solid rgba(0,229,255,0.12)",
              background: "transparent",
              color: "#475569",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            CANCEL
          </button>
          <button
            type="submit"
            disabled={postMarkers.isPending}
            style={{
              fontSize: 9,
              letterSpacing: "0.12em",
              padding: "5px 14px",
              borderRadius: 3,
              border: `1px solid ${selectedType?.color ?? "#00e5ff"}`,
              background: `${selectedType?.color ?? "#00e5ff"}18`,
              color: selectedType?.color ?? "#00e5ff",
              cursor: postMarkers.isPending ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              opacity: postMarkers.isPending ? 0.6 : 1,
            }}
          >
            {postMarkers.isPending ? "SAVING..." : "SAVE MARKER"}
          </button>
        </div>
      </form>
    </div>
  );
};
