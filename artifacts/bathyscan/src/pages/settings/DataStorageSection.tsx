import React, { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "@/lib/settingsStore";
import { useCameraStore } from "@/lib/cameraStore";
import { clearUpscaleCache, getUpscaleCacheInfo } from "@/hooks/useUpscaledHeatmap";
import {
  listOfflinePacks,
  deleteOfflinePack,
  type OfflinePack,
} from "@/lib/offlinePackStore";
import {
  getHelpPackRecord,
  deleteHelpPack,
  type HelpPackRecord,
} from "@/lib/helpPackStore";
import { useToast } from "@/hooks/use-toast";
import { S } from "./styles";
import { SectionTitle } from "./components/SectionTitle";
import { SectionActionsRow } from "./components/SyncContext";
import { ToggleRow } from "./components/RowWidgets";
import {
  listCachedDatasets,
  clearCacheEntry,
  countPendingItems,
  formatCacheSize,
  clearTerrainCaches,
  clearPendingSyncQueue,
  type CachedDataset,
} from "./constants";
import { EnvOfflineSection } from "./EnvOfflineSection";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

const errorTextStyle: React.CSSProperties = {
  fontSize: "calc(10px * var(--bs-font-scale, 1))",
  color: "#f87171",
};

const retryBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  marginLeft: 6,
  color: "#00e5ff",
  fontSize: "calc(10px * var(--bs-font-scale, 1))",
  textDecoration: "underline",
  cursor: "pointer",
};

export function DataStorageSection() {
  const s = useSettingsStore(useShallow((s) => s));
  const cameraPosition = useCameraStore((s) => s.cameraPosition);
  const [cached, setCached] = useState<CachedDataset[]>([]);
  const [pending, setPending] = useState({ markers: 0, trails: 0 });
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState<string | null>(null);
  const [allClearedMsg, setAllClearedMsg] = useState(false);
  const [upscaleClearMsg, setUpscaleClearMsg] = useState(false);
  const [upscaleInfo, setUpscaleInfo] = useState<{ count: number; bytes: number } | null>(null);
  const [offlinePacks, setOfflinePacks] = useState<OfflinePack[]>([]);
  const [helpRecord, setHelpRecord] = useState<HelpPackRecord | null | undefined>(undefined);
  const [packsDeleting, setPacksDeleting] = useState<ReadonlySet<string>>(new Set());
  const [helpClearing, setHelpClearing] = useState(false);
  // Loader error slots — rendered as "Failed to load — Retry" instead of an
  // indefinite "Loading…" when the underlying IDB/Cache Storage read rejects.
  const [cacheLoadError, setCacheLoadError] = useState(false);
  const [upscaleLoadError, setUpscaleLoadError] = useState(false);
  const [packsLoadError, setPacksLoadError] = useState(false);
  // Per-operation mutation errors — shown inline near the failed control.
  const [entryError, setEntryError] = useState<string | null>(null);
  const [clearAllError, setClearAllError] = useState<string | null>(null);
  const [clearAllNote, setClearAllNote] = useState<string | null>(null);
  const [upscaleClearError, setUpscaleClearError] = useState<string | null>(null);
  const [packDeleteError, setPackDeleteError] = useState<string | null>(null);
  const [helpDeleteError, setHelpDeleteError] = useState<string | null>(null);
  const { toast } = useToast();

  // Unmount guard — async handlers resume after teardown during rapid
  // navigation; every setter behind an await checks this first.
  const isMountedRef = useRef(true);

  // Shared mutex — prevents handleClearAll, handleClearEntry and
  // handleClearUpscaleCache from running concurrently. Using a ref (not
  // state) gives a synchronous guard that fires before React has had a
  // chance to re-render with the new `clearing` value.
  const clearingAnyRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Track transient-message timers, keyed per message, so (a) they can all be
  // cleared on unmount and (b) a rapid repeated clear reschedules its own
  // reset instead of letting the older timer hide the newer message early.
  const msgTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const scheduleMsgReset = useCallback((key: string, fn: () => void, ms: number) => {
    if (!isMountedRef.current) return;
    const prev = msgTimersRef.current.get(key);
    if (prev !== undefined) clearTimeout(prev);
    msgTimersRef.current.set(
      key,
      setTimeout(() => {
        msgTimersRef.current.delete(key);
        fn();
      }, ms),
    );
  }, []);
  useEffect(() => {
    const timers = msgTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const refreshUpscaleInfo = useCallback(async () => {
    setUpscaleLoadError(false);
    try {
      const info = await getUpscaleCacheInfo();
      if (!isMountedRef.current) return;
      setUpscaleInfo(info);
    } catch {
      if (isMountedRef.current) setUpscaleLoadError(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setCacheLoadError(false);
    try {
      const [c, p] = await Promise.all([listCachedDatasets(), countPendingItems()]);
      if (!isMountedRef.current) return;
      setCached(c);
      setPending(p);
    } catch {
      if (isMountedRef.current) setCacheLoadError(true);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  // De-duplicated pack refresh: concurrent callers (e.g. two pack deletes
  // finishing close together) queue at most one extra pass instead of racing,
  // so a stale result can never overwrite a newer one.
  const refreshingPacksRef = useRef(false);
  const packsRefreshQueuedRef = useRef(false);
  const refreshPacks = useCallback(async () => {
    if (refreshingPacksRef.current) {
      packsRefreshQueuedRef.current = true;
      return;
    }
    refreshingPacksRef.current = true;
    try {
      do {
        packsRefreshQueuedRef.current = false;
        const [packs, help] = await Promise.all([listOfflinePacks(), getHelpPackRecord()]);
        if (!isMountedRef.current) return;
        setOfflinePacks(packs);
        setHelpRecord(help);
        setPacksLoadError(false);
      } while (packsRefreshQueuedRef.current);
    } catch {
      if (isMountedRef.current) setPacksLoadError(true);
    } finally {
      refreshingPacksRef.current = false;
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void refreshUpscaleInfo(); }, [refreshUpscaleInfo]);
  useEffect(() => { void refreshPacks(); }, [refreshPacks]);

  const handleDeletePack = async (id: string) => {
    // Per-pack-id lock: other packs stay deletable while this one runs.
    setPacksDeleting((prev) => new Set(prev).add(id));
    setPackDeleteError(null);
    try {
      await deleteOfflinePack(id);
      await refreshPacks();
      if (isMountedRef.current) toast({ title: "Offline pack deleted", duration: 3000 });
    } catch {
      if (isMountedRef.current) setPackDeleteError("Failed to delete offline pack. Try again.");
    } finally {
      if (isMountedRef.current) {
        setPacksDeleting((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
  };

  const handleDeleteHelp = async () => {
    setHelpClearing(true);
    setHelpDeleteError(null);
    try {
      await deleteHelpPack();
      await refreshPacks();
      if (isMountedRef.current) toast({ title: "Help pack deleted", duration: 3000 });
    } catch {
      if (isMountedRef.current) setHelpDeleteError("Failed to delete help pack. Try again.");
    } finally {
      if (isMountedRef.current) setHelpClearing(false);
    }
  };

  const handleClearEntry = async (url: string) => {
    if (clearingAnyRef.current) return;
    clearingAnyRef.current = true;
    setClearing(url);
    setEntryError(null);
    try {
      await clearCacheEntry(url);
      await refresh();
    } catch {
      if (isMountedRef.current) setEntryError("Failed to clear this cache entry. Try again.");
    } finally {
      clearingAnyRef.current = false;
      if (isMountedRef.current) setClearing(null);
    }
  };

  const handleClearAll = async () => {
    if (clearingAnyRef.current) return;
    clearingAnyRef.current = true;
    setClearing("all");
    setClearAllError(null);
    setClearAllNote(null);
    try {
      // Targeted clear: only terrain/overview caches, tile caches, and the
      // pending sync queue. Offline packs, help content, weather packs and
      // enhanced images are never touched here.
      const cacheStorageCleared = await clearTerrainCaches();
      // IDB + localStorage queues are independent of Cache Storage — clear
      // them even when the tile caches can't be cleared.
      await clearPendingSyncQueue();
      if (isMountedRef.current) {
        setAllClearedMsg(true);
        if (!cacheStorageCleared) {
          setClearAllNote(
            "The tile cache could not be cleared (Cache Storage is unavailable in this browser). Pending sync data was cleared.",
          );
        }
        scheduleMsgReset("all-cleared", () => setAllClearedMsg(false), 3000);
      }
      // The broad clear used to touch the enhanced-image store; keep its
      // summary in sync too, not just the terrain-cache list.
      await Promise.all([refresh(), refreshUpscaleInfo()]);
    } catch {
      if (isMountedRef.current) setClearAllError("Failed to clear cached data. Try again.");
    } finally {
      clearingAnyRef.current = false;
      if (isMountedRef.current) setClearing(null);
    }
  };

  const handleClearUpscaleCache = async () => {
    if (clearingAnyRef.current) return;
    clearingAnyRef.current = true;
    setClearing("upscale");
    setUpscaleClearError(null);
    try {
      await clearUpscaleCache();
      await refreshUpscaleInfo();
      if (isMountedRef.current) {
        setUpscaleClearMsg(true);
        scheduleMsgReset("upscale-cleared", () => setUpscaleClearMsg(false), 3000);
        toast({ title: "Enhanced image cache cleared", duration: 3000 });
      }
    } catch {
      if (isMountedRef.current) setUpscaleClearError("Failed to clear the enhanced image cache. Try again.");
    } finally {
      clearingAnyRef.current = false;
      if (isMountedRef.current) setClearing(null);
    }
  };

  return (
    <>
      <SectionTitle helpId="datasets-uploads" helpLabel="Data & Storage">◈ DATA &amp; STORAGE</SectionTitle>
      <SectionActionsRow section="data" />
      {/* Defaults card */}
      <div style={S.card}>
        <div style={S.cardHeader}>DEFAULTS</div>
        <ToggleRow
          label="Auto-Load Last Dataset"
          value={s.autoLoadLastDataset}
          onChange={s.setAutoLoadLastDataset}
          sublabel="Reopen the dataset you used last session"
        />
      </div>
      {/* Cache card */}
      <div style={S.card}>
        <div style={S.cardHeader}>CACHED TERRAIN DATA</div>
        <div style={{ padding: "12px 16px" }}>
          {cacheLoadError ? (
            <div data-testid="cache-load-error" style={errorTextStyle}>
              <ErrorMessage message="Failed to load cached data." />
              <button data-testid="retry-cache-load" onClick={() => void refresh()} style={retryBtnStyle}>
                Retry
              </button>
            </div>
          ) : loading ? (
            <div style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#64748b" }}>◌ Loading…</div>
          ) : cached.length === 0 ? (
            <div data-testid="no-cache-msg" style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#64748b" }}>
              No terrain data cached. Load a dataset to cache it.
            </div>
          ) : (
            cached.map((entry) => (
              <div key={entry.url} data-testid="cache-entry" style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "6px 0", borderBottom: "1px solid rgba(0,229,255,0.06)", fontSize: "calc(10px * var(--bs-font-scale, 1))",
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.label}
                  </div>
                  {entry.sizeKb !== null && (
                    <div style={{ fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#64748b" }}>{entry.sizeKb} KB</div>
                  )}
                </div>
                <button
                  onClick={() => void handleClearEntry(entry.url)}
                  disabled={clearing !== null}
                  style={{
                    ...S.dangerBtn,
                    padding: "2px 8px",
                    fontSize: "calc(8px * var(--bs-font-scale, 1))",
                    flexShrink: 0,
                    marginLeft: 8,
                  }}
                >
                  {clearing === entry.url ? "…" : "CLEAR"}
                </button>
              </div>
            ))
          )}
          {entryError && (
            <ErrorMessage data-testid="clear-entry-error" message={entryError} style={{ ...errorTextStyle, marginTop: 8 }} />
          )}
          {cached.length > 0 && !cacheLoadError && (
            <>
              <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                <button
                  data-testid="clear-all-cache-btn"
                  onClick={() => void handleClearAll()}
                  disabled={clearing !== null}
                  style={{ ...S.dangerBtn, padding: "4px 12px", fontSize: "calc(9px * var(--bs-font-scale, 1))" }}
                >
                  {clearing === "all" ? "CLEARING…" : "CLEAR ALL CACHE"}
                </button>
              </div>
              <div
                data-testid="clear-all-scope-note"
                style={{ marginTop: 6, fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#64748b", textAlign: "right" }}
              >
                Clears cached terrain &amp; overview data, map tile caches, and the pending
                sync queue. Offline packs, help content, weather packs and enhanced images
                are kept.
              </div>
            </>
          )}
          {clearAllError && (
            <ErrorMessage data-testid="clear-all-error" message={clearAllError} style={{ ...errorTextStyle, marginTop: 8 }} />
          )}
          {clearAllNote && (
            <div data-testid="clear-all-note" style={{ marginTop: 8, fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#fbbf24" }}>
              {clearAllNote}
            </div>
          )}
          {allClearedMsg && (
            <div style={{ marginTop: 8, fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#4ade80" }}>✓ Cached data cleared</div>
          )}
        </div>
      </div>

      {/* Pending sync card */}
      {(pending.markers > 0 || pending.trails > 0) && (
        <div style={S.card}>
          <div style={S.cardHeader}>PENDING SYNC</div>
          <div style={{ padding: "12px 16px", fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#cbd5e1" }}>
            {pending.markers > 0 && (
              <div>{pending.markers} marker{pending.markers !== 1 ? "s" : ""} waiting to sync</div>
            )}
            {pending.trails > 0 && (
              <div>{pending.trails} trail{pending.trails !== 1 ? "s" : ""} waiting to sync</div>
            )}
            <div style={{ fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#64748b", marginTop: 6 }}>
              These will upload automatically when you reconnect.
            </div>
          </div>
        </div>
      )}

      {/* Enhanced image cache */}
      <div style={S.card}>
        <div style={S.cardHeader}>ENHANCED IMAGE CACHE</div>
        <div style={{ padding: "12px 16px" }}>
          {upscaleLoadError ? (
            <div data-testid="upscale-load-error" style={{ ...errorTextStyle, marginBottom: 10 }}>
              <ErrorMessage message="Failed to load cache info." />
              <button data-testid="retry-upscale-load" onClick={() => void refreshUpscaleInfo()} style={retryBtnStyle}>
                Retry
              </button>
            </div>
          ) : upscaleInfo !== null ? (
            <div style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#94a3b8", marginBottom: 10 }}>
              {upscaleInfo.count} image{upscaleInfo.count !== 1 ? "s" : ""} cached ·{" "}
              {formatCacheSize(upscaleInfo.bytes)}
            </div>
          ) : (
            <div style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#64748b", marginBottom: 10 }}>◌ Loading…</div>
          )}
          {upscaleClearMsg && (
            <div style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#4ade80", marginBottom: 8 }}>
              ✓ Enhanced image cache cleared
            </div>
          )}
          {upscaleClearError && (
            <ErrorMessage data-testid="upscale-clear-error" message={upscaleClearError} style={{ ...errorTextStyle, marginBottom: 8 }} />
          )}
          <button
            data-testid="clear-upscale-cache-btn"
            onClick={() => void handleClearUpscaleCache()}
            disabled={clearing !== null || (upscaleInfo?.count ?? 0) === 0}
            style={{
              ...S.dangerBtn,
              padding: "4px 12px",
              fontSize: "calc(9px * var(--bs-font-scale, 1))",
              opacity: (upscaleInfo?.count ?? 0) === 0 ? 0.4 : 1,
            }}
          >
            {clearing === "upscale" ? "CLEARING…" : "CLEAR ENHANCED IMAGE CACHE"}
          </button>
        </div>
      </div>
      {/* Offline packs */}
      <div style={S.card}>
        <div style={S.cardHeader}>SAVED OFFLINE PACKS</div>
        <div style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#94a3b8", marginBottom: 10 }}>
            Terrain, tide predictions, and weather snapshots saved for offline use.
            Each pack covers 7 days of tide data and can be updated from the dataset panel.
          </div>
          {packsLoadError ? (
            <div data-testid="packs-load-error" style={errorTextStyle}>
              <ErrorMessage message="Failed to load offline packs." />
              <button data-testid="retry-packs-load" onClick={() => void refreshPacks()} style={retryBtnStyle}>
                Retry
              </button>
            </div>
          ) : offlinePacks.length === 0 ? (
            <div style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#64748b" }}>
              No offline packs saved. Load a dataset and tap "⬇ Save Offline" to create one.
            </div>
          ) : (
            offlinePacks.map((pack) => {
              const savedDate = new Date(pack.savedAt).toLocaleDateString(undefined, {
                month: "short", day: "numeric", year: "numeric",
              });
              const expiresDate = new Date(pack.tidePack.tidalExpiresAt).toLocaleDateString(undefined, {
                month: "short", day: "numeric",
              });
              const isExpired = new Date(pack.tidePack.tidalExpiresAt).getTime() < Date.now();
              const sizeStr = pack.storageBytesEstimate >= 1024 * 1024
                ? `${(pack.storageBytesEstimate / (1024 * 1024)).toFixed(1)} MB`
                : `${Math.round(pack.storageBytesEstimate / 1024)} KB`;
              return (
                <div
                  key={pack.id}
                  data-testid={`offline-pack-${pack.id}`}
                  style={{
                    display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                    padding: "8px 0", borderBottom: "1px solid rgba(0,229,255,0.06)", gap: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#cbd5e1", fontWeight: 600, marginBottom: 2 }}>
                      {pack.datasetName}
                    </div>
                    <div style={{ fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#64748b" }}>
                      Saved {savedDate} · {sizeStr}
                    </div>
                    <div style={{ fontSize: "calc(9px * var(--bs-font-scale, 1))", color: isExpired ? "#f87171" : "#94a3b8", marginTop: 1 }}>
                      Tide data {isExpired ? "expired" : `expires ${expiresDate}`}
                    </div>
                  </div>
                  <button
                    data-testid={`delete-pack-${pack.id}`}
                    onClick={() => void handleDeletePack(pack.id)}
                    disabled={packsDeleting.has(pack.id)}
                    style={{
                      ...S.dangerBtn,
                      padding: "3px 8px",
                      fontSize: "calc(8px * var(--bs-font-scale, 1))",
                      flexShrink: 0,
                    }}
                  >
                    {packsDeleting.has(pack.id) ? "…" : "DELETE"}
                  </button>
                </div>
              );
            })
          )}
          {packDeleteError && (
            <ErrorMessage data-testid="pack-delete-error" message={packDeleteError} style={{ ...errorTextStyle, marginTop: 8 }} />
          )}
        </div>
      </div>
      {/* Weather & ocean data (env pack) — pass current map centre so
          the download covers the user's actual location */}
      <EnvOfflineSection
        centerLat={cameraPosition.known ? cameraPosition.lat : undefined}
        centerLon={cameraPosition.known ? cameraPosition.lon : undefined}
      />
      {/* Help media pack — shown when a pack is saved OR when a load error needs surfacing */}
      {(packsLoadError || helpRecord != null) && (
        <div style={S.card}>
          <div style={S.cardHeader}>HELP MEDIA</div>
          <div style={{ padding: "12px 16px" }}>
            {packsLoadError ? (
              <div data-testid="help-load-error" style={errorTextStyle}>
                <ErrorMessage message="Failed to load help pack status." />
                <button data-testid="retry-help-load" onClick={() => void refreshPacks()} style={retryBtnStyle}>
                  Retry
                </button>
              </div>
            ) : helpRecord != null ? (
              <div data-testid="help-media-row">
                <div style={{ fontSize: "calc(10px * var(--bs-font-scale, 1))", color: "#94a3b8", marginBottom: 8 }}>
                  {helpRecord.assets.length} asset{helpRecord.assets.length !== 1 ? "s" : ""} cached ·{" "}
                  {helpRecord.totalBytes >= 1024 * 1024
                    ? `${(helpRecord.totalBytes / (1024 * 1024)).toFixed(1)} MB`
                    : `${Math.round(helpRecord.totalBytes / 1024)} KB`}
                  {" · saved "}
                  {new Date(helpRecord.savedAt).toLocaleDateString(undefined, {
                    month: "short", day: "numeric", year: "numeric",
                  })}
                </div>
                <button
                  data-testid="delete-help-pack-btn"
                  onClick={() => void handleDeleteHelp()}
                  disabled={helpClearing}
                  style={{ ...S.dangerBtn, fontSize: "calc(8px * var(--bs-font-scale, 1))", padding: "3px 8px" }}
                >
                  {helpClearing ? "…" : "REMOVE"}
                </button>
                {helpDeleteError && (
                  <ErrorMessage data-testid="help-delete-error" message={helpDeleteError} style={{ ...errorTextStyle, marginTop: 8 }} />
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
