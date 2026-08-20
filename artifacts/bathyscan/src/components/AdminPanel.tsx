/**
 * AdminPanel — admin-only dashboard surfacing server-side operational stats.
 *
 * Cards:
 *   - Pending Approvals: lists users awaiting approval with one-click approve.
 *   - Upscale Cache: hit/miss counts, hit rate, estimated Poe credits saved.
 *   - Skill Download: downloads the failure-gate skill zip.
 *
 * Access is gated by the server (403 when the signed-in user is not in
 * ADMIN_USER_IDS). This component renders a placeholder card while loading
 * and an error state if the fetch fails or returns 403.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { authorizedFetch } from "@/lib/authorizedFetch";
import { triggerBlobDownload } from "@/lib/blobDownload";
import { UserAccessSection } from "@/components/admin/UserAccessSection";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

interface UpscaleCacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  estimatedCreditsSaved: number;
  creditsPerCall: number;
  generatedAt: string;
}

interface PendingUser {
  clerkUserId: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUpscaleCacheStats(value: unknown): value is UpscaleCacheStats {
  if (!isRecord(value)) return false;
  return (
    typeof value.hits === "number" &&
    typeof value.misses === "number" &&
    typeof value.hitRate === "number" &&
    typeof value.estimatedCreditsSaved === "number" &&
    typeof value.creditsPerCall === "number" &&
    typeof value.generatedAt === "string"
  );
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

type AdminLoadState = "loading" | "ok" | "empty" | "error";

function OperationalCard({
  title,
  endpoint,
  describe,
}: {
  title: string;
  endpoint: string;
  describe: (data: Record<string, unknown>) => string;
}) {
  const [state, setState] = useState<AdminLoadState>("loading");
  const [message, setMessage] = useState("");
  const describeRef = useRef(describe);
  describeRef.current = describe;
  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await authorizedFetch(`${basePath}${endpoint}`);
      if (!res.ok) throw new Error("request failed");
      const data = (await res.json()) as Record<string, unknown>;
      const next = describeRef.current(data);
      setMessage(next);
      setState(next === "" ? "empty" : "ok");
    } catch {
      // Do not surface transport errors, bucket names, or authorization details.
      setState("error");
    }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div style={{ ...S.card, marginTop: 12 }}>
      <div style={S.cardTitle}>{title}</div>
      {state === "loading" && <div style={{ ...S.skeleton, width: "65%" }} />}
      {state === "ok" && <div style={S.note}>{message}</div>}
      {state === "empty" && <div style={S.note}>No current activity.</div>}
      {state === "error" && <div style={S.error}>Unable to load this operational summary.</div>}
      <button
        data-testid={`admin-refresh-${title.toLowerCase().replace(/\W+/g, "-")}`}
        onClick={() => void load()}
        disabled={state === "loading"}
        style={{ ...S.cardTitle, background: "none", border: "none", padding: 0, marginTop: 10, cursor: "pointer", opacity: state === "loading" ? 0.5 : 1 }}
      >
        REFRESH
      </button>
    </div>
  );
}

function EmailDeliveryCard() {
  const [state, setState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const send = async () => {
    setState("sending");
    try {
      const res = await authorizedFetch(`${basePath}/api/admin/users/test-notification`, { method: "POST" });
      if (!res.ok) throw new Error("request failed");
      const data = (await res.json()) as { sent?: boolean };
      if (data.sent !== true) throw new Error("delivery failed");
      setState("success");
    } catch {
      setState("error");
    }
  };
  return (
    <div style={{ ...S.card, marginTop: 12 }}>
      <div style={S.cardTitle}>Email Delivery Verification</div>
      <div style={S.note}>Send a test approval notification to configured administrators.</div>
      <button
        data-testid="admin-test-notification"
        onClick={() => void send()}
        disabled={state === "sending"}
        style={{ ...S.cardTitle, background: "none", border: "1px solid rgba(0,229,255,0.25)", borderRadius: 3, padding: "5px 10px", marginTop: 10, cursor: state === "sending" ? "default" : "pointer" }}
      >
        {state === "sending" ? "SENDING…" : "SEND TEST NOTIFICATION"}
      </button>
      {state === "success" && <div data-testid="admin-email-success" style={{ ...S.note, color: "#4ade80" }}>Test notification sent.</div>}
      {state === "error" && <div data-testid="admin-email-error" style={{ ...S.error, marginTop: 8 }}>Unable to send the test notification.</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending Approvals card
// ---------------------------------------------------------------------------

function PendingApprovalsCard({ adminStatus }: { adminStatus: "loading" | "ok" | "forbidden" | "error" }) {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());
  const [approveErrors, setApproveErrors] = useState<Map<string, string>>(new Map());
  const [denyingIds, setDenyingIds] = useState<Set<string>>(new Set());
  const [denyErrors, setDenyErrors] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    try {
      const res = await authorizedFetch(`${basePath}/api/admin/users?status=pending&limit=50`);
      if (!res.ok) { setLoadState("error"); return; }
      const data: unknown = await res.json();
      const pendingUsers =
        isRecord(data) && Array.isArray(data.users) ? data.users : [];
      setUsers(pendingUsers as PendingUser[]);
      setLoadState("ok");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    if (adminStatus !== "ok") return;
    void load();
  }, [adminStatus, load]);

  const handleApprove = useCallback(async (clerkUserId: string) => {
    setApprovingIds((prev) => new Set(prev).add(clerkUserId));
    setApproveErrors((prev) => { const m = new Map(prev); m.delete(clerkUserId); return m; });
    try {
      const res = await authorizedFetch(
        `${basePath}/api/admin/users/${encodeURIComponent(clerkUserId)}/approve`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      // Remove the approved user from the local list immediately.
      setUsers((prev) => prev.filter((u) => u.clerkUserId !== clerkUserId));
    } catch {
      setApproveErrors((prev) => new Map(prev).set(clerkUserId, "Approval failed — try again"));
    } finally {
      setApprovingIds((prev) => { const s = new Set(prev); s.delete(clerkUserId); return s; });
    }
  }, []);

  const handleDeny = useCallback(async (clerkUserId: string) => {
    setDenyingIds((prev) => new Set(prev).add(clerkUserId));
    setDenyErrors((prev) => { const m = new Map(prev); m.delete(clerkUserId); return m; });
    try {
      const res = await authorizedFetch(
        `${basePath}/api/admin/users/${encodeURIComponent(clerkUserId)}/ban`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      // Remove the denied user from the list immediately, matching approve UX.
      setUsers((prev) => prev.filter((u) => u.clerkUserId !== clerkUserId));
    } catch {
      setDenyErrors((prev) => new Map(prev).set(clerkUserId, "Deny failed — try again"));
    } finally {
      setDenyingIds((prev) => { const s = new Set(prev); s.delete(clerkUserId); return s; });
    }
  }, []);

  if (adminStatus === "loading") return null;
  if (adminStatus === "forbidden") return null;

  return (
    <div style={{ ...S.card, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={S.cardTitle}>Pending Approvals</div>
        {loadState === "ok" && users.length > 0 && (
          <span
            data-testid="pending-approvals-count"
            style={{
              background: "#f97316",
              color: "#fff",
              borderRadius: 10,
              fontSize: "calc(8px * var(--bs-font-scale, 1))",
              fontWeight: 700,
              padding: "1px 7px",
              letterSpacing: "0.05em",
              position: "relative",
              top: -1,
            }}
          >
            {users.length}
          </span>
        )}
      </div>

      {loadState === "loading" && (
        <>
          <div style={{ ...S.skeleton, width: "60%" }} />
          <div style={{ ...S.skeleton, width: "45%" }} />
        </>
      )}

      {loadState === "error" && (
        <div style={S.error}>Failed to load pending users.</div>
      )}

      {loadState === "ok" && users.length === 0 && (
        <div style={{ ...S.note, marginTop: 0, color: "rgba(226,232,240,0.45)" }}>
          No users awaiting approval.
        </div>
      )}

      {loadState === "ok" && users.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {users.map((u) => (
            <li
              key={u.clerkUserId}
              data-testid="pending-user-row"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "6px 0",
                borderBottom: "1px solid rgba(0,229,255,0.08)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "calc(9px * var(--bs-font-scale, 1))",
                    color: "#e2e8f0",
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {u.displayName ?? u.email ?? u.clerkUserId}
                </div>
                {u.email && u.displayName && (
                  <div
                    style={{
                      fontSize: "calc(8px * var(--bs-font-scale, 1))",
                      color: "rgba(226,232,240,0.4)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {u.email}
                  </div>
                )}
                {approveErrors.get(u.clerkUserId) && (
                  <div style={{ ...S.error, fontSize: "calc(8px * var(--bs-font-scale, 1))" }}>
                    {approveErrors.get(u.clerkUserId)}
                  </div>
                )}
                {denyErrors.get(u.clerkUserId) && (
                  <div style={{ ...S.error, fontSize: "calc(8px * var(--bs-font-scale, 1))" }}>
                    {denyErrors.get(u.clerkUserId)}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  data-testid="approve-user-btn"
                  onClick={() => void handleApprove(u.clerkUserId)}
                  disabled={approvingIds.has(u.clerkUserId) || denyingIds.has(u.clerkUserId)}
                  style={{
                    background: "rgba(34,197,94,0.08)",
                    border: "1px solid rgba(34,197,94,0.35)",
                    borderRadius: 3,
                    color: "#4ade80",
                    fontSize: "calc(8px * var(--bs-font-scale, 1))",
                    letterSpacing: "0.12em",
                    padding: "3px 10px",
                    cursor: (approvingIds.has(u.clerkUserId) || denyingIds.has(u.clerkUserId)) ? "default" : "pointer",
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    opacity: (approvingIds.has(u.clerkUserId) || denyingIds.has(u.clerkUserId)) ? 0.5 : 1,
                    textTransform: "uppercase",
                  }}
                >
                  {approvingIds.has(u.clerkUserId) ? "…" : "APPROVE"}
                </button>
                <button
                  data-testid="deny-user-btn"
                  onClick={() => void handleDeny(u.clerkUserId)}
                  disabled={approvingIds.has(u.clerkUserId) || denyingIds.has(u.clerkUserId)}
                  style={{
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.35)",
                    borderRadius: 3,
                    color: "#f87171",
                    fontSize: "calc(8px * var(--bs-font-scale, 1))",
                    letterSpacing: "0.12em",
                    padding: "3px 10px",
                    cursor: (approvingIds.has(u.clerkUserId) || denyingIds.has(u.clerkUserId)) ? "default" : "pointer",
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    opacity: (approvingIds.has(u.clerkUserId) || denyingIds.has(u.clerkUserId)) ? 0.5 : 1,
                    textTransform: "uppercase",
                  }}
                >
                  {denyingIds.has(u.clerkUserId) ? "…" : "DENY"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skill download card
// ---------------------------------------------------------------------------

function SkillDownloadCard({ adminStatus }: { adminStatus: "loading" | "ok" | "forbidden" | "error" }) {
  const [downloadState, setDownloadState] = useState<"idle" | "downloading" | "error">("idle");

  const handleDownload = async () => {
    setDownloadState("downloading");
    try {
      const res = await authorizedFetch(`${basePath}/api/admin/skill/failure-gate`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      triggerBlobDownload(blob, "failure-gate-skill.zip");
      setDownloadState("idle");
    } catch {
      setDownloadState("error");
    }
  };

  if (adminStatus === "loading") return null;

  return (
    <div style={{ ...S.card, marginTop: 12 }}>
      <div style={S.cardTitle}>Skill Download</div>

      {adminStatus === "forbidden" ? (
        <div style={S.note}>Admin access required to download skills.</div>
      ) : (
        <>
          <button
            onClick={() => void handleDownload()}
            disabled={downloadState === "downloading"}
            style={{
              background: "rgba(0,229,255,0.06)",
              border: "1px solid rgba(0,229,255,0.25)",
              borderRadius: 3,
              color: "#67e8f9",
              fontSize: "calc(9px * var(--bs-font-scale, 1))",
              letterSpacing: "0.15em",
              padding: "4px 12px",
              cursor: downloadState === "downloading" ? "default" : "pointer",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              opacity: downloadState === "downloading" ? 0.6 : 1,
            }}
          >
            {downloadState === "downloading" ? "DOWNLOADING…" : "DOWNLOAD FAILURE GATE SKILL"}
          </button>
          {downloadState === "error" && (
            <div style={{ ...S.error, marginTop: 8 }}>Download failed. Check server logs.</div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main AdminPanel
// ---------------------------------------------------------------------------

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

        const data: unknown = await res.json();
        if (!isUpscaleCacheStats(data)) {
          setStatus("error");
          return;
        }
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

      {/* Pending Approvals — shown whenever admin status is known (not loading/forbidden) */}
      <PendingApprovalsCard adminStatus={status} />

      {status === "loading" && <SkeletonCard />}

      {status === "forbidden" && (
        <div style={S.card}>
          <div style={S.error}>Access restricted to admin users.</div>
        </div>
      )}

      {status === "error" && (
        <div style={S.card}>
          <div style={S.error}>Admin tools are temporarily unavailable.</div>
        </div>
      )}

      {/* User approval management — mounted only after a protected server
          endpoint confirms admin access, so no other admin requests are made
          for a forbidden caller. */}
      {status === "ok" && <UserAccessSection />}

      {status === "ok" && stats && (
        <div style={{ ...S.card, marginTop: 12 }}>
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

      {status === "ok" && (
        <>
          <EmailDeliveryCard />
          <OperationalCard
            title="Dataset Bucket Status"
            endpoint="/api/admin/bucket-monitor"
            describe={(data) => {
              const counts = data.counts as Record<string, unknown> | undefined;
              return counts
                ? Object.entries(counts).map(([name, value]) => `${name}: ${String(value)}`).join(" · ")
                : "";
            }}
          />
          <OperationalCard
            title="Large Dataset Changes"
            endpoint="/api/admin/large-datasets-diff"
            describe={(data) => {
              const changed = typeof data.changedCount === "number" ? data.changedCount : 0;
              const missing = typeof data.unimportedCount === "number" ? data.unimportedCount : 0;
              return changed + missing > 0
                ? `${changed} changed · ${missing} not yet imported`
                : "No changed or unimported large datasets.";
            }}
          />
          <OperationalCard
            title="Rate Limit Activity"
            endpoint="/api/admin/rate-limit/usage"
            describe={(data) => {
              const count = typeof data.count === "number" ? data.count : 0;
              return count > 0 ? `${count} active usage bucket${count === 1 ? "" : "s"}.` : "";
            }}
          />
        </>
      )}

      {status === "ok" && <SkillDownloadCard adminStatus={status} />}
    </div>
  );
}
