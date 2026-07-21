/**
 * AdminPanel — admin-only dashboard surfacing server-side operational stats.
 *
 * Currently shows the Upscale Cache card: hit/miss counts, hit rate, and
 * estimated Poe credits saved since the last server restart.
 *
 * Access is gated by the server (403 when the signed-in user is not in
 * ADMIN_USER_IDS). This component renders a placeholder card while loading
 * and an error state if the fetch fails or returns 403.
 */

import React, { useEffect, useState } from "react";
import { authorizedFetch } from "@/lib/authorizedFetch";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

interface UpscaleCacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  estimatedCreditsSaved: number;
  creditsPerCall: number;
  generatedAt: string;
}

const S = {
  section: {
    marginBottom: 24,
  } as React.CSSProperties,

  title: {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: "calc(9px * var(--bs-font-scale, 1))",
    fontWeight: 700,
    letterSpacing: "0.12em",
    color: "rgba(0,229,255,0.55)",
    textTransform: "uppercase" as const,
    marginBottom: 12,
  } as React.CSSProperties,

  card: {
    background: "rgba(0,229,255,0.04)",
    border: "1px solid rgba(0,229,255,0.12)",
    borderRadius: 6,
    padding: "14px 18px",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  } as React.CSSProperties,

  cardTitle: {
    fontSize: "calc(10px * var(--bs-font-scale, 1))",
    fontWeight: 700,
    letterSpacing: "0.1em",
    color: "rgba(0,229,255,0.8)",
    textTransform: "uppercase" as const,
    marginBottom: 12,
  } as React.CSSProperties,

  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 6,
  } as React.CSSProperties,

  label: {
    fontSize: "calc(9px * var(--bs-font-scale, 1))",
    color: "rgba(226,232,240,0.55)",
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  } as React.CSSProperties,

  value: {
    fontSize: "calc(11px * var(--bs-font-scale, 1))",
    color: "#e2e8f0",
    fontWeight: 600,
  } as React.CSSProperties,

  accent: {
    color: "#00e5ff",
  } as React.CSSProperties,

  note: {
    fontSize: "calc(8px * var(--bs-font-scale, 1))",
    color: "rgba(226,232,240,0.3)",
    marginTop: 10,
    letterSpacing: "0.06em",
  } as React.CSSProperties,

  error: {
    fontSize: "calc(9px * var(--bs-font-scale, 1))",
    color: "rgba(255,100,100,0.7)",
    letterSpacing: "0.06em",
  } as React.CSSProperties,

  skeleton: {
    background: "rgba(0,229,255,0.05)",
    borderRadius: 3,
    height: 10,
    marginBottom: 6,
  } as React.CSSProperties,
};

function formatHitRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function SkeletonCard() {
  return (
    <div style={S.card}>
      <div style={{ ...S.skeleton, width: "40%" }} />
      <div style={{ ...S.skeleton, width: "70%" }} />
      <div style={{ ...S.skeleton, width: "55%" }} />
      <div style={{ ...S.skeleton, width: "65%" }} />
    </div>
  );
}

export function AdminPanel() {
  const [stats, setStats] = useState<UpscaleCacheStats | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "forbidden" | "error">("loading");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await authorizedFetch(`${basePath}/api/admin/upscale-cache-stats`);
        if (cancelled) return;

        if (res.status === 403) {
          setStatus("forbidden");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }

        const data = (await res.json()) as UpscaleCacheStats;
        if (!cancelled) {
          setStats(data);
          setStatus("ok");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={S.section}>
      <div style={S.title}>Admin</div>

      {status === "loading" && <SkeletonCard />}

      {status === "forbidden" && (
        <div style={S.card}>
          <div style={S.error}>Access restricted to admin users.</div>
        </div>
      )}

      {status === "error" && (
        <div style={S.card}>
          <div style={S.error}>Failed to load admin stats. Check server logs.</div>
        </div>
      )}

      {status === "ok" && stats && (
        <div style={S.card}>
          <div style={S.cardTitle}>Upscale Cache</div>

          <div style={S.row}>
            <span style={S.label}>Hits</span>
            <span style={{ ...S.value, ...S.accent }}>{stats.hits.toLocaleString()}</span>
          </div>

          <div style={S.row}>
            <span style={S.label}>Misses</span>
            <span style={S.value}>{stats.misses.toLocaleString()}</span>
          </div>

          <div style={S.row}>
            <span style={S.label}>Hit Rate</span>
            <span style={{ ...S.value, ...S.accent }}>{formatHitRate(stats.hitRate)}</span>
          </div>

          <div style={S.row}>
            <span style={S.label}>Est. Credits Saved</span>
            <span style={{ ...S.value, ...S.accent }}>
              {stats.estimatedCreditsSaved.toLocaleString()}
            </span>
          </div>

          <div style={S.note}>
            {stats.creditsPerCall} credits/call estimate · resets on restart ·{" "}
            {new Date(stats.generatedAt).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}
