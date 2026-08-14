/**
 * EnvOfflineSection — "WEATHER & OCEAN DATA" card inside DataStorageSection.
 *
 * Shows the last-downloaded env pack status and a "Download All for Offline
 * Use" button that calls /api/env-pack for the user's current map centre
 * (default: SE Alaska) with radiusMiles=15 and days=14.
 */
import React, { useState } from "react";
import { useEnvOfflineStore, ENV_PACK_IDB_KEY } from "@/lib/envOfflineStore";
import { useToast } from "@/hooks/use-toast";
import { S } from "./styles";

// SE Alaska default centre (used when no map position is available).
const DEFAULT_LAT = 57.05;
const DEFAULT_LON = -135.33;

/** Small chip matching the offline/stale badge pattern used in TidePanel. */
function CachedDataChip() {
  return (
    <span
      data-testid="env-cached-chip"
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: 3,
        background: "rgba(251,191,36,0.15)",
        color: "#fbbf24",
        fontSize: "calc(8px * var(--bs-font-scale, 1))",
        fontWeight: 700,
        letterSpacing: "0.04em",
        marginLeft: 6,
        verticalAlign: "middle",
      }}
    >
      ⚡ CACHED
    </span>
  );
}

interface Props {
  /** Current map centre (degrees). Defaults to SE Alaska when omitted. */
  centerLat?: number;
  centerLon?: number;
}

export function EnvOfflineSection({ centerLat, centerLon }: Props) {
  const envPack = useEnvOfflineStore((s) => s.envPack);
  const isDownloading = useEnvOfflineStore((s) => s.isDownloading);
  const downloadError = useEnvOfflineStore((s) => s.downloadError);
  const isExpired = useEnvOfflineStore((s) => s.isExpired);
  const downloadEnvPack = useEnvOfflineStore((s) => s.downloadEnvPack);
  const clearEnvPack = useEnvOfflineStore((s) => s.clearEnvPack);
  const idbHydrationError = useEnvOfflineStore((s) => s.idbHydrationError);
  const { toast } = useToast();

  const [deleteError, setDeleteError] = useState<string | null>(null);

  const lat = centerLat ?? DEFAULT_LAT;
  const lon = centerLon ?? DEFAULT_LON;

  const expired = isExpired();

  const handleDownload = async () => {
    try {
      await downloadEnvPack(lat, lon, 15, 14);
      toast({ title: "Weather & ocean data downloaded", duration: 3000 });
    } catch {
      // downloadError is set by the store; no additional toast needed.
    }
  };

  const handleDelete = async () => {
    setDeleteError(null);
    try {
      await clearEnvPack();
      toast({ title: "Cached weather data deleted", duration: 3000 });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed — please try again");
    }
  };

  // Format helpers
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  return (
    <div style={S.card}>
      <div style={S.cardHeader}>WEATHER &amp; OCEAN DATA</div>
      <div style={{ padding: "12px 16px" }}>
        <div
          style={{
            fontSize: "calc(10px * var(--bs-font-scale, 1))",
            color: "#94a3b8",
            marginBottom: 10,
          }}
        >
          Tides, weather, sea-surface temperature, and temperature profiles
          saved for offline use. Coverage radius: 15 mi · 14-day tide window.
        </div>

        {/* IDB hydration error — shown when offline pack data could not be loaded */}
        {idbHydrationError && (
          <div
            role="alert"
            data-testid="env-idb-hydration-error"
            style={{
              background: "rgba(251,191,36,0.08)",
              border: "1px solid rgba(251,191,36,0.3)",
              borderRadius: 4,
              padding: "6px 10px",
              marginBottom: 8,
              fontSize: "calc(9px * var(--bs-font-scale, 1))",
              color: "#fbbf24",
            }}
          >
            ⚠ Offline data could not be loaded from storage — your previously saved pack may be unavailable. Try refreshing the page.
          </div>
        )}

        {envPack === null ? (
          <div
            data-testid="env-pack-empty"
            style={{
              fontSize: "calc(10px * var(--bs-font-scale, 1))",
              color: "#64748b",
              marginBottom: 10,
            }}
          >
            No data downloaded. Tap the button below to save for offline use.
          </div>
        ) : (
          <div
            data-testid="env-pack-info"
            style={{ marginBottom: 10 }}
          >
            {/* Downloaded date */}
            <div
              style={{
                fontSize: "calc(10px * var(--bs-font-scale, 1))",
                color: "#4ade80",
                marginBottom: 3,
              }}
            >
              ✓ Downloaded {fmtDate(envPack.generatedAt)}
              <CachedDataChip />
            </div>

            {/* Expiry */}
            <div
              style={{
                fontSize: "calc(9px * var(--bs-font-scale, 1))",
                color: expired ? "#f87171" : "#94a3b8",
                marginBottom: 2,
              }}
            >
              {expired ? (
                <span data-testid="env-pack-expired-msg">
                  ⚠ Data expired — reconnect to refresh
                </span>
              ) : (
                `Expires ${fmtDate(envPack.expiresAt)}`
              )}
            </div>

            {/* Coverage */}
            <div
              style={{
                fontSize: "calc(9px * var(--bs-font-scale, 1))",
                color: "#64748b",
              }}
            >
              {`${envPack.coverageRadiusMiles} mi radius · ${envPack.centerLat.toFixed(2)}°, ${envPack.centerLon.toFixed(2)}°`}
            </div>

            {/* Warnings */}
            {envPack.warnings.length > 0 && (
              <div
                data-testid="env-pack-warnings"
                style={{
                  marginTop: 6,
                  fontSize: "calc(9px * var(--bs-font-scale, 1))",
                  color: "#fbbf24",
                }}
              >
                {envPack.warnings.map((w, i) => (
                  <div key={i}>⚠ {w}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Download error */}
        {downloadError && (
          <div
            data-testid={
              downloadError.startsWith("No data available")
                ? "env-pack-no-data"
                : "env-pack-error"
            }
            style={{
              fontSize: "calc(9px * var(--bs-font-scale, 1))",
              color: downloadError.startsWith("No data available")
                ? "#94a3b8"
                : "#f87171",
              marginBottom: 8,
            }}
          >
            {downloadError.startsWith("No data available")
              ? `ℹ ${downloadError}`
              : `✗ ${downloadError}`}
          </div>
        )}

        {/* Delete error */}
        {deleteError && (
          <div
            data-testid="env-pack-delete-error"
            role="alert"
            style={{
              fontSize: "calc(9px * var(--bs-font-scale, 1))",
              color: "#f87171",
              marginBottom: 8,
            }}
          >
            ✗ {deleteError}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            data-testid="env-pack-download-btn"
            onClick={() => void handleDownload()}
            disabled={isDownloading}
            style={{
              ...S.dangerBtn,
              background: "rgba(0,229,255,0.12)",
              color: "#00e5ff",
              border: "1px solid rgba(0,229,255,0.25)",
              padding: "4px 12px",
              fontSize: "calc(9px * var(--bs-font-scale, 1))",
              opacity: isDownloading ? 0.6 : 1,
            }}
          >
            {isDownloading ? "◌ DOWNLOADING…" : "⬇ DOWNLOAD ALL FOR OFFLINE USE"}
          </button>

          {envPack !== null && (
            <button
              data-testid="env-pack-delete-btn"
              onClick={() => void handleDelete()}
              disabled={isDownloading}
              style={{
                ...S.dangerBtn,
                padding: "4px 10px",
                fontSize: "calc(9px * var(--bs-font-scale, 1))",
              }}
            >
              DELETE CACHED DATA
            </button>
          )}
        </div>

        {/* IndexedDB key note (for developer reference) */}
        <div
          style={{
            marginTop: 8,
            fontSize: "calc(8px * var(--bs-font-scale, 1))",
            color: "#334155",
          }}
        >
          {ENV_PACK_IDB_KEY}
        </div>
      </div>
    </div>
  );
}
