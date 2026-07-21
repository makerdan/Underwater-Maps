import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePostUserDatasetsIdGeoref,
  getGetUserDatasetsQueryKey,
  getUserDatasetsIdRasterImage,
} from "@workspace/api-client-react";
import type { UserDatasetMeta, GeorefControlPoint } from "@workspace/api-client-react";

interface Props {
  dataset: UserDatasetMeta;
  onClose: () => void;
  onSuccess: (updated: UserDatasetMeta) => void;
}

const MAX_POINTS = 4;
const MIN_POINTS = 2;

interface PendingPoint {
  px: number;
  py: number;
  lon: string;
  lat: string;
}

export const GeoreferenceModal: React.FC<Props> = ({ dataset, onClose, onSuccess }) => {
  const qc = useQueryClient();

  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [imgLoading, setImgLoading] = useState(true);
  const [naturalW, setNaturalW] = useState(1);
  const [naturalH, setNaturalH] = useState(1);

  const [points, setPoints] = useState<PendingPoint[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const georefMutation = usePostUserDatasetsIdGeoref();

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    const loadImage = async () => {
      setImgLoading(true);
      setImgError(null);
      try {
        const blob = await getUserDatasetsIdRasterImage(dataset.id);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImgSrc(objectUrl);
      } catch (err) {
        if (!cancelled) {
          setImgError(err instanceof Error ? err.message : "Failed to load raster image.");
        }
      } finally {
        if (!cancelled) setImgLoading(false);
      }
    };

    void loadImage();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [dataset.id]);

  const handleImageClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (!imgRef.current || points.length >= MAX_POINTS) return;
    const rect = imgRef.current.getBoundingClientRect();
    const scaleX = naturalW / rect.width;
    const scaleY = naturalH / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    setPoints((prev) => [...prev, { px, py, lon: "", lat: "" }]);
  }, [points.length, naturalW, naturalH]);

  const updatePoint = (idx: number, field: "lon" | "lat", value: string) => {
    setPoints((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const removePoint = (idx: number) => {
    setPoints((prev) => prev.filter((_, i) => i !== idx));
  };

  const isValid = points.length >= MIN_POINTS && points.every((p) => {
    const lon = parseFloat(p.lon);
    const lat = parseFloat(p.lat);
    return !isNaN(lon) && !isNaN(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
  });

  const handleSubmit = () => {
    if (!isValid) return;
    setSubmitError(null);

    const controlPoints: GeorefControlPoint[] = points.map((p) => ({
      px: p.px,
      py: p.py,
      lon: parseFloat(p.lon),
      lat: parseFloat(p.lat),
    }));

    georefMutation.mutate(
      { id: dataset.id, data: { controlPoints } },
      {
        onSuccess: (updated) => {
          qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
          onSuccess(updated);
        },
        onError: (err) => {
          setSubmitError(err instanceof Error ? err.message : "Submission failed. Please try again.");
        },
      }
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Georeference ${dataset.name}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(3px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#0f172a",
          border: "1px solid rgba(148,163,184,0.18)",
          borderRadius: 10,
          padding: "22px 22px 18px",
          width: "min(92vw, 900px)",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: "calc(21px * var(--bs-font-scale, 1))", fontWeight: 700, color: "#e2e8f0", letterSpacing: "0.01em" }}>
              Georeference Raster
            </div>
            <div style={{ fontSize: "calc(16.5px * var(--bs-font-scale, 1))", color: "#64748b", marginTop: 2 }}>
              {dataset.name}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              color: "#64748b",
              fontSize: "calc(27px * var(--bs-font-scale, 1))",
              cursor: "pointer",
              lineHeight: 1,
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Instruction */}
        <div style={{
          fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
          color: "#94a3b8",
          padding: "8px 10px",
          background: "rgba(245,158,11,0.06)",
          border: "1px solid rgba(245,158,11,0.18)",
          borderRadius: 6,
          lineHeight: 1.5,
        }}>
          <strong style={{ color: "#f59e0b" }}>How to georeference:</strong> Click 2–4 recognisable points on the
          scanned chart below, then enter the real-world longitude and latitude for each one.
          Use chart labels, coastline corners, or grid intersections.
        </div>

        {/* Image + overlays */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            minHeight: 200,
            overflow: "auto",
            position: "relative",
            borderRadius: 6,
            border: "1px solid rgba(148,163,184,0.12)",
            background: "#020617",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "flex-start",
          }}
        >
          {imgLoading && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: "calc(18px * var(--bs-font-scale, 1))" }}>
              Loading raster image…
            </div>
          )}
          {imgError && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <span style={{ fontSize: "calc(42px * var(--bs-font-scale, 1))" }}>⚠️</span>
              <span style={{ fontSize: "calc(18px * var(--bs-font-scale, 1))", color: "#f87171", textAlign: "center", maxWidth: 320 }}>{imgError}</span>
              <span style={{ fontSize: "calc(16.5px * var(--bs-font-scale, 1))", color: "#64748b" }}>
                The raster image may have exceeded the 20 MB storage cap, or was not captured during upload.
              </span>
            </div>
          )}
          {imgSrc && (
            <div style={{ position: "relative", display: "inline-block" }}>
              <img
                ref={imgRef}
                src={imgSrc}
                alt="Scanned raster chart"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setNaturalW(img.naturalWidth || 1);
                  setNaturalH(img.naturalHeight || 1);
                }}
                onClick={handleImageClick}
                style={{
                  display: "block",
                  maxWidth: "100%",
                  cursor: points.length >= MAX_POINTS ? "not-allowed" : "crosshair",
                  userSelect: "none",
                }}
                draggable={false}
              />
              {/* Control point pins */}
              {imgRef.current && points.map((p, i) => {
                const rect = imgRef.current!.getBoundingClientRect();
                const scaleX = rect.width / naturalW;
                const scaleY = rect.height / naturalH;
                const x = p.px * scaleX;
                const y = p.py * scaleY;
                return (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: x,
                      top: y,
                      transform: "translate(-50%, -50%)",
                      pointerEvents: "none",
                      zIndex: 10,
                    }}
                  >
                    <div style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: "rgba(245,158,11,0.85)",
                      border: "2px solid #fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "calc(15px * var(--bs-font-scale, 1))",
                      fontWeight: 700,
                      color: "#000",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
                    }}>
                      {i + 1}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Control points table */}
        {points.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: "calc(16.5px * var(--bs-font-scale, 1))", color: "#94a3b8", marginBottom: 2 }}>Control points</div>
            {points.map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  width: 20, height: 20, borderRadius: "50%",
                  background: "rgba(245,158,11,0.85)", border: "2px solid #fff",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: "calc(15px * var(--bs-font-scale, 1))", fontWeight: 700, color: "#000", flexShrink: 0,
                }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: "calc(15px * var(--bs-font-scale, 1))", color: "#64748b", flexShrink: 0, minWidth: 90 }}>
                  px ({Math.round(p.px)}, {Math.round(p.py)})
                </span>
                <input
                  type="number"
                  step="any"
                  placeholder="Longitude"
                  value={p.lon}
                  onChange={(e) => updatePoint(i, "lon", e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="number"
                  step="any"
                  placeholder="Latitude"
                  value={p.lat}
                  onChange={(e) => updatePoint(i, "lat", e.target.value)}
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => removePoint(i)}
                  aria-label={`Remove point ${i + 1}`}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#64748b",
                    cursor: "pointer",
                    fontSize: "calc(21px * var(--bs-font-scale, 1))",
                    lineHeight: 1,
                    padding: "0 4px",
                    flexShrink: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {points.length === 0 && !imgLoading && !imgError && (
          <div style={{ fontSize: "calc(16.5px * var(--bs-font-scale, 1))", color: "#475569", textAlign: "center" }}>
            Click on the chart image above to place your first control point.
          </div>
        )}

        {points.length >= MAX_POINTS && (
          <div style={{ fontSize: "calc(16.5px * var(--bs-font-scale, 1))", color: "#64748b" }}>
            Maximum of {MAX_POINTS} control points reached.
          </div>
        )}

        {submitError && (
          <div style={{ fontSize: "calc(16.5px * var(--bs-font-scale, 1))", color: "#f87171", padding: "6px 8px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 4 }}>
            {submitError}
          </div>
        )}

        {/* Footer actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid rgba(148,163,184,0.1)", paddingTop: 12 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={georefMutation.isPending}
            style={{
              padding: "6px 16px",
              fontSize: "calc(18px * var(--bs-font-scale, 1))",
              background: "transparent",
              border: "1px solid rgba(148,163,184,0.25)",
              borderRadius: 5,
              color: "#94a3b8",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || georefMutation.isPending}
            style={{
              padding: "6px 18px",
              fontSize: "calc(18px * var(--bs-font-scale, 1))",
              fontWeight: 600,
              background: isValid && !georefMutation.isPending
                ? "rgba(245,158,11,0.85)"
                : "rgba(245,158,11,0.25)",
              border: "none",
              borderRadius: 5,
              color: isValid && !georefMutation.isPending ? "#000" : "#78350f",
              cursor: isValid && !georefMutation.isPending ? "pointer" : "not-allowed",
              transition: "background 0.15s",
            }}
          >
            {georefMutation.isPending ? "Saving…" : `Save ${points.length} Control Point${points.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "3px 8px",
  fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
  background: "rgba(148,163,184,0.06)",
  border: "1px solid rgba(148,163,184,0.18)",
  borderRadius: 4,
  color: "#e2e8f0",
  outline: "none",
};
