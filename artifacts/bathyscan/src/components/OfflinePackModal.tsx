/**
 * OfflinePackModal — lets users save a dataset for offline field use.
 *
 * Two independent sections:
 *   1. Survey Area — fetches terrain + tide predictions + weather snapshot
 *   2. Help Content — caches the five help media assets
 */

import React, { useEffect, useState, useRef } from "react";
import {
  saveOfflinePack,
  listOfflinePacks,
  type OfflinePack,
  type PackProgress,
} from "@/lib/offlinePackStore";
import {
  saveHelpPack,
  getHelpPackStatus,
  type HelpPackStatus,
  type HelpPackProgress,
  HELP_ASSETS,
} from "@/lib/helpPackStore";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

interface Dataset {
  id: string;
  name: string;
  bbox?: { minLon: number; maxLon: number; minLat: number; maxLat: number } | null;
}

interface Props {
  dataset: Dataset;
  onClose: () => void;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function expiresLabel(iso: string): { text: string; amber: boolean } {
  const ms = new Date(iso).getTime() - Date.now();
  const hours = ms / (1000 * 60 * 60);
  if (hours <= 0) return { text: "Expired", amber: true };
  if (hours <= 48) return { text: `~${Math.round(hours)}h remaining`, amber: true };
  return { text: formatExpiry(iso), amber: false };
}

type AreaPhase = "idle" | "downloading" | "done" | "error";
type HelpPhase = "idle" | "downloading" | "done" | "error";

const STEP_LABELS: Record<PackProgress["step"], string> = {
  terrain: "Fetching terrain",
  tide: "Fetching tide predictions",
  weather: "Fetching weather snapshot",
  saving: "Writing to storage",
};

export const OfflinePackModal: React.FC<Props> = ({ dataset, onClose }) => {
  const [days, setDays] = useState(7);
  const [areaPhase, setAreaPhase] = useState<AreaPhase>("idle");
  const [areaProgress, setAreaProgress] = useState<PackProgress[]>([]);
  const [areaError, setAreaError] = useState<string | null>(null);
  const [savedPack, setSavedPack] = useState<OfflinePack | null>(null);
  const [existingPack, setExistingPack] = useState<OfflinePack | null>(null);

  const [helpPhase, setHelpPhase] = useState<HelpPhase>("idle");
  const [helpProgress, setHelpProgress] = useState<HelpPackProgress[]>([]);
  const [helpStatus, setHelpStatus] = useState<HelpPackStatus>({ saved: false });
  const [helpError, setHelpError] = useState<string | null>(null);

  const [storageQuota, setStorageQuota] = useState<{ used: number; total: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [idbError, setIdbError] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);

  // Load existing pack state and help status on mount
  useEffect(() => {
    void (async () => {
      const [packs, packsErr] = await listOfflinePacks()
        .then((r): [OfflinePack[], null] => [r, null])
        .catch((e): [OfflinePack[], string] => {
          setIdbError(true);
          return [[], e instanceof Error ? e.message : "Could not load saved packs"];
        });
      if (packsErr) setLoadError(packsErr);
      const match = packs.find((p) => p.datasetId === dataset.id) ?? null;
      setExistingPack(match);

      const hs = await getHelpPackStatus().catch((e) => {
        setIdbError(true);
        setLoadError((prev) =>
          prev ?? (e instanceof Error ? e.message : "Could not load help pack status"),
        );
        return { saved: false } as HelpPackStatus;
      });
      setHelpStatus(hs);

      if (typeof navigator !== "undefined" && "storage" in navigator) {
        try {
          const est = await navigator.storage.estimate();
          if (est.usage != null && est.quota != null) {
            setStorageQuota({ used: est.usage, total: est.quota });
          }
        } catch {
          // Not supported
        }
      }
    })();
  }, [dataset.id]);

  // Focus trap + Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    overlayRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSaveArea = async (isUpdate = false) => {
    setAreaPhase("downloading");
    setAreaProgress([]);
    setAreaError(null);
    if (isUpdate) setExistingPack(null);
    try {
      const pack = await saveOfflinePack(dataset, days, (p) => {
        setAreaProgress((prev) => {
          const idx = prev.findIndex((x) => x.step === p.step);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = p;
            return next;
          }
          return [...prev, p];
        });
      });
      setSavedPack(pack);
      setAreaPhase("done");
    } catch (err) {
      setAreaError(err instanceof Error ? err.message : "Download failed");
      setAreaPhase("error");
    }
  };

  const handleSaveHelp = async () => {
    setHelpPhase("downloading");
    setHelpProgress([]);
    setHelpError(null);
    try {
      const record = await saveHelpPack((p) => {
        setHelpProgress((prev) => {
          const idx = prev.findIndex((x) => x.index === p.index);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = p;
            return next;
          }
          return [...prev, p];
        });
      });
      setHelpStatus({ saved: true, savedAt: record.savedAt, totalBytes: record.totalBytes });
      setHelpPhase("done");
    } catch (err) {
      setHelpError(err instanceof Error ? err.message : "Help download failed");
      setHelpPhase("error");
    }
  };

  const expiryDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const expiryStr = expiryDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  const displayPack = savedPack ?? existingPack;
  const alreadySaved = !!existingPack && areaPhase === "idle";
  const expLabel = displayPack ? expiresLabel(displayPack.tidePack.tidalExpiresAt) : null;
  const areaDownloading = areaPhase === "downloading";
  const helpDownloading = helpPhase === "downloading";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        fontFamily: FONT,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={overlayRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Save offline"
        style={{
          background: "#0a1628",
          border: "1px solid rgba(0,229,255,0.2)",
          borderRadius: 8,
          width: 460,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100dvh - 48px)",
          overflow: "auto",
          outline: "none",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "14px 16px 10px",
          borderBottom: "1px solid rgba(0,229,255,0.1)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}>
          <div>
            <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", letterSpacing: "0.2em", color: "#00e5ff", textTransform: "uppercase", marginBottom: 2 }}>
              ⬇ SAVE OFFLINE
            </div>
            <div style={{ fontSize: "calc(18px * var(--bs-font-scale, 1))", color: "#e2e8f0", fontWeight: 600 }}>{dataset.name}</div>
            {dataset.bbox && (
              <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#64748b", marginTop: 2 }}>
                {dataset.bbox.minLat.toFixed(2)}°, {dataset.bbox.minLon.toFixed(2)}° →{" "}
                {dataset.bbox.maxLat.toFixed(2)}°, {dataset.bbox.maxLon.toFixed(2)}°
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: "#64748b",
              fontSize: "calc(27px * var(--bs-font-scale, 1))",
              cursor: "pointer",
              lineHeight: 1,
              padding: "0 2px",
            }}
          >
            ×
          </button>
        </div>

        {/* IDB load error banner */}
        {loadError && (
          <div style={{
            padding: "8px 16px",
            background: "rgba(239,68,68,0.08)",
            borderBottom: "1px solid rgba(239,68,68,0.2)",
            fontSize: "calc(15px * var(--bs-font-scale, 1))",
            color: "#fca5a5",
          }}>
            ⚠ Could not load offline pack data — {loadError}
          </div>
        )}

        <div style={{ padding: "12px 16px" }}>
          {/* ── IDB unavailable banner ── */}
          {idbError && (
            <div
              role="alert"
              style={{
                background: "rgba(239,68,68,0.12)",
                border: "1px solid rgba(239,68,68,0.4)",
                borderRadius: 6,
                padding: "8px 12px",
                marginBottom: 12,
                fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
                color: "#fca5a5",
              }}
            >
              Could not load packs — storage may be unavailable in this browser.
            </div>
          )}
          {/* ── Survey Area section ── */}
          <div style={{
            border: "1px solid rgba(0,229,255,0.12)",
            borderRadius: 6,
            marginBottom: 12,
            overflow: "hidden",
          }}>
            <div style={{
              background: "rgba(0,229,255,0.04)",
              padding: "8px 12px",
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
              letterSpacing: "0.15em",
              color: "#00e5ff",
              textTransform: "uppercase",
              borderBottom: "1px solid rgba(0,229,255,0.1)",
            }}>
              SURVEY AREA
            </div>
            <div style={{ padding: "10px 12px" }}>
              {/* Already-saved state */}
              {alreadySaved && existingPack && (
                <div style={{
                  background: "rgba(74,222,128,0.06)",
                  border: "1px solid rgba(74,222,128,0.25)",
                  borderRadius: 4,
                  padding: "7px 10px",
                  marginBottom: 10,
                  fontSize: "calc(15px * var(--bs-font-scale, 1))",
                  color: "#4ade80",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}>
                  <div>
                    <div>✓ Saved {formatDate(existingPack.savedAt)}</div>
                    {expLabel && (
                      <div style={{ color: expLabel.amber ? "#fbbf24" : "#4ade80", marginTop: 2, fontSize: "calc(13.5px * var(--bs-font-scale, 1))" }}>
                        Tide data valid until: {expLabel.text}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => void handleSaveArea(true)}
                    disabled={areaDownloading}
                    style={{
                      background: "none",
                      border: "1px solid rgba(74,222,128,0.4)",
                      borderRadius: 3,
                      color: "#4ade80",
                      fontSize: "calc(12px * var(--bs-font-scale, 1))",
                      padding: "2px 8px",
                      cursor: areaDownloading ? "not-allowed" : "pointer",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      opacity: areaDownloading ? 0.5 : 1,
                    }}
                  >
                    Update
                  </button>
                </div>
              )}

              {/* Success state */}
              {areaPhase === "done" && savedPack && (
                <div style={{
                  background: "rgba(74,222,128,0.06)",
                  border: "1px solid rgba(74,222,128,0.25)",
                  borderRadius: 4,
                  padding: "7px 10px",
                  marginBottom: 10,
                  fontSize: "calc(15px * var(--bs-font-scale, 1))",
                  color: "#4ade80",
                }}>
                  ✓ Saved — tide data valid until {formatExpiry(savedPack.tidePack.tidalExpiresAt)}
                </div>
              )}

              {/* Tide window slider */}
              {(areaPhase === "idle" || areaPhase === "error") && (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                        TIDE PREDICTIONS WINDOW
                      </span>
                      <span style={{ fontSize: "calc(15px * var(--bs-font-scale, 1))", color: "#00e5ff" }}>{days} days</span>
                    </div>
                    <input
                      type="range"
                      min={3}
                      max={14}
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                      style={{ width: "100%", accentColor: "#00e5ff" }}
                      aria-label="Days of tide predictions"
                    />
                    <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#64748b", marginTop: 2 }}>
                      Valid through {expiryStr}
                    </div>
                  </div>

                  {/* Storage estimate */}
                  {storageQuota && (
                    <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#64748b", marginBottom: 8 }}>
                      ~2–5 MB per pack · {formatBytes(storageQuota.used)} used of {formatBytes(storageQuota.total)} available
                    </div>
                  )}

                  {areaError && (
                    <div style={{
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid rgba(239,68,68,0.3)",
                      borderRadius: 3,
                      padding: "6px 8px",
                      fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                      color: "#fca5a5",
                      marginBottom: 8,
                    }}>
                      {areaError}
                    </div>
                  )}

                  <button
                    onClick={() => void handleSaveArea(false)}
                    disabled={areaDownloading}
                    style={{
                      width: "100%",
                      padding: "7px 12px",
                      background: "rgba(0,229,255,0.1)",
                      border: "1px solid rgba(0,229,255,0.35)",
                      borderRadius: 4,
                      color: "#00e5ff",
                      fontSize: "calc(15px * var(--bs-font-scale, 1))",
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      cursor: areaDownloading ? "not-allowed" : "pointer",
                    }}
                  >
                    {areaPhase === "error" ? "Retry Save Area" : alreadySaved ? "Re-download" : "Save Area"}
                  </button>
                </>
              )}

              {/* Progress steps */}
              {areaPhase === "downloading" && (
                <div style={{ marginTop: 4 }}>
                  {(["terrain", "tide", "weather", "saving"] as const).map((step) => {
                    const prog = areaProgress.find((p) => p.step === step);
                    const isPending = !prog;
                    const isDone = prog?.done === true && !prog.error;
                    const isActive = prog?.done === false;
                    const isErr = prog?.error;
                    return (
                      <div key={step} style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 0",
                        fontSize: "calc(15px * var(--bs-font-scale, 1))",
                      }}>
                        <span style={{ width: 14, textAlign: "center", color: isErr ? "#ef4444" : isDone ? "#4ade80" : isActive ? "#00e5ff" : "#475569" }}>
                          {isErr ? "✗" : isDone ? "✓" : isActive ? "◌" : "○"}
                        </span>
                        <span style={{ color: isPending ? "#475569" : isErr ? "#fca5a5" : isDone ? "#4ade80" : "#e2e8f0" }}>
                          {STEP_LABELS[step]}
                          {isErr && <span style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", marginLeft: 6, color: "#fca5a5" }}>— {prog.error}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Help Content section ── */}
          <div style={{
            border: "1px solid rgba(0,229,255,0.12)",
            borderRadius: 6,
            overflow: "hidden",
          }}>
            <div style={{
              background: "rgba(0,229,255,0.04)",
              padding: "8px 12px",
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
              letterSpacing: "0.15em",
              color: "#00e5ff",
              textTransform: "uppercase",
              borderBottom: "1px solid rgba(0,229,255,0.1)",
            }}>
              HELP CONTENT
            </div>
            <div style={{ padding: "10px 12px" }}>
              <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", marginBottom: 8, lineHeight: 1.5 }}>
                Caches {HELP_ASSETS.length} media assets (~3–8 MB) so walkthroughs and screenshots are visible offline.
              </div>

              {helpStatus.saved && helpPhase === "idle" && (
                <div style={{
                  background: "rgba(74,222,128,0.06)",
                  border: "1px solid rgba(74,222,128,0.25)",
                  borderRadius: 4,
                  padding: "7px 10px",
                  marginBottom: 8,
                  fontSize: "calc(15px * var(--bs-font-scale, 1))",
                  color: "#4ade80",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}>
                  <div>
                    <div>✓ Downloaded {helpStatus.savedAt ? formatDate(helpStatus.savedAt) : ""}</div>
                    {helpStatus.totalBytes && (
                      <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#64748b", marginTop: 2 }}>
                        {formatBytes(helpStatus.totalBytes)}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => void handleSaveHelp()}
                    disabled={helpDownloading}
                    style={{
                      background: "none",
                      border: "1px solid rgba(74,222,128,0.4)",
                      borderRadius: 3,
                      color: "#4ade80",
                      fontSize: "calc(12px * var(--bs-font-scale, 1))",
                      padding: "2px 8px",
                      cursor: helpDownloading ? "not-allowed" : "pointer",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      opacity: helpDownloading ? 0.5 : 1,
                    }}
                  >
                    Re-download
                  </button>
                </div>
              )}

              {helpPhase === "done" && (
                <div style={{
                  background: "rgba(74,222,128,0.06)",
                  border: "1px solid rgba(74,222,128,0.25)",
                  borderRadius: 4,
                  padding: "7px 10px",
                  marginBottom: 8,
                  fontSize: "calc(15px * var(--bs-font-scale, 1))",
                  color: "#4ade80",
                }}>
                  ✓ Help content cached
                </div>
              )}

              {helpPhase === "downloading" && (
                <div style={{ marginBottom: 8 }}>
                  {helpProgress.map((p) => (
                    <div key={p.index} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "3px 0",
                      fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                    }}>
                      <span style={{ width: 14, textAlign: "center", color: p.error ? "#ef4444" : p.done ? "#4ade80" : "#00e5ff" }}>
                        {p.error ? "✗" : p.done ? "✓" : "◌"}
                      </span>
                      <span style={{ color: p.error ? "#fca5a5" : p.done ? "#4ade80" : "#e2e8f0" }}>
                        {p.assetName} ({p.index}/{p.total})
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {helpError && (
                <div style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 3,
                  padding: "6px 8px",
                  fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                  color: "#fca5a5",
                  marginBottom: 8,
                }}>
                  {helpError}
                </div>
              )}

              {(helpPhase === "idle" || helpPhase === "error") && !helpStatus.saved && (
                <button
                  onClick={() => void handleSaveHelp()}
                  disabled={helpDownloading}
                  style={{
                    width: "100%",
                    padding: "7px 12px",
                    background: "rgba(0,229,255,0.06)",
                    border: "1px solid rgba(0,229,255,0.25)",
                    borderRadius: 4,
                    color: "#67e8f9",
                    fontSize: "calc(15px * var(--bs-font-scale, 1))",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  {helpPhase === "error" ? "Retry Download" : "Download Help"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        {(areaPhase === "done" || areaPhase === "error") && (
          <div style={{
            padding: "10px 16px 14px",
            borderTop: "1px solid rgba(0,229,255,0.08)",
            display: "flex",
            justifyContent: "flex-end",
          }}>
            <button
              onClick={onClose}
              style={{
                padding: "7px 20px",
                background: "rgba(0,229,255,0.1)",
                border: "1px solid rgba(0,229,255,0.3)",
                borderRadius: 4,
                color: "#00e5ff",
                fontSize: "calc(15px * var(--bs-font-scale, 1))",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
