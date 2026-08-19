/**
 * UserAccessSection — admin user-approval management table.
 *
 * Rendered inside AdminPanel only when the current user is a confirmed admin
 * (the parent gates on its own `status === "ok"` check). Shows a filterable,
 * keyset-paginated table of user_access rows with per-row actions:
 *
 *   pending  → APPROVE, DELETE
 *   approved → BAN (optional note), DELETE
 *   banned   → RESTORE, DELETE
 *
 * Destructive actions (Ban, Delete) require an inline confirmation before
 * firing. Rows update via the cache-patching mutation hooks in
 * `@/lib/adminUsers`; the active tab's count badge is derived from the same
 * cache so it refreshes with every action.
 *
 * Concurrency: a per-row in-flight guard (ref + re-render bump) makes
 * double-clicks fire exactly one mutation and disables the row's buttons
 * while a mutation is in flight.
 *
 * Styling follows the AdminPanel `S` inline-style pattern (cyan admin
 * palette, JetBrains Mono, --bs-font-scale sized fonts).
 */
import React, { useMemo, useReducer, useRef, useState } from "react";
import {
  useAdminUsersList,
  useApproveAdminUser,
  useBanAdminUser,
  useRestoreAdminUser,
  useDeleteAdminUser,
  type AdminUserRecord,
  type AdminUserStatus,
} from "@/lib/adminUsers";

type TabId = "all" | AdminUserStatus;

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "ALL" },
  { id: "pending", label: "PENDING" },
  { id: "approved", label: "APPROVED" },
  { id: "banned", label: "BANNED" },
];

const MONO = "'JetBrains Mono', 'Fira Code', monospace";

const BADGE_COLORS: Record<AdminUserStatus, { color: string; border: string }> = {
  pending: { color: "#fbbf24", border: "rgba(251,191,36,0.4)" },
  approved: { color: "#34d399", border: "rgba(52,211,153,0.4)" },
  banned: { color: "#f87171", border: "rgba(248,113,113,0.4)" },
};

const S = {
  card: {
    background: "rgba(0,229,255,0.04)",
    border: "1px solid rgba(0,229,255,0.12)",
    borderRadius: 6,
    padding: "14px 18px",
    fontFamily: MONO,
    marginTop: 12,
  } as React.CSSProperties,

  cardTitle: {
    fontSize: "calc(10px * var(--bs-font-scale, 1))",
    fontWeight: 700,
    letterSpacing: "0.1em",
    color: "rgba(0,229,255,0.8)",
    textTransform: "uppercase" as const,
    marginBottom: 12,
  } as React.CSSProperties,

  tabRow: {
    display: "flex",
    gap: 6,
    marginBottom: 12,
    flexWrap: "wrap" as const,
  } as React.CSSProperties,

  tab: {
    background: "transparent",
    border: "1px solid rgba(0,229,255,0.15)",
    borderRadius: 3,
    color: "rgba(226,232,240,0.55)",
    fontFamily: MONO,
    fontSize: "calc(9px * var(--bs-font-scale, 1))",
    letterSpacing: "0.12em",
    padding: "4px 10px",
    cursor: "pointer",
  } as React.CSSProperties,

  tabActive: {
    background: "rgba(0,229,255,0.08)",
    border: "1px solid rgba(0,229,255,0.4)",
    color: "#67e8f9",
  } as React.CSSProperties,

  tabCount: {
    marginLeft: 6,
    color: "#00e5ff",
    fontWeight: 700,
  } as React.CSSProperties,

  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
  } as React.CSSProperties,

  th: {
    fontSize: "calc(8px * var(--bs-font-scale, 1))",
    color: "rgba(226,232,240,0.4)",
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    textAlign: "left" as const,
    padding: "4px 8px 6px 0",
    borderBottom: "1px solid rgba(0,229,255,0.12)",
    fontWeight: 600,
  } as React.CSSProperties,

  td: {
    fontSize: "calc(10px * var(--bs-font-scale, 1))",
    color: "#e2e8f0",
    padding: "6px 8px 6px 0",
    borderBottom: "1px solid rgba(0,229,255,0.06)",
    verticalAlign: "top" as const,
  } as React.CSSProperties,

  tdMuted: {
    color: "rgba(226,232,240,0.55)",
  } as React.CSSProperties,

  badge: {
    display: "inline-block",
    fontSize: "calc(8px * var(--bs-font-scale, 1))",
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    borderRadius: 3,
    padding: "2px 6px",
    fontWeight: 700,
  } as React.CSSProperties,

  actionBtn: {
    background: "rgba(0,229,255,0.06)",
    border: "1px solid rgba(0,229,255,0.25)",
    borderRadius: 3,
    color: "#67e8f9",
    fontFamily: MONO,
    fontSize: "calc(8px * var(--bs-font-scale, 1))",
    letterSpacing: "0.12em",
    padding: "3px 8px",
    cursor: "pointer",
    marginRight: 6,
    marginBottom: 4,
  } as React.CSSProperties,

  dangerBtn: {
    background: "rgba(248,113,113,0.06)",
    border: "1px solid rgba(248,113,113,0.35)",
    color: "#f87171",
  } as React.CSSProperties,

  confirmBox: {
    marginTop: 6,
    padding: "6px 8px",
    border: "1px solid rgba(248,113,113,0.35)",
    borderRadius: 3,
    background: "rgba(248,113,113,0.05)",
  } as React.CSSProperties,

  confirmText: {
    fontSize: "calc(9px * var(--bs-font-scale, 1))",
    color: "rgba(226,232,240,0.8)",
    marginBottom: 6,
  } as React.CSSProperties,

  noteInput: {
    display: "block",
    width: "100%",
    boxSizing: "border-box" as const,
    background: "rgba(15,23,42,0.8)",
    border: "1px solid rgba(0,229,255,0.2)",
    borderRadius: 3,
    color: "#e2e8f0",
    fontFamily: MONO,
    fontSize: "calc(9px * var(--bs-font-scale, 1))",
    padding: "4px 6px",
    marginBottom: 6,
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

  loadMoreBtn: {
    background: "rgba(0,229,255,0.06)",
    border: "1px solid rgba(0,229,255,0.25)",
    borderRadius: 3,
    color: "#67e8f9",
    fontFamily: MONO,
    fontSize: "calc(9px * var(--bs-font-scale, 1))",
    letterSpacing: "0.15em",
    padding: "4px 12px",
    cursor: "pointer",
    marginTop: 10,
  } as React.CSSProperties,
};

function StatusBadge({ status }: { status: AdminUserStatus }) {
  const { color, border } = BADGE_COLORS[status];
  return (
    <span style={{ ...S.badge, color, border: `1px solid ${border}` }}>
      {status}
    </span>
  );
}

function SkeletonRows() {
  return (
    <div data-testid="ua-skeleton">
      <div style={{ ...S.skeleton, width: "85%" }} />
      <div style={{ ...S.skeleton, width: "70%" }} />
      <div style={{ ...S.skeleton, width: "78%" }} />
    </div>
  );
}

type ConfirmState = { clerkUserId: string; kind: "ban" | "delete" } | null;

export function UserAccessSection() {
  const [activeTab, setActiveTab] = useState<TabId>("pending");
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [banNote, setBanNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const statusFilter: AdminUserStatus | undefined =
    activeTab === "all" ? undefined : activeTab;

  const listQuery = useAdminUsersList(statusFilter);
  const approve = useApproveAdminUser();
  const ban = useBanAdminUser();
  const restore = useRestoreAdminUser();
  const del = useDeleteAdminUser();

  // Per-row in-flight guard. A ref (not state) so the second click of a
  // double-click — which lands before React re-renders — is still rejected;
  // the reducer bump forces a re-render so `disabled` styling updates.
  const inFlightRef = useRef<Set<string>>(new Set());
  const [, bumpRender] = useReducer((c: number) => c + 1, 0);

  const pages = listQuery.data?.pages;
  const rows: AdminUserRecord[] = useMemo(
    () => (pages ? pages.flatMap((p) => p.users) : []),
    [pages],
  );

  async function runAction(
    clerkUserId: string,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    if (inFlightRef.current.has(clerkUserId)) return;
    inFlightRef.current.add(clerkUserId);
    bumpRender();
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(
        err instanceof Error && err.message
          ? err.message
          : "Action failed. Try again.",
      );
    } finally {
      inFlightRef.current.delete(clerkUserId);
      bumpRender();
    }
  }

  function switchTab(tab: TabId): void {
    setActiveTab(tab);
    setConfirm(null);
    setBanNote("");
    setActionError(null);
  }

  function openConfirm(clerkUserId: string, kind: "ban" | "delete"): void {
    setConfirm({ clerkUserId, kind });
    setBanNote("");
  }

  function closeConfirm(): void {
    setConfirm(null);
    setBanNote("");
  }

  function renderActions(u: AdminUserRecord) {
    const id = u.clerkUserId;
    const busy = inFlightRef.current.has(id);
    const confirming = confirm !== null && confirm.clerkUserId === id;

    if (confirming && confirm.kind === "ban") {
      return (
        <div style={S.confirmBox} data-testid={`ua-confirm-ban-${id}`}>
          <div style={S.confirmText}>Ban this user? Optional note:</div>
          <input
            style={S.noteInput}
            data-testid={`ua-ban-note-${id}`}
            value={banNote}
            maxLength={2000}
            placeholder="Reason (optional)"
            onChange={(e) => setBanNote(e.target.value)}
          />
          <button
            style={{ ...S.actionBtn, ...S.dangerBtn }}
            data-testid={`ua-confirm-ban-fire-${id}`}
            disabled={busy}
            onClick={() => {
              closeConfirm();
              void runAction(id, () =>
                ban.mutateAsync({
                  clerkUserId: id,
                  ...(banNote !== "" ? { note: banNote } : {}),
                }),
              );
            }}
          >
            CONFIRM BAN
          </button>
          <button
            style={S.actionBtn}
            data-testid={`ua-cancel-confirm-${id}`}
            onClick={closeConfirm}
          >
            CANCEL
          </button>
        </div>
      );
    }

    if (confirming && confirm.kind === "delete") {
      return (
        <div style={S.confirmBox} data-testid={`ua-confirm-delete-${id}`}>
          <div style={S.confirmText}>
            Delete this record? The user returns to pending on their next
            login.
          </div>
          <button
            style={{ ...S.actionBtn, ...S.dangerBtn }}
            data-testid={`ua-confirm-delete-fire-${id}`}
            disabled={busy}
            onClick={() => {
              closeConfirm();
              void runAction(id, () => del.mutateAsync({ clerkUserId: id }));
            }}
          >
            CONFIRM DELETE
          </button>
          <button
            style={S.actionBtn}
            data-testid={`ua-cancel-confirm-${id}`}
            onClick={closeConfirm}
          >
            CANCEL
          </button>
        </div>
      );
    }

    return (
      <div>
        {u.status === "pending" && (
          <button
            style={S.actionBtn}
            data-testid={`ua-approve-${id}`}
            disabled={busy}
            onClick={() =>
              void runAction(id, () => approve.mutateAsync({ clerkUserId: id }))
            }
          >
            APPROVE
          </button>
        )}
        {u.status === "approved" && (
          <button
            style={{ ...S.actionBtn, ...S.dangerBtn }}
            data-testid={`ua-ban-${id}`}
            disabled={busy}
            onClick={() => openConfirm(id, "ban")}
          >
            BAN
          </button>
        )}
        {u.status === "banned" && (
          <button
            style={S.actionBtn}
            data-testid={`ua-restore-${id}`}
            disabled={busy}
            onClick={() =>
              void runAction(id, () => restore.mutateAsync({ clerkUserId: id }))
            }
          >
            RESTORE
          </button>
        )}
        <button
          style={{ ...S.actionBtn, ...S.dangerBtn }}
          data-testid={`ua-delete-${id}`}
          disabled={busy}
          onClick={() => openConfirm(id, "delete")}
        >
          DELETE
        </button>
      </div>
    );
  }

  return (
    <div style={S.card} data-testid="user-access-section">
      <div style={S.cardTitle}>User Access</div>

      <div style={S.tabRow}>
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              style={isActive ? { ...S.tab, ...S.tabActive } : S.tab}
              data-testid={`ua-tab-${tab.id}`}
              onClick={() => switchTab(tab.id)}
            >
              {tab.label}
              {isActive && listQuery.isSuccess && (
                <span style={S.tabCount} data-testid="ua-tab-count">
                  {rows.length}
                  {listQuery.hasNextPage ? "+" : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {listQuery.isPending && <SkeletonRows />}

      {listQuery.isError && (
        <div data-testid="ua-error">
          <div style={S.error}>
            Failed to load users. Check your connection and try again.
          </div>
          <button
            style={S.loadMoreBtn}
            data-testid="ua-retry"
            onClick={() => void listQuery.refetch()}
          >
            RETRY
          </button>
        </div>
      )}

      {listQuery.isSuccess && rows.length === 0 && (
        <div style={S.note} data-testid="ua-empty">
          {activeTab === "all" ? "No users yet." : "No users in this status."}
        </div>
      )}

      {listQuery.isSuccess && rows.length > 0 && (
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table style={{ ...S.table, minWidth: 680 }}>
          <thead>
            <tr>
              <th style={S.th}>Name</th>
              <th style={S.th}>Email</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Joined</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.clerkUserId} data-testid={`ua-row-${u.clerkUserId}`}>
                <td style={S.td}>{u.displayName ?? "—"}</td>
                <td style={{ ...S.td, ...S.tdMuted }}>{u.email ?? "—"}</td>
                <td style={S.td}>
                  <StatusBadge status={u.status} />
                </td>
                <td style={{ ...S.td, ...S.tdMuted }}>
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td style={S.td}>{renderActions(u)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {actionError !== null && (
        <div style={{ ...S.error, marginTop: 8 }} data-testid="ua-action-error">
          {actionError}
        </div>
      )}

      {listQuery.isSuccess && listQuery.hasNextPage === true && (
        <button
          style={S.loadMoreBtn}
          data-testid="ua-load-more"
          disabled={listQuery.isFetchingNextPage}
          onClick={() => void listQuery.fetchNextPage()}
        >
          {listQuery.isFetchingNextPage ? "LOADING…" : "LOAD MORE"}
        </button>
      )}
    </div>
  );
}
