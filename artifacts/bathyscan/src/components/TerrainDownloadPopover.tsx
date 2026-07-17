/**
 * TerrainDownloadPopover — confirmation panel for the Overview Map download tool.
 *
 * Shown after the user draws a bounding box in Download mode.  Displays:
 *   - Selected area in km²
 *   - Source badge (NCEI BAG / GEBCO / …)
 *   - Estimated point count at the chosen resolution
 *   - Resolution picker (Low 64×64 / Medium 256×256 / High 512×512)
 *   - Download button (auth-gated)
 *
 * The component calls /api/terrain/download/info for the preflight and
 * triggers a fetch + blob download from /api/terrain/download.
 */
import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/lib/clerkCompat";
import { useToast } from "@/hooks/use-toast";
import { buildBathyscanDownloadFilename } from "@/lib/gpsExport";
import { triggerBlobDownload } from "@/lib/blobDownload";
import { authorizedFetch } from "@/lib/authorizedFetch";

type Resolution = 64 | 256 | 512;

interface DownloadBbox {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface InfoResult {
  sourceName: string;
  dataSource: string;
  nominalResolutionM: number;
  /** Fraction of N×N grid cells that contain water (0–1). Used to derive
   *  estimatedPoints = resolution² × waterFraction client-side so resolution
   *  switching is instant and does not trigger a new preflight fetch. */
  waterFraction: number;
}

interface Props {
  bbox: DownloadBbox;
  onClose: () => void;
}

// Haversine distance in km between two lat/lon pairs
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bboxAreaKm2(bbox: DownloadBbox): number {
  const widthKm = haversineKm(bbox.south, bbox.west, bbox.south, bbox.east);
  const heightKm = haversineKm(bbox.south, bbox.west, bbox.north, bbox.west);
  return widthKm * heightKm;
}

const RESOLUTION_LABELS: Record<Resolution, string> = {
  64: "Low (64 × 64)",
  256: "Medium (256 × 256)",
  512: "High (512 × 512)",
};

export const TerrainDownloadPopover: React.FC<Props> = ({ bbox, onClose }) => {
  const { isSignedIn } = useAuth();
  const { toast } = useToast();

  const [resolution, setResolution] = useState<Resolution>(256);
  // Backdrop dismissal guard: only close when a full press (mousedown AND
  // click) lands on the backdrop itself. The rubber-band drag that opens this
  // popover ends with a mouseup/click at the release point — by then the
  // backdrop has already mounted under the cursor, so the browser-synthesized
  // click targets the backdrop and would immediately dismiss it. Since that
  // click's mousedown happened on the map canvas (before mount), requiring
  // the mousedown to originate on the backdrop filters it out.
  const backdropMouseDownRef = React.useRef(false);
  const [info, setInfo] = useState<InfoResult | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const areaKm2 = bboxAreaKm2(bbox);
  const centerLat = (bbox.north + bbox.south) / 2;
  const centerLon = (bbox.east + bbox.west) / 2;

  // Fetch preflight info once per bbox (resolution is excluded — the server
  // always probes at N=32 and returns waterFraction; estimatedPoints is
  // derived locally so resolution switching is instant with no extra fetch).
  const fetchInfo = useCallback(async () => {
    if (!isSignedIn) return;
    setInfoLoading(true);
    setInfoError(null);
    setInfo(null);
    try {
      const params = new URLSearchParams({
        north: String(bbox.north),
        south: String(bbox.south),
        east: String(bbox.east),
        west: String(bbox.west),
      });
      const resp = await authorizedFetch(`/api/terrain/download/info?${params.toString()}`);
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { details?: string };
        throw new Error(body.details ?? `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as InfoResult;
      setInfo(data);
    } catch (err) {
      setInfoError(err instanceof Error ? err.message : "Preflight failed");
    } finally {
      setInfoLoading(false);
    }
  }, [bbox, isSignedIn]);

  useEffect(() => {
    void fetchInfo();
  }, [fetchInfo]);

  const handleDownload = useCallback(async () => {
    if (!isSignedIn || downloading) return;
    setDownloading(true);
    try {
      const params = new URLSearchParams({
        north: String(bbox.north),
        south: String(bbox.south),
        east: String(bbox.east),
        west: String(bbox.west),
        resolution: String(resolution),
      });
      const resp = await authorizedFetch(`/api/terrain/download?${params.toString()}`);
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { details?: string };
        throw new Error(body.details ?? `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const filename = buildBathyscanDownloadFilename(centerLat, centerLon, resolution);
      triggerBlobDownload(blob, filename);
      const pts = info ? Math.round(resolution * resolution * info.waterFraction) : null;
      toast({
        title: "Download ready",
        description: `Saved as ${filename} (${pts?.toLocaleString() ?? "?"} points).`,
      });
      onClose();
    } catch (err) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  }, [bbox, resolution, isSignedIn, downloading, centerLat, centerLon, info, toast, onClose]);

  const MONO: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 16.5,
    color: "#cbd5e1",
  };

  const body = (
    <div
      role="dialog"
      aria-label="Download bathymetric data"
      data-testid="terrain-download-popover"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2,8,24,0.65)",
        backdropFilter: "blur(3px)",
        zIndex: 9100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...MONO,
      }}
      onMouseDown={(e) => {
        backdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const startedOnBackdrop = backdropMouseDownRef.current;
        backdropMouseDownRef.current = false;
        if (e.target === e.currentTarget && startedOnBackdrop) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 400,
          maxWidth: "92vw",
          background: "rgba(2,8,24,0.97)",
          border: "1px solid rgba(0,229,255,0.3)",
          borderRadius: 8,
          boxShadow: "0 16px 56px rgba(0,0,0,0.75)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid rgba(0,229,255,0.12)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              color: "#00e5ff",
              letterSpacing: "0.18em",
              fontWeight: 700,
              fontSize: 16.5,
            }}
          >
            ↓ DOWNLOAD BATHYMETRY
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              fontSize: 24,
              cursor: "pointer",
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 14 }}>
          {/* Auth gate */}
          {!isSignedIn && (
            <div
              data-testid="terrain-download-auth-gate"
              style={{
                padding: "10px 12px",
                background: "rgba(251,191,36,0.07)",
                border: "1px solid rgba(251,191,36,0.3)",
                borderRadius: 4,
                color: "#fbbf24",
                fontSize: 15,
                marginBottom: 12,
                lineHeight: 1.5,
              }}
            >
              Sign in to download bathymetric data. Your download will match
              exactly what is displayed in the 3D view.
            </div>
          )}

          {/* Area summary */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              marginBottom: 12,
              padding: "10px 12px",
              background: "rgba(0,229,255,0.04)",
              border: "1px solid rgba(0,229,255,0.12)",
              borderRadius: 4,
              fontSize: 15,
            }}
          >
            <div>
              <div style={{ color: "#cbd5e1", marginBottom: 2 }}>AREA</div>
              <div style={{ color: "#e2e8f0", fontSize: 19.5 }}>
                {areaKm2 < 1
                  ? `${(areaKm2 * 1000).toFixed(0)} km²`
                  : `${areaKm2.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} km²`}
              </div>
            </div>
            <div>
              <div style={{ color: "#cbd5e1", marginBottom: 2 }}>CENTRE</div>
              <div style={{ color: "#e2e8f0" }}>
                {Math.abs(centerLat).toFixed(3)}°{centerLat >= 0 ? "N" : "S"}{" "}
                {Math.abs(centerLon).toFixed(3)}°{centerLon >= 0 ? "E" : "W"}
              </div>
            </div>

            {/* Source info */}
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ color: "#cbd5e1", marginBottom: 2 }}>SOURCE</div>
              {infoLoading ? (
                <div style={{ color: "#94a3b8" }}>probing…</div>
              ) : infoError ? (
                <div style={{ color: "#f87171", fontSize: 15 }}>{infoError}</div>
              ) : info ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "1px 6px",
                      borderRadius: 3,
                      fontSize: 13.5,
                      letterSpacing: "0.1em",
                      background:
                        info.dataSource === "ncei"
                          ? "rgba(34,197,94,0.12)"
                          : info.dataSource === "gebco"
                            ? "rgba(59,130,246,0.12)"
                            : "rgba(251,191,36,0.12)",
                      border: `1px solid ${
                        info.dataSource === "ncei"
                          ? "rgba(34,197,94,0.4)"
                          : info.dataSource === "gebco"
                            ? "rgba(59,130,246,0.4)"
                            : "rgba(251,191,36,0.4)"
                      }`,
                      color:
                        info.dataSource === "ncei"
                          ? "#4ade80"
                          : info.dataSource === "gebco"
                            ? "#60a5fa"
                            : "#fbbf24",
                    }}
                  >
                    {info.sourceName}
                  </span>
                </div>
              ) : null}
            </div>

            {/* Estimated points — derived locally so resolution switching is instant */}
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ color: "#cbd5e1", marginBottom: 2 }}>EST. WATER POINTS</div>
              {infoLoading ? (
                <div style={{ color: "#94a3b8" }}>calculating…</div>
              ) : info ? (
                <div style={{ color: "#e2e8f0" }}>
                  {Math.round(resolution * resolution * info.waterFraction).toLocaleString()} points at {resolution}×{resolution}
                </div>
              ) : null}
            </div>
          </div>

          {/* Resolution picker */}
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 13.5,
                color: "#cbd5e1",
                letterSpacing: "0.12em",
                marginBottom: 6,
              }}
            >
              RESOLUTION
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {([64, 256, 512] as Resolution[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setResolution(r)}
                  style={{
                    flex: 1,
                    padding: "5px 4px",
                    background:
                      resolution === r
                        ? "rgba(0,229,255,0.15)"
                        : "rgba(2,8,24,0.5)",
                    border: `1px solid ${
                      resolution === r
                        ? "rgba(0,229,255,0.55)"
                        : "rgba(0,229,255,0.15)"
                    }`,
                    borderRadius: 3,
                    color: resolution === r ? "#00e5ff" : "#94a3b8",
                    fontFamily: "inherit",
                    fontSize: 13.5,
                    letterSpacing: "0.05em",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {RESOLUTION_LABELS[r]}
                </button>
              ))}
            </div>
          </div>

          {/* Filename preview */}
          {isSignedIn && (
            <div
              style={{
                padding: "6px 10px",
                background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 3,
                fontSize: 13.5,
                color: "#94a3b8",
                marginBottom: 12,
                letterSpacing: "0.04em",
              }}
            >
              {buildBathyscanDownloadFilename(centerLat, centerLon, resolution)}
            </div>
          )}

          {/* Action buttons */}
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
            }}
          >
            <button
              onClick={onClose}
              style={btnStyle("ghost")}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleDownload()}
              disabled={!isSignedIn || downloading || infoLoading}
              data-testid="terrain-download-confirm"
              style={{
                ...btnStyle("primary"),
                opacity: !isSignedIn || downloading || infoLoading ? 0.5 : 1,
                cursor:
                  !isSignedIn || downloading || infoLoading
                    ? "not-allowed"
                    : "pointer",
                minWidth: 100,
              }}
            >
              {downloading ? "Downloading…" : "↓ Download"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
};

function btnStyle(variant: "primary" | "ghost"): React.CSSProperties {
  if (variant === "primary") {
    return {
      padding: "6px 14px",
      background: "rgba(0,229,255,0.15)",
      border: "1px solid rgba(0,229,255,0.4)",
      borderRadius: 3,
      color: "#00e5ff",
      cursor: "pointer",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 16.5,
      letterSpacing: "0.1em",
    };
  }
  return {
    padding: "6px 14px",
    background: "transparent",
    border: "1px solid rgba(148,163,184,0.3)",
    borderRadius: 3,
    color: "#e2e8f0",
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 16.5,
    letterSpacing: "0.1em",
  };
}
