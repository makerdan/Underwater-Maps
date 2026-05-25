/**
 * Settings page — Offline & Storage section.
 *
 * Lists cached terrain datasets from Cache Storage, shows their serialised
 * size, and lets the user clear individual caches. Also shows any pending
 * offline items queued in IndexedDB.
 *
 * Route: /settings
 */
import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { keys as idbKeys, clear as idbClear } from "idb-keyval";

interface CachedDataset {
  url: string;
  label: string;
  sizeKb: number | null;
}

async function listCachedDatasets(): Promise<CachedDataset[]> {
  if (!("caches" in window)) return [];
  const cacheNames = await caches.keys();
  const terrainCacheNames = cacheNames.filter(
    (n) => n === "api-terrain" || n === "api-overview" || n.includes("terrain"),
  );
  const entries: CachedDataset[] = [];
  for (const name of terrainCacheNames) {
    const cache = await caches.open(name);
    const reqs = await cache.keys();
    for (const req of reqs) {
      const resp = await cache.match(req);
      let sizeKb: number | null = null;
      if (resp) {
        const cloned = resp.clone();
        try {
          const buf = await cloned.arrayBuffer();
          sizeKb = Math.round(buf.byteLength / 1024);
        } catch {
          // ignore
        }
      }
      const url = req.url;
      const match = /\/datasets\/([^/]+)\/(terrain|overview)/.exec(url);
      const label = match ? `${match[1]} (${match[2]})` : url.split("/").slice(-3).join("/");
      entries.push({ url, label, sizeKb });
    }
  }
  return entries;
}

async function clearCacheEntry(url: string): Promise<void> {
  if (!("caches" in window)) return;
  const cacheNames = await caches.keys();
  for (const name of cacheNames) {
    const cache = await caches.open(name);
    await cache.delete(url);
  }
}

async function countPendingItems(): Promise<{ markers: number; trails: number }> {
  let markers = 0;
  let trails = 0;
  try {
    const keys = await idbKeys();
    markers = keys.filter((k) => typeof k === "string" && k.startsWith("pending-marker-")).length;
  } catch {
    // idb not available
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("pending-trail-")) trails++;
    }
  } catch {
    // localStorage not available
  }
  return { markers, trails };
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const STYLE = {
  page: {
    minHeight: "100dvh",
    background: "#040810",
    color: "#94a3b8",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  } as React.CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "12px 20px",
    borderBottom: "1px solid rgba(0,229,255,0.12)",
    background: "rgba(4,8,16,0.8)",
  } as React.CSSProperties,
  section: {
    maxWidth: 640,
    margin: "32px auto",
    padding: "0 20px",
  } as React.CSSProperties,
  card: {
    background: "rgba(0,10,20,0.7)",
    border: "1px solid rgba(0,229,255,0.15)",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 20,
  } as React.CSSProperties,
  cardHeader: {
    padding: "12px 16px",
    borderBottom: "1px solid rgba(0,229,255,0.1)",
    fontSize: 9,
    letterSpacing: "0.2em",
    color: "#00e5ff",
    fontWeight: 700,
    textShadow: "0 0 6px rgba(0,229,255,0.4)",
  } as React.CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    borderBottom: "1px solid rgba(0,229,255,0.06)",
    fontSize: 11,
  } as React.CSSProperties,
};

export function Settings() {
  const [, setLocation] = useLocation();
  const [cached, setCached] = useState<CachedDataset[]>([]);
  const [pending, setPending] = useState<{ markers: number; trails: number }>({ markers: 0, trails: 0 });
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState<string | null>(null);
  const [allClearedMsg, setAllClearedMsg] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const [c, p] = await Promise.all([listCachedDatasets(), countPendingItems()]);
    setCached(c);
    setPending(p);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

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
    setTimeout(() => setAllClearedMsg(false), 3000);
  };

  return (
    <div style={STYLE.page}>
      {/* Header */}
      <div style={STYLE.header}>
        <button
          onClick={() => setLocation(basePath + "/")}
          style={{
            background: "none",
            border: "none",
            color: "#475569",
            cursor: "pointer",
            fontSize: 11,
            letterSpacing: "0.15em",
            padding: 0,
          }}
        >
          ← BACK
        </button>
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.3em",
            color: "#00e5ff",
            fontWeight: 700,
            textShadow: "0 0 8px rgba(0,229,255,0.5)",
          }}
        >
          SETTINGS
        </span>
      </div>

      <div style={STYLE.section}>
        {/* Offline & Storage */}
        <div style={STYLE.card}>
          <div style={STYLE.cardHeader}>◈ OFFLINE &amp; STORAGE</div>

          {/* Cached terrain data */}
          <div style={{ padding: "12px 16px 8px" }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.15em",
                color: "#475569",
                marginBottom: 8,
              }}
            >
              CACHED TERRAIN DATA
            </div>
            {loading ? (
              <div style={{ fontSize: 10, color: "#334155", padding: "8px 0" }}>
                ◌ Loading cache info...
              </div>
            ) : cached.length === 0 ? (
              <div
                data-testid="no-cache-msg"
                style={{ fontSize: 10, color: "#334155", padding: "4px 0" }}
              >
                No terrain data cached yet. Load a dataset to cache it.
              </div>
            ) : (
              cached.map((entry) => (
                <div
                  key={entry.url}
                  data-testid="cache-entry"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 0",
                    borderBottom: "1px solid rgba(0,229,255,0.06)",
                    fontSize: 10,
                  }}
                >
                  <div>
                    <span style={{ color: "#64748b" }}>{entry.label}</span>
                    {entry.sizeKb !== null && (
                      <span style={{ color: "#334155", marginLeft: 8 }}>
                        {entry.sizeKb >= 1024
                          ? `${(entry.sizeKb / 1024).toFixed(1)} MB`
                          : `${entry.sizeKb} KB`}
                      </span>
                    )}
                  </div>
                  <button
                    data-testid="clear-cache-entry-btn"
                    onClick={() => void handleClearEntry(entry.url)}
                    disabled={clearing === entry.url}
                    style={{
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid rgba(239,68,68,0.25)",
                      borderRadius: 3,
                      color: "#f87171",
                      fontSize: 8,
                      letterSpacing: "0.15em",
                      padding: "2px 8px",
                      cursor: clearing === entry.url ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {clearing === entry.url ? "…" : "CLEAR"}
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Pending sync items */}
          <div style={{ ...STYLE.row, flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
            <div style={{ fontSize: 9, letterSpacing: "0.15em", color: "#475569" }}>
              PENDING SYNC ITEMS
            </div>
            <div style={{ fontSize: 10 }}>
              <span style={{ color: "#64748b" }}>Markers queued: </span>
              <span
                data-testid="pending-markers-count"
                style={{ color: pending.markers > 0 ? "#fbbf24" : "#334155" }}
              >
                {pending.markers}
              </span>
              <span style={{ color: "#64748b", marginLeft: 16 }}>Trails queued: </span>
              <span style={{ color: pending.trails > 0 ? "#fbbf24" : "#334155" }}>
                {pending.trails}
              </span>
            </div>
          </div>

          {/* Clear all */}
          <div style={{ padding: "12px 16px" }}>
            {allClearedMsg && (
              <div
                style={{
                  fontSize: 9,
                  color: "#4ade80",
                  letterSpacing: "0.12em",
                  marginBottom: 8,
                }}
              >
                ✓ All cached data cleared
              </div>
            )}
            <button
              data-testid="clear-all-cache-btn"
              onClick={() => void handleClearAll()}
              disabled={clearing === "all"}
              style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 4,
                color: "#f87171",
                fontSize: 9,
                letterSpacing: "0.15em",
                padding: "6px 16px",
                cursor: clearing === "all" ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {clearing === "all" ? "CLEARING…" : "CLEAR ALL CACHED DATA"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
