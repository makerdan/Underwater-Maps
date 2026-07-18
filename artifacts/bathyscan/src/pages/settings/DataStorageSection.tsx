import React, { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { clear as idbClear } from "idb-keyval";
import { useSettingsStore } from "@/lib/settingsStore";
import { clearUpscaleCache, getUpscaleCacheInfo } from "@/hooks/useUpscaledHeatmap";
import {
  listOfflinePacks,
  deleteOfflinePack,
  type OfflinePack,
} from "@/lib/offlinePackStore";
import {
  getHelpPackStatus,
  deleteHelpPack,
  type HelpPackStatus,
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
  type CachedDataset,
} from "./constants";

export function DataStorageSection() {
  const s = useSettingsStore(useShallow((s) => s));
  const [cached, setCached] = useState<CachedDataset[]>([]);
  const [pending, setPending] = useState({ markers: 0, trails: 0 });
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState<string | null>(null);
  const [allClearedMsg, setAllClearedMsg] = useState(false);
  const [upscaleClearMsg, setUpscaleClearMsg] = useState(false);
  const [upscaleInfo, setUpscaleInfo] = useState<{ count: number; bytes: number } | null>(null);
  const [offlinePacks, setOfflinePacks] = useState<OfflinePack[]>([]);
  const [helpStatus, setHelpStatus] = useState<HelpPackStatus | null>(null);
  const [packClearing, setPackClearing] = useState<string | null>(null);
  const [helpClearing, setHelpClearing] = useState(false);
  const { toast } = useToast();

  // Track transient-message timers so they can be cleared on unmount —
  // otherwise a setState fires after teardown (React warning in the app,
  // an unhandled "window is not defined" error in unit tests).
  const msgTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const scheduleMsgReset = useCallback((fn: () => void, ms: number) => {
    msgTimersRef.current.push(setTimeout(fn, ms));
  }, []);
  useEffect(() => {
    const timers = msgTimersRef.current;
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  const refreshUpscaleInfo = useCallback(async () => {
    const info = await getUpscaleCacheInfo();
    setUpscaleInfo(info);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, p] = await Promise.all([listCachedDatasets(), countPendingItems()]);
    setCached(c);
    setPending(p);
    setLoading(false);
  }, []);

  const refreshPacks = useCallback(async () => {
    const [packs, help] = await Promise.all([listOfflinePacks(), getHelpPackStatus()]);
    setOfflinePacks(packs);
    setHelpStatus(help);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void refreshUpscaleInfo(); }, [refreshUpscaleInfo]);
  useEffect(() => { void refreshPacks(); }, [refreshPacks]);

  const handleDeletePack = async (id: string) => {
    setPackClearing(id);
    await deleteOfflinePack(id);
    await refreshPacks();
    setPackClearing(null);
    toast({ title: "Offline pack deleted", duration: 3000 });
  };

  const handleDeleteHelp = async () => {
    setHelpClearing(true);
    await deleteHelpPack();
    await refreshPacks();
    setHelpClearing(false);
    toast({ title: "Help pack deleted", duration: 3000 });
  };

  const handleClearEntry = async (url: string) => {
    setClearing(url);
    await clearCacheEntry(url);
    await refresh();
    setClearing(null);
  };

  const handleClearAll = async () => {
    if (!("caches" in window)) return;
    setClearing("all");
    const names = await caches.keys();
    await Promise.all(names.map((n) => caches.delete(n)));
    await idbClear();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith("pending-")) localStorage.removeItem(k!);
    }
    setAllClearedMsg(true);
    await refresh();
    setClearing(null);
    scheduleMsgReset(() => setAllClearedMsg(false), 3000);
  };

  const handleClearUpscaleCache = async () => {
    setClearing("upscale");
    await clearUpscaleCache();
    await refreshUpscaleInfo();
    setClearing(null);
    setUpscaleClearMsg(true);
    scheduleMsgReset(() => setUpscaleClearMsg(false), 3000);
    toast({ title: "Enhanced image cache cleared", duration: 3000 });
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
          {loading ? (
            <div style={{ fontSize: 10, color: "#64748b" }}>◌ Loading…</div>
          ) : cached.length === 0 ? (
            <div data-testid="no-cache-msg" style={{ fontSize: 10, color: "#64748b" }}>
              No terrain data cached. Load a dataset to cache it.
            </div>
          ) : (
            cached.map((entry) => (
              <div key={entry.url} data-testid="cache-entry" style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "6px 0", borderBottom: "1px solid rgba(0,229,255,0.06)", fontSize: 10,
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.label}
                  </div>
                  {entry.sizeKb !== null && (
                    <div style={{ fontSize: 9, color: "#64748b" }}>{entry.sizeKb} KB</div>
                  )}
                </div>
                <button
                  onClick={() => void handleClearEntry(entry.url)}
                  disabled={clearing === entry.url}
                  style={{
                    ...S.dangerBtn,
                    padding: "2px 8px",
                    fontSize: 8,
                    flexShrink: 0,
                    marginLeft: 8,
                  }}
                >
                  {clearing === entry.url ? "…" : "CLEAR"}
                </button>
              </div>
            ))
          )}
          {cached.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
              <button
                data-testid="clear-all-cache-btn"
                onClick={() => void handleClearAll()}
                disabled={clearing === "all"}
                style={{ ...S.dangerBtn, padding: "4px 12px", fontSize: 9 }}
              >
                {clearing === "all" ? "CLEARING…" : "CLEAR ALL CACHE"}
              </button>
            </div>
          )}
          {allClearedMsg && (
            <div style={{ marginTop: 8, fontSize: 10, color: "#4ade80" }}>✓ All cached data cleared</div>
          )}
        </div>
      </div>

      {/* Pending sync card */}
      {(pending.markers > 0 || pending.trails > 0) && (
        <div style={S.card}>
          <div style={S.cardHeader}>PENDING SYNC</div>
          <div style={{ padding: "12px 16px", fontSize: 10, color: "#cbd5e1" }}>
            {pending.markers > 0 && (
              <div>{pending.markers} marker{pending.markers !== 1 ? "s" : ""} waiting to sync</div>
            )}
            {pending.trails > 0 && (
              <div>{pending.trails} trail{pending.trails !== 1 ? "s" : ""} waiting to sync</div>
            )}
            <div style={{ fontSize: 9, color: "#64748b", marginTop: 6 }}>
              These will upload automatically when you reconnect.
            </div>
          </div>
        </div>
      )}

      {/* Enhanced image cache */}
      <div style={S.card}>
        <div style={S.cardHeader}>ENHANCED IMAGE CACHE</div>
        <div style={{ padding: "12px 16px" }}>
          {upscaleInfo !== null ? (
            <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 10 }}>
              {upscaleInfo.count} image{upscaleInfo.count !== 1 ? "s" : ""} cached ·{" "}
              {formatCacheSize(upscaleInfo.bytes)}
            </div>
          ) : (
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 10 }}>◌ Loading…</div>
          )}
          {upscaleClearMsg && (
            <div style={{ fontSize: 10, color: "#4ade80", marginBottom: 8 }}>
              ✓ Enhanced image cache cleared
            </div>
          )}
          <button
            data-testid="clear-upscale-cache-btn"
            onClick={() => void handleClearUpscaleCache()}
            disabled={clearing === "upscale" || (upscaleInfo?.count ?? 0) === 0}
            style={{
              ...S.dangerBtn,
              padding: "4px 12px",
              fontSize: 9,
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
          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 10 }}>
            Terrain, tide predictions, and weather snapshots saved for offline use.
            Each pack covers 7 days of tide data and can be updated from the dataset panel.
          </div>
          {offlinePacks.length === 0 ? (
            <div style={{ fontSize: 10, color: "#64748b" }}>
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
                    <div style={{ fontSize: 10, color: "#cbd5e1", fontWeight: 600, marginBottom: 2 }}>
                      {pack.datasetName}
                    </div>
                    <div style={{ fontSize: 9, color: "#64748b" }}>
                      Saved {savedDate} · {sizeStr}
                    </div>
                    <div style={{ fontSize: 9, color: isExpired ? "#f87171" : "#94a3b8", marginTop: 1 }}>
                      Tide data {isExpired ? "expired" : `expires ${expiresDate}`}
                    </div>
                  </div>
                  <button
                    data-testid={`delete-pack-${pack.id}`}
                    onClick={() => void handleDeletePack(pack.id)}
                    disabled={packClearing === pack.id}
                    style={{
                      ...S.dangerBtn,
                      padding: "3px 8px",
                      fontSize: 8,
                      flexShrink: 0,
                    }}
                  >
                    {packClearing === pack.id ? "…" : "DELETE"}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
      {/* Help content pack */}
      <div style={S.card}>
        <div style={S.cardHeader}>HELP CONTENT</div>
        <div style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 10 }}>
            Tutorial GIFs and images are cached for offline viewing. Download once to access
            help articles without a network connection.
          </div>
          {helpStatus === null ? (
            <div style={{ fontSize: 10, color: "#64748b" }}>◌ Loading…</div>
          ) : helpStatus.saved ? (
            <div>
              <div style={{ fontSize: 10, color: "#4ade80", marginBottom: 8 }}>
                ✓ Help content saved ·{" "}
                {helpStatus.savedAt && new Date(helpStatus.savedAt).toLocaleDateString(undefined, {
                  month: "short", day: "numeric", year: "numeric",
                })}
                {helpStatus.totalBytes != null && ` · ${(helpStatus.totalBytes / 1024).toFixed(0)} KB`}
              </div>
              <button
                data-testid="delete-help-pack-btn"
                onClick={() => void handleDeleteHelp()}
                disabled={helpClearing}
                style={{ ...S.dangerBtn, fontSize: 8, padding: "3px 8px" }}
              >
                {helpClearing ? "…" : "DELETE HELP PACK"}
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 10, color: "#64748b" }}>
              No help content saved. Use the Help panel (? button) when online to cache it.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
